// Sculpt › Erode (water and thermal strokes) and Terrain › Erode over a selected area on a Mountains map change the heights only where they may, and undo and redo each exactly; with the mask option the paint mask holds where the ground settled, only in the area, and undoes with the heights, the step holding only what changed (#444).
// touches: frontend/src/lib/terrain/erosion.ts, frontend/src/lib/terrain/erodeArea.ts, frontend/src/lib/tools/TerrainTools.ts, frontend/src/components/ErodeDialog.svelte
const e = P.e
const { editor } = await P.state()
e.newDocument(256, 'mountains', 3, 'Probe')
editor.tool = 'sculpt'
await P.frames(1)
const t = e.terrain
const V = t.verts
const cs = t.cellSize
const V3 = e.controller.target.constructor
const at = (x, z) => new V3(x, t.heightAt(x, z), z)
const diff = (a, b) => {
	let n = 0
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
	return n
}
// The steepest spot of the middle of the map, so the drops have a slope to run down.
let sx = 0
let sz = 0
let steepest = -1
for (let z = 40; z < V - 40; z += 4) {
	for (let x = 40; x < V - 40; x += 4) {
		const s = Math.abs(t.heights[z * V + x + 2] - t.heights[z * V + x - 2]) + Math.abs(t.heights[(z + 2) * V + x] - t.heights[(z - 2) * V + x])
		if (s > steepest) {
			steepest = s
			sx = x
			sz = z
		}
	}
}
const cx = sx * cs
const cz = sz * cs
const radius = 40

/** A stroke in `kind`, then undo and redo; how many vertices it changed, how many lie outside the brush, and whether undo and redo were exact. */
async function stroke(kind) {
	editor.sculptMode = 'erode'
	editor.erode.kind = kind
	editor.brush.radius = radius
	editor.brush.strength = 1
	editor.brush.shape = 'circle'
	const before = Float32Array.from(t.heights)
	const tool = e.tools.sculpt
	tool.onDown(e.ctx, at(cx, cz))
	for (let i = 0; i < 30; i++) tool.tick(e.ctx, 0.05, at(cx + i * 0.5, cz))
	tool.onUp(e.ctx)
	await P.frames(1)
	const after = Float32Array.from(t.heights)
	let outside = 0
	let most = 0
	for (let i = 0; i < after.length; i++) {
		if (after[i] === before[i]) continue
		const x = (i % V) * cs
		const z = Math.floor(i / V) * cs
		if (Math.hypot(x - cx, z - cz) > radius + 15 + 2 * cs) outside++
		most = Math.max(most, Math.abs(after[i] - before[i]))
	}
	e.history.undo()
	await P.frames(1)
	const undone = diff(before, t.heights)
	e.history.redo()
	await P.frames(1)
	const redone = diff(after, t.heights)
	return { changed: diff(before, after), outside, most: +most.toFixed(2), undone, redone, label: e.history.peek()?.label }
}

const water = await stroke('hydraulic')
const thermal = await stroke('thermal')

// Terrain › Erode over a 60-cell square around the spot.
const sel = { x0: sx - 30, z0: sz - 30, x1: sx + 30, z1: sz + 30 }
editor.selection = { ...sel }
await P.frames(1)
const before = Float32Array.from(t.heights)
let last = 0
const finished = await e.erodeArea(
	{ density: 0.5, passes: 3, talus: 40, seed: 1 },
	(f) => (last = f),
	() => false,
)
await P.frames(1)
const after = Float32Array.from(t.heights)
let outsideArea = 0
for (let i = 0; i < after.length; i++) {
	if (after[i] === before[i]) continue
	const x = i % V
	const z = Math.floor(i / V)
	if (x <= sel.x0 || z <= sel.z0 || x >= sel.x1 || z >= sel.z1) outsideArea++
}
const areaChanged = diff(before, after)
const areaLabel = e.history.peek()?.label
e.history.undo()
await P.frames(1)
const areaUndone = diff(before, t.heights)
// A cancelled run leaves the ground as it was.
const cancelled = await e.erodeArea(
	{ density: 2, passes: 0, talus: 40, seed: 2 },
	() => {},
	() => true,
)
const afterCancel = diff(before, t.heights)
// With "Mask where sediment settled" (#242): the mask replaces a texel set far outside, holds texels only inside the area, and undo restores both.
const R = t.splatRes
const per = R / t.size
const far = (sel.z0 - 10) * per * R + (sel.x0 - 10) * per
t.mask.fill(0)
t.mask[far] = 200
t.markMaskDirty()
const maskBefore = Uint8Array.from(t.mask)
await e.erodeArea(
	{ density: 0.5, passes: 3, talus: 40, seed: 1, mask: true },
	() => {},
	() => false,
)
await P.frames(1)
// The step keeps only the texels and heights that changed (#444), not two copies of the whole mask.
const stepBytes = e.history.peek()?.bytes ?? -1
const wholeMask = 2 * t.mask.length
let maskSet = 0
let maskOutside = 0
let maskFull = 0
const levels = [0, 0, 0, 0]
for (let i = 0; i < t.mask.length; i++) {
	const m = t.mask[i]
	if (!m) continue
	maskSet++
	if (m === 255) maskFull++
	levels[Math.min(3, m >> 6)]++
	const tx = i % R
	const tz = Math.floor(i / R)
	if (tx < sel.x0 * per || tz < sel.z0 * per || tx >= sel.x1 * per || tz >= sel.z1 * per) maskOutside++
}
const maskActive = (await P.state()).ui.maskActive
const farLeft = t.mask[far]
const heightsMoved = diff(before, t.heights)
e.history.undo()
await P.frames(1)
const mask = { set: maskSet, full: maskFull, levels, outside: maskOutside, farLeft, active: maskActive, heightsMoved, stepBytes, wholeMask, maskUndone: diff(maskBefore, t.mask), heightsUndone: diff(before, t.heights) }
t.mask.fill(0)
t.markMaskDirty()
editor.selection = null
const area = { finished, progress: last, changed: areaChanged, outside: outsideArea, undone: areaUndone, label: areaLabel, cancelled, afterCancel, mask }

const good = (s) => s.changed > 20 && s.outside === 0 && s.undone === 0 && s.redone === 0
return {
	ok:
		good(water) &&
		good(thermal) &&
		finished &&
		last === 1 &&
		areaChanged > 500 &&
		outsideArea === 0 &&
		areaUndone === 0 &&
		cancelled === false &&
		afterCancel === 0 &&
		mask.set > 100 &&
		mask.outside === 0 &&
		mask.farLeft === 0 &&
		mask.active &&
		mask.heightsMoved > 500 &&
		mask.maskUndone === 0 &&
		mask.heightsUndone === 0 &&
		mask.stepBytes > 0 &&
		mask.stepBytes < mask.wholeMask / 4,
	spot: { x: sx, z: sz, steepest: +steepest.toFixed(1) },
	water,
	thermal,
	area,
}
