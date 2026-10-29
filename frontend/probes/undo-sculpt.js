// A scripted Raise stroke on a flat map changes the heights, undo puts them back exactly, redo redoes it. Then cutting holes in a selected area cuts whole 2x2 blocks, and one undo fills them again (once the probe undo-holes).
// touches: frontend/src/lib/tools/TerrainTools.ts, frontend/src/lib/state/history.ts, frontend/src/lib/state/historyCore.ts, frontend/src/lib/terrain/holes.ts
// tier: smoke
const e = P.e
const { editor } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'sculpt'
await P.frames(1)
editor.sculptMode = 'raise'
editor.brush.radius = 14
editor.brush.strength = 1
const V3 = e.controller.target.constructor
const at = (x, z) => new V3(x, e.terrain.heightAt(x, z), z)
const before = Float32Array.from(e.terrain.heights)
const tool = e.debug.tools.sculpt
tool.onDown(e.debug.ctx, at(200, 200))
for (let i = 0; i < 40; i++) tool.tick(e.debug.ctx, 0.05, at(200 + i, 200))
tool.onUp(e.debug.ctx)
await P.frames(1)
const after = Float32Array.from(e.terrain.heights)
const diff = (a, b) => {
	let n = 0
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
	return n
}
const changed = diff(before, after)
e.history.undo()
await P.frames(1)
const undone = diff(before, e.terrain.heights)
e.history.redo()
await P.frames(1)
const redone = diff(after, e.terrain.heights)
// Holes in a selection: cells 9..13 on both axes snap out to the 2x2 blocks 8..13, so 6x6 = 36 cells.
editor.selection = { x0: 9, z0: 9, x1: 14, z1: 14 }
e.setHoleInSelection(true)
await P.frames(1)
const holeCount = () => e.terrain.holes.reduce((n, v) => n + (v ? 1 : 0), 0)
const size = e.terrain.size
const holes = { cutCells: holeCount(), blocksWhole: e.terrain.holes[8 * size + 8] !== 0 && e.terrain.holes[13 * size + 13] !== 0 }
e.history.undo()
await P.frames(1)
holes.afterUndo = holeCount()
editor.selection = null
return {
	ok: changed > 0 && undone === 0 && redone === 0 && holes.cutCells === 36 && holes.blocksWhole && holes.afterUndo === 0,
	holes,
	changedVertices: changed,
	afterUndo: undone,
	afterRedo: redone,
	peak: Math.max(...after),
}
