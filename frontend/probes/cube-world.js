// Cube worlds (#29): Open reads the world format's fixture (crates/world/tests/fixtures/small.world) into a tab of its own with the cubes the doc lists, Save writes it as a .world file through Go, and that file opens again as the same world; Revert reloads it in its tab; New Cube World makes a themed world. Paths are relative to the Go process, which runs in editor/.
const e = P.e
const App = window.go?.main?.App
if (!App?.LoadWorld) throw new Error('no Go bindings on the page (cube worlds need the backend)')
const mapio = await P.app('/src/lib/io/mapio.ts')
const { editor } = await P.state()

const FIXTURE = '../crates/world/tests/fixtures/small.world'
const OUT = 'build/bin/probe-cube-world.world'

await mapio.openPath(e, FIXTURE)
await P.frames(2)
const d = e.activeDocument()
const w = d.world
const r = { opened: !!w, name: editor.mapName === 'small', filePath: editor.filePath === FIXTURE }
if (!w) return { ok: false, ...r }
const eq = (c, k, s, rot) => c.kind === k && c.shape === s && c.rotation === rot
r.cubes = w.chunksX === 2 && w.chunkCount === 6 &&
	eq(w.get(0, 0, 20), 2, 0, 0) && eq(w.get(31, 15, 20), 2, 0, 0) && eq(w.get(16, 16, 25), 7, 0, 0) &&
	eq(w.get(3, 4, 10), 2, 2, 1) && eq(w.get(5, 6, 10), 4, 3, 6) && eq(w.get(20, 20, 9), 4, 1, 4) && eq(w.get(9, 2, 9), 2, 7, 0) && eq(w.get(11, 2, 9), 2, 8, 0) && eq(w.get(1, 1, 10), 4, 6, 3) && eq(w.get(2, 2, 10), 0, 0, 0)

// Save to a new file (Save writes to the tab's path), then open that file next to it.
editor.filePath = OUT
await mapio.saveMap(e)
r.saved = editor.filePath === OUT && !editor.dirty
const before = JSON.stringify(w.toData())
e.closeDocument(d.id)
await mapio.openPath(e, OUT)
await P.frames(2)
const again = e.activeDocument().world
r.reopened = !!again && JSON.stringify(again.toData()) === before

// Revert keeps the tab and reads the file again.
const id = e.activeDocumentId()
const tabs = e.documents.length
await mapio.revertMap(e)
r.reverted = e.documents.length === tabs && !!e.activeDocument().world && e.activeDocumentId() !== id

// New Cube World: a themed world in a new tab.
const { CubeWorld } = await P.app('/src/lib/cubes/world.ts')
e.openWorld(CubeWorld.create(4, 2, true), 'Probe world', '')
await P.frames(2)
const n = e.activeDocument().world
r.created = !!n && n.chunksX === 4 && n.get(10, 10, 18).kind === 2 && n.get(10, 10, 5).kind === 0 && editor.filePath === ''
return { ok: Object.values(r).every(Boolean), ...r }
