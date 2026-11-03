// A game object placed in a region before the world database's spawns for the block arrive (#1083) stays when they do: LoadSpawns is swapped for a stand-in that holds the real reply until the object is placed, then the layer has both the database's spawns and the placed one, the same object its undo step holds, counted as one spawn change; undo takes it away and redo brings it back. Needs the world database (NextObjectGUID, LoadSpawns); nothing is written to it.
// touches: frontend/src/lib/io/region.ts, frontend/src/lib/world/SpawnLayer.ts, frontend/src/lib/engine/SpawnActions.ts
const e = P.e
const { ui } = await P.state()
const region = await P.app('/src/lib/io/region.ts')
const App = window.go.main.App
const realLoad = App.LoadSpawns
let release = null
let asked = false
const out = {}
let doc = null
try {
	App.LoadSpawns = async (...args) => {
		asked = true
		const rows = await realLoad(...args)
		await new Promise((r) => (release = r))
		return rows
	}
	const t = (await App.ListObjectTemplates()).find((x) => x.model)
	if (!t) return { ok: false, why: 'no object template with a model' }
	await region.openWowRegion(e, 'Azeroth', 30, 48, 1)
	doc = e.activeDocument()
	await P.until(() => asked && release, 60_000, 'the stand-in LoadSpawns to hold the reply')
	const layer = doc.spawnLayer
	out.before = layer.spawns.length
	const at = e.controller.target.clone()
	await e.spawnActions.placeObject(t, at)
	const placed = layer.spawns.find((s) => s.kind === 'object' && s.entry === t.entry)
	out.placed = !!placed
	release()
	await P.until(() => layer.spawns.length > 1, 30_000, 'the database spawns to arrive')
	await P.frames(2)
	const key = `${placed.kind}/${placed.guid}`
	out.after = layer.spawns.length
	out.kept = layer.get(key) === placed
	out.changes = ui.spawnChanges
	doc.history.undo()
	out.undone = !layer.get(key) && ui.spawnChanges === 0
	doc.history.redo()
	out.redone = layer.get(key) === placed && layer.editCount() === 1
	out.ok = out.before === 0 && out.placed && out.after > 1 && out.kept && out.changes === 1 && out.undone && out.redone
} finally {
	App.LoadSpawns = realLoad
	release?.()
	if (doc) {
		doc.spawnLayer.markSaved()
		e.closeDocument(doc.id)
	}
}
return out
