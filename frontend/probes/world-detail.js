// View › Detail info in a world view (#15): in Azeroth's world view at Elwynn, with the cursor on the streamed ground at a painted spot and at a lake's cell, the readout and the status bar's cursor name the streamed ground (not the hidden stand-in): the tile, chunk and map cell under the cursor, its height, its zone (#755), and its texture layers and liquids; then after Edit Here, with the same view of the region, the region's own readout at the same spot has the same tile, chunk, height, hole, zone, impassable flag, no-tufts bit, texture layers (names and shares) and liquids, and its cell is the world's less the block's corner.
// touches: frontend/src/lib/world/worldDetail.ts, frontend/src/lib/world/worldGround.ts, internal/wow/ground.go, frontend/src/lib/world/WorldStream.ts, frontend/src/components/Viewport.svelte
const { ui, editor, prefs } = await P.state()
const { stats } = await P.app('/src/lib/state/editor.svelte.ts')
const e = P.e
const { openWorldView, editWorldHere } = await P.app('/src/lib/io/region.ts')
const T = 1600 / 3
const CELL = T / 128
const was = { detail: prefs.detailInfo }
prefs.detailInfo = true
openWorldView(e, 'Azeroth', { x: 31, y: 48, size: 3 })
await P.until(() => (editor.worldMap === 'Azeroth' ? true : null), 30000, "Azeroth's world tab")
const worldDoc = e.doc
const mid = { x: 32.5 * T, z: 49.5 * T }
await P.until(() => (!Number.isNaN(worldDoc.world.heightAt(mid.x, mid.z)) ? true : null), 120000, "the block's middle tile")
await P.lookAt({ x: mid.x, y: worldDoc.world.heightAt(mid.x, mid.z), z: mid.z }, { pitch: 1.2, back: 250 })
await P.until(
	() => {
		const s = e.worldStats()
		return s && s.loaded >= 9 && !s.loading && !s.queued && !s.painting && !s.paintWaiting ? s : null
	},
	120000,
	'the near tiles loaded and painted',
)
const V3 = e.controller.target.constructor
/** Where a world point is on the viewport, as shares of it (y = 0 the top). */
const share = (x, y, z) => {
	const v = new V3(x, y, z).project(e.camera)
	return [(v.x + 1) / 2, (1 - v.y) / 2]
}
const canvas = e.renderer.domElement
canvas.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))

// The spots, each a cell's middle (the cursor lands within a few hundredths of a yard): a cell of the block's middle tile, and a lake's cell in a painted tile.
const spots = [{ name: 'ground', x: mid.x + 3.5 * CELL, z: mid.z + 5.5 * CELL }]
for (const t of worldDoc.world.tiles.values()) {
	if (!t.paintIn || !t.liquids?.length) continue
	const l = t.liquids[0]
	const c = l.cells.indexOf(1)
	spots.push({ name: 'lake', x: t.x * T + (l.indexX * 8 + (c % 8) + 0.5) * CELL, z: t.y * T + (l.indexY * 8 + Math.floor(c / 8) + 0.5) * CELL })
	break
}
/** Looks down at `s`, points the cursor at it and waits for the 2 Hz readout of the ground there; returns it with the view. */
const readAt = async (s, dx, dz, ground) => {
	await P.lookAt({ x: s.x - dx, y: ground, z: s.z - dz }, { pitch: 1.2, back: 120 })
	const at = share(s.x - dx, ground, s.z - dz)
	P.pointer('pointermove', ...at)
	await P.until(() => (stats.cursor && Math.hypot(stats.cursor.x - (s.x - dx), stats.cursor.z - (s.z - dz)) < 0.5 && stats.detail ? true : null), 20000, `the readout at the ${s.name}`)
	return JSON.parse(JSON.stringify(stats.detail))
}
const world = {}
for (const s of spots) {
	s.ground = worldDoc.world.heightAt(s.x, s.z)
	world[s.name] = await readAt(s, 0, 0, s.ground)
}
const r = { spots: spots.map((s) => s.name), world }
const g = world.ground
const gx = Math.floor(spots[0].x / CELL)
const gz = Math.floor(spots[0].z / CELL)
r.groundOk = g.tile === '32, 49' && g.chunk === `${Math.floor((gx % 128) / 8)}, ${Math.floor((gz % 128) / 8)}` && g.cell === `${gx}, ${gz}` && Math.abs(g.height - spots[0].ground) < 0.05 && g.textures.length > 0 && /\(\d+\)$/.test(g.area)
r.lakeOk = !!world.lake && world.lake.liquids.length > 0
r.shown = !!document.querySelector('[data-ui="DetailInfo"]')

// Edit Here: the region's readout at the same spots, the block's corner apart.
const hadProject = ui.project
ui.project = hadProject ?? { name: 'probe', path: '', clientPath: '' }
await P.lookAt({ x: mid.x, y: spots[0].ground, z: mid.z }, { pitch: 1.2, back: 120 })
await editWorldHere(e)
await P.until(() => (editor.regionMap === 'Azeroth' ? true : null), 180000, 'the region tab Edit Here opens')
await P.settle()
const b = e.activeRegion()
r.block = `${b.x},${b.y} ${b.size}`
r.off = []
for (const s of spots) {
	const w = world[s.name]
	const tx = Math.floor(s.x / T)
	const ty = Math.floor(s.z / T)
	if (tx < b.x || ty < b.y || tx >= b.x + b.size || ty >= b.y + b.size) continue
	const reg = await readAt(s, b.x * T, b.y * T, s.ground)
	const [wx, wz] = w.cell.split(', ').map(Number)
	const same = {
		tile: reg.tile === w.tile,
		chunk: reg.chunk === w.chunk,
		cell: reg.cell === `${wx - b.x * 128}, ${wz - b.y * 128}`,
		height: Math.abs(reg.height - w.height) < 0.05,
		hole: reg.hole === w.hole,
		area: reg.area === w.area,
		impassable: reg.impassable === w.impassable,
		noTufts: reg.noTufts === w.noTufts,
		textures: JSON.stringify(reg.textures.map((x) => [x.name, x.weight])) === JSON.stringify(w.textures.map((x) => [x.name, x.weight])),
		liquids: JSON.stringify(reg.liquids) === JSON.stringify(w.liquids),
	}
	for (const [k, v] of Object.entries(same)) if (!v) r.off.push(`${s.name} ${k}: world ${JSON.stringify(w[k])}, region ${JSON.stringify(reg[k])}`)
	r[`${s.name}Compared`] = true
}
ui.project = hadProject
prefs.detailInfo = was.detail
r.ok = r.groundOk && r.lakeOk && r.shown && !!r.groundCompared && r.off.length === 0
return r
