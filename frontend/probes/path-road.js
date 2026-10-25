// Path tool (#167): clicks drop a road's points, a click on a point picks it and Shift+drag raises it, Apply levels and paints along the curve as one undo step, and applying again after an edit takes the first apply back.
// touches: frontend/src/lib/tools/PathTool.ts, frontend/src/lib/tools/pathApply.ts, frontend/src/lib/terrain/paths.ts, frontend/src/components/PathEditBar.svelte
// tier: smoke
const e = P.e
const { editor } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'path'
await P.frames(1)
const V3 = e.controller.target.constructor
const h0 = e.terrain.heightAt(256, 256)
await P.lookAt({ x: 256, y: h0, z: 256 }, { pitch: 1.3, back: 260 })
/** Where a world point is on the viewport, as shares of it (y = 0 the top). */
const share = (x, y, z) => {
	const v = new V3(x, y, z).project(e.camera)
	return [(v.x + 1) / 2, (1 - v.y) / 2]
}
const close = (a, b, d = 0.05) => Math.abs(a - b) <= d

for (const [x, z] of [
	[190, 256],
	[256, 290],
	[322, 256],
])
	await P.click(...share(x, h0, z))
const drawn = editor.paths.length === 1 && editor.paths[0].points.length === 3
const steps = e.history.steps().map((s) => s.label)

// A click on the middle point picks it rather than adding one; Shift+drag up raises it.
const mid = editor.paths[0].points[1]
const at = share(mid.x, mid.y, mid.z)
await P.click(...at)
const picked = editor.pathPoint === 1 && editor.paths[0].points.length === 3
await P.drag(at, [at[0], at[1] - 0.1], 8, { shiftKey: true, movementY: -10 })
const raised = editor.paths[0].points[1].y - h0

const slot = e.useTexture('#a08050')
e.path((t, c) => t.setField(c, 'texture', editor.palette[slot]))
e.path((t, c) => t.setField(c, 'width', 10))
e.path((t, c) => t.apply(c))
await P.frames(1)
const t = e.terrain
const hump = t.heightAt(256, 290) - h0
const R = t.splatRes
const texel = Math.floor(290 / (t.worldSize / R)) * R + Math.floor(256 / (t.worldSize / R))
const chunk = Math.floor(texel / R / (R / t.paintChunksPerSide)) * t.paintChunksPerSide + Math.floor((texel % R) / (R / t.paintChunksPerSide))
const k = [...t.chunkSlots.slice(chunk * 4, chunk * 4 + 4)].indexOf(slot)
const painted = k >= 0 ? t.weights[texel * 4 + k] : 0
const offRoad = t.heightAt(256, 330) - h0
P.save(await P.shot(), 'applied')

// Deleting the raised point and applying again leaves a straight, level road: the hump goes.
editor.pathPoint = 1
e.path((t2, c) => t2.deletePoint(c))
e.path((t2, c) => t2.apply(c))
await P.frames(1)
const humpAfter = t.heightAt(256, 290) - h0
const lineAfter = t.heightAt(256, 256) - h0
const labels = e.history
	.steps()
	.map((s) => s.label)
	.slice(-2)
e.history.undo()
e.history.undo()
await P.frames(1)
const humpUndone = t.heightAt(256, 290) - h0
e.history.undo()
await P.frames(1)
const flatAgain = t.heightAt(256, 290) - h0
// The paths travel to the map file and back through mapData.ts (the Go side's round trip is mapfile_test).
const mapData = await P.app('/src/lib/io/mapData.ts')
const back = mapData.fromMapData(JSON.parse(JSON.stringify(mapData.toMapData(e.snapshot())))).paths
const saved = back.length === 1 && back[0].points.length === editor.paths[0].points.length && back[0].width === 10 && back[0].texture === editor.palette[slot]
return {
	ok: drawn && picked && raised > 5 && hump > 4 && painted > 200 && close(offRoad, 0) && close(humpAfter, 0) && close(lineAfter, 0) && close(humpUndone, hump) && close(flatAgain, 0) && saved && labels[1] === 'Apply Road 1 again',
	drawn,
	steps,
	picked,
	raised,
	hump,
	painted,
	offRoad,
	humpAfter,
	lineAfter,
	labels,
	humpUndone,
	flatAgain,
	saved,
}
