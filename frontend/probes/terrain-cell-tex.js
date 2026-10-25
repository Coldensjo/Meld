// The terrain's cell texture (#394), and the Map data overlay redrawn by rect (#530): the Map data tool's no-tufts overlay (its red) and a free-form area's outline (its green) share one sampler and draw together without either clobbering the other, and the terrain shader leaves a texture unit free with the sun's two shadow cascades and three lamp shadow maps.
// touches: frontend/src/lib/terrain/TerrainMaterial.ts, frontend/src/lib/terrain/Terrain.ts, frontend/src/lib/tools/MapDataTool.ts, frontend/src/lib/state/areaSelection.ts, frontend/src/lib/terrain/areaShape.ts
// tier: smoke
const e = P.e
const { editor, ui } = await P.state()
const { setAreaCells } = await P.app('/src/lib/state/areaSelection.ts')
const { INSIDE } = await P.app('/src/lib/terrain/areaShape.ts')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const t = e.terrain
const ws = t.worldSize
const n = t.size

// The whole map from above.
ui.topDown = true
const c = e.controller
c.target.set(ws / 2, 0, ws / 2)
c.distance = ws * 0.95
c.yaw = 0
await P.frames(4)
/** The colour of the ground at shares (x, z) of the map, through the camera. */
const at = (shot, x, z) => {
	const v = c.target
		.clone()
		.set(x * ws, 0, z * ws)
		.project(e.camera)
	const px = Math.floor(((v.x + 1) / 2) * shot.w)
	const row = Math.floor(((v.y + 1) / 2) * shot.h)
	const i = (row * shot.w + px) * 4
	return [shot.px[i], shot.px[i + 1], shot.px[i + 2]]
}
const differs = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 30
/** The ground at the probe's spots: the no-tufts patch, inside the L shape, the L's missing corner. */
const spots = (shot) => ({ patch: at(shot, 0.25, 0.5), shape: at(shot, 0.62, 0.62), corner: at(shot, 0.82, 0.38) })
const base = spots(await P.shot())

// No tufts on a patch of the left half, shown by the Map data tool.
// Marked as the tool marks a dab, by the rect of cells it changed (#530).
const patch = { x0: Math.floor(n * 0.1), z0: Math.floor(n * 0.3), x1: Math.floor(n * 0.4) - 1, z1: Math.floor(n * 0.7) - 1 }
const setPatch = (v) => {
	for (let z = patch.z0; z <= patch.z1; z++) for (let x = patch.x0; x <= patch.x1; x++) t.noEffect[z * n + x] = v
	t.touchChunkData(patch, true)
}
setPatch(1)
editor.tool = 'mapdata'
editor.mapDataMode = 'noTufts'
await P.frames(2)
const overlay = spots(await P.shot())

// An L-shaped area on the right half: its rect's top-right quarter is not in it.
const cells = new Uint8Array(n * n)
for (let z = Math.floor(n * 0.3); z < Math.floor(n * 0.7); z++) for (let x = Math.floor(n * 0.55); x < Math.floor(n * 0.9); x++) if (!(x >= n * 0.72 && z < n * 0.5)) cells[z * n + x] = INSIDE
setAreaCells(t, n, cells)
await P.frames(2)
const both = spots(await P.shot())

// The patch cleared again while the area stays: only the red changes.
setPatch(0)
await P.frames(2)
const cleared = spots(await P.shot())

// A zone painted on the chunks around the patch's spot, marked by their chunk rect: the zone overlay
// draws them and leaves the shape's spot as it was (#530).
editor.mapDataMode = 'area'
await P.frames(2)
const zoneBase = spots(await P.shot())
const side = t.paintChunksPerSide
const cx = Math.floor(side * 0.25)
const cz = Math.floor(side * 0.5)
const zone = { x0: cx - 1, z0: cz - 1, x1: cx + 1, z1: cz + 1 }
for (let z = zone.z0; z <= zone.z1; z++) for (let x = zone.x0; x <= zone.x1; x++) t.areaIds[z * side + x] = 12
t.touchChunkData(zone)
await P.frames(2)
const zoned = spots(await P.shot())
const zoneDrawn = differs(zoned.patch, zoneBase.patch) && !differs(zoned.shape, zoneBase.shape)
// The zone being painted is striped and stronger than the others (#714).
editor.mapDataArea = 12
editor.mapDataClear = false
await P.frames(2)
const chosen = spots(await P.shot())
editor.mapDataArea = 0
await P.frames(2)
const unchosen = spots(await P.shot())
const zoneMarked = differs(chosen.patch, unchosen.patch)
editor.selection = null
editor.tool = 'select'

// The terrain program's texture units: its own samplers, and three's shadow maps (the sun's two
// cascades and up to three shadowed lamps, PropEffects' SHADOW_LIGHTS, on a map that has them).
const gl = e.renderer.getContext()
const prog = e.renderer.properties.get(t.material).currentProgram?.program
const kinds = [gl.SAMPLER_2D, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_3D, gl.SAMPLER_CUBE, gl.SAMPLER_2D_SHADOW, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D]
let own = 0
let shadow = 0
const names = []
if (prog) {
	for (let i = 0; i < gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i++) {
		const u = gl.getActiveUniform(prog, i)
		if (!u || !kinds.includes(u.type)) continue
		if (/ShadowMap/.test(u.name)) shadow += u.size
		else {
			own += u.size
			names.push(u.name)
		}
	}
}
const units = own + 5

const overlayDrawn = differs(overlay.patch, base.patch) && !differs(overlay.shape, base.shape)
const shapeDrawn = differs(both.shape, base.shape) && !differs(both.corner, base.corner)
const patchKept = !differs(both.patch, overlay.patch)
const patchCleared = !differs(cleared.patch, base.patch) && !differs(cleared.shape, both.shape)
return {
	ok: !!prog && overlayDrawn && shapeDrawn && patchKept && patchCleared && zoneDrawn && zoneMarked && units <= 15,
	overlayDrawn,
	shapeDrawn,
	patchKept,
	patchCleared,
	zoneDrawn,
	zoneMarked,
	samplers: { own, shadowNow: shadow, withFiveShadowMaps: units, names },
	colours: { base, overlay, both, cleared, zoneBase, zoned },
}
