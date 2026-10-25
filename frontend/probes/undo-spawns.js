// Undoing and redoing a Spawn brush stroke of 60 creatures on Elwynn's 1398 spawns redraws the spawn layer once, not once a creature (#193); needs the world database.
// touches: frontend/src/lib/tools/SpawnBrushTool.ts, frontend/src/lib/world/spawnEdits.ts, frontend/src/lib/world/SpawnLayer.ts, frontend/src/lib/engine/SpawnActions.ts
const e = P.e
const se = await P.app('/src/lib/world/spawnEdits.ts')
const App = window.go.main.App
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const loaded = await App.LoadSpawns('Azeroth', 30, 48, 1)
const count = loaded.length
const layer = e.activeDocument().spawnLayer
layer.set(loaded)
se.syncSpawnUi(layer, true)
await P.frames(2)
const look = { model: '', look: '', anim: 0, displayScale: 1 }
const t = { entry: 38, name: 'Defias Thug', subname: '', levelMin: 5, levelMax: 5, faction: 14, npcFlags: 0, rank: 0, type: 7, display: 0, scale: 1, equipment: 0, model: '', look: '', displayScale: 1 }
const cmds = []
for (let i = 0; i < 60; i++) cmds.push(se.spawnAdd(layer, se.newCreatureSpawn(t, 9_100_000 + i, 100 + i, 0, 100, 0, look), 'x'))
// The same two closures the Spawn brush pushes (SpawnBrushTool.onUp).
e.history.push({
	label: 'brush',
	undo: () =>
		se.spawnsBatch(layer, () => {
			for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo()
		}),
	redo: () => se.spawnsBatch(layer, () => cmds.forEach((c) => c.redo())),
})
await P.frames(2)
const v0 = layer.version
const a = performance.now()
e.undo()
const undoMs = performance.now() - a
const redraws = layer.version - v0
const gone = layer.spawns.length === count
const v1 = layer.version
e.redo()
const redoRedraws = layer.version - v1
return { ok: gone && redraws <= 2 && redoRedraws <= 2 && layer.spawns.length === count + 60, spawns: count, undoMs: +undoMs.toFixed(1), redraws, redoRedraws }
