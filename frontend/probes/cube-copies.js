// Cube worlds' recovery and scene copies and their tools (#65): an edited world tab gets an autosaved recovery copy as a .world file that loads back with the edit and is recovered into a tab with unsaved changes; Copy Scene writes the dirty world to a .world copy in the cache that the scene opens again as an untitled world with the edit; the toolbar shows only the Select and Cubes tools (#70), and the menu bar has no Terrain menu.
const e = P.e
const { editor, prefs } = await P.state()
const App = window.go?.main?.App
if (!App?.SaveRecoveryWorld) throw new Error('no Go bindings on the page (the copies need the backend)')
const rec = await P.app('/src/lib/io/recovery.ts')
const scene = await P.app('/src/lib/io/scene.ts')
const { CubeWorld, kindId } = await P.app('/src/lib/cubes/world.ts')
const { CubeChanges, chunksAround } = await P.app('/src/lib/cubes/edit.ts')
const r = {}

editor.tool = 'cube'
e.openWorld(CubeWorld.create(2, 2, true), 'Probe copies', '')
await P.frames(2)
const d = e.activeDocument()
const w = d.world
const buttons = [...document.querySelectorAll('.toolbar button')].map((b) => b.getAttribute('aria-label'))
r.toolbar = buttons.length === 2 && buttons.includes('Select') && buttons.includes('Cubes')
const titles = [...document.querySelectorAll('.menubar .title')].map((b) => b.textContent.trim())
r.noTerrainMenu = !titles.includes('Terrain') && titles.includes('File')

// An edit through History, so the tab is dirty.
const wood = kindId('wood')
const ch = new CubeChanges(w)
ch.set(5, 6, 10, wood)
const rebuild = () => d.cubes.rebuild(chunksAround(w, 5, 6, 10))
e.history.push({ label: 'probe cube', undo: () => { ch.undo(); rebuild() }, redo: () => { ch.redo(); rebuild() } })
rebuild()
r.dirty = e.isDirty(d.id)

// Autosave: a .world copy.
const saves = []
const save = App.SaveRecoveryWorld
App.SaveRecoveryWorld = async (...args) => {
	const out = await save(...args)
	saves.push({ docId: args[0], info: out })
	return out
}
const oldMinutes = prefs.autosaveMinutes
try {
	prefs.autosaveMinutes = 0.0001
	await rec.autosave(e)
	await new Promise((ok) => setTimeout(ok, 50))
	await rec.autosave(e)
} finally {
	App.SaveRecoveryWorld = save
	prefs.autosaveMinutes = oldMinutes
}
const mine = saves.filter((s) => s.docId === d.id)
r.copied = mine.length === 1 && mine[0].info.world === true
if (mine.length) {
	const back = CubeWorld.fromData(await App.LoadRecoveryWorld(mine[0].info.id))
	r.copyHasEdit = back.get(5, 6, 10).kind === wood && back.chunksX === 2
	// Recovering it opens a world with unsaved changes (here a second tab: this one is dirty).
	const tabs = e.documents.length
	await rec.recover(e, mine[0].info)
	await P.frames(2)
	const got = e.activeDocument()
	r.recovered = e.documents.length === tabs + 1 && !!got.world && got.world.get(5, 6, 10).kind === wood && editor.dirty
	e.closeDocument(got.id)
	e.switchDocument(d.id)
	await P.frames(2)
}

// Copy Scene: the dirty world goes to a .world copy, which the scene opens again.
const text = await scene.sceneText(e)
const ref = JSON.parse(text.slice(text.indexOf('{'))).map
r.sceneCopy = ref.copy === true && /\.world$/i.test(ref.file)
await scene.loadScene(e, text)
await P.frames(2)
const s = e.activeDocument()
r.sceneLoaded = s !== d && !!s.world && s.world.get(5, 6, 10).kind === wood && editor.filePath === ''
e.closeDocument(s.id)

e.closeDocument(d.id)
return { ok: Object.values(r).every(Boolean), ...r }
