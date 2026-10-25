// A scripted Raise stroke on a flat map changes the heights, undo puts them back exactly, redo redoes it.
// touches: frontend/src/lib/tools/TerrainTools.ts, frontend/src/lib/state/history.ts, frontend/src/lib/state/historyCore.ts
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
const tool = e.tools.sculpt
tool.onDown(e.ctx, at(200, 200))
for (let i = 0; i < 40; i++) tool.tick(e.ctx, 0.05, at(200 + i, 200))
tool.onUp(e.ctx)
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
return {
	ok: changed > 0 && undone === 0 && redone === 0,
	changedVertices: changed,
	afterUndo: undone,
	afterRedo: redone,
	peak: Math.max(...after),
}
