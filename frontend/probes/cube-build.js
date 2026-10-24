// Building with cubes (#31): the Cubes tool, driven by clicks on the viewport of a themed world, puts a cube on the ground and removes it (Ctrl+click), fills a box for a small house and empties its top (Ctrl+drag in Box mode), replaces a cube with another shape, copies a cube with Alt+click, leaves the metal layers alone, undoes and redoes each step through History, draws what the mesher gives after the edits, and the world saved and opened again holds the house. Paths are relative to the Go process, which runs in editor/.
const e = P.e
const App = window.go?.main?.App
if (!App?.SaveWorld) throw new Error('no Go bindings on the page (cube worlds need the backend)')
const THREE = await P.app('/deps/three.js')
const mapio = await P.app('/src/lib/io/mapio.ts')
const mesher = await P.app('/src/lib/cubes/mesher.ts')
const { CubeWorld, kindId } = await P.app('/src/lib/cubes/world.ts')
const { editor, ui } = await P.state()

const OUT = 'build/bin/probe-cube-build.world'
const STONE = kindId('stone')
const WOOD = kindId('wood')
const SLOPE = 2
const r = {}

ui.cubeSlice = { mode: 'off', layer: 10 }
e.openWorld(CubeWorld.create(1, 1, true), 'Probe build', '')
const d = e.activeDocument()
const w = d.world
await P.until(() => d.cubes.pending === 0, 60_000, 'the world built')
editor.tool = 'cube'
editor.cubeMode = 'place'
editor.cubeKind = STONE
editor.cubeShape = 0
editor.cubeRotation = 0
editor.cubeBoxExtra = 0
await P.lookAt({ x: 24, y: 3, z: 24 }, { pitch: 1.25, back: 45 })
e.history.clear()

/** The viewport share (x, y) where the top face of cube (x, z) of `layer` is seen, at its middle. */
function top(x, z, layer) {
	const v = new THREE.Vector3(x * 3 + 1.5, mesher.layerBottom(layer) + 3, z * 3 + 1.5).project(e.camera)
	return [(v.x + 1) / 2, (1 - v.y) / 2]
}
const at = (x, z, layer) => w.get(x, z, layer)
/** A world's cubes as text, its chunks in key order (a reopened world stores them in the file's order). */
const text = (world) => JSON.stringify({ ...world.toData(), chunks: world.toData().chunks.sort((a, b) => a.layer - b.layer || a.cz - b.cz || a.cx - b.cx) })
const steps = () => e.history.steps().length

// Place: a stone cube on the ground's top, one undo step; undo and redo.
await P.click(...top(5, 5, 10))
r.placed = at(5, 5, 9).kind === STONE && steps() === 1 && editor.dirty
e.undo()
r.placeUndone = at(5, 5, 9).kind === 0
e.redo()
r.placeRedone = at(5, 5, 9).kind === STONE
// Ctrl+click removes it.
await P.click(...top(5, 5, 9), { ctrlKey: true })
r.removed = at(5, 5, 9).kind === 0 && steps() === 2

// Box: wood from (2, 2) to (7, 7) on the ground, three layers high, then its top layer's middle emptied.
editor.cubeMode = 'box'
editor.cubeKind = WOOD
editor.cubeBoxExtra = 2
await P.drag(top(2, 2, 10), top(7, 7, 10))
let walls = 0
for (let l = 7; l <= 9; l++) for (let z = 2; z <= 7; z++) for (let x = 2; x <= 7; x++) walls += at(x, z, l).kind === WOOD ? 1 : 0
r.boxFilled = walls === 108 && at(1, 1, 9).kind === 0 && at(2, 2, 6).kind === 0 && steps() === 3
editor.cubeBoxExtra = 0
await P.drag(top(3, 3, 7), top(6, 6, 7), 8, { ctrlKey: true })
r.roofOpened = at(3, 3, 7).kind === 0 && at(6, 6, 7).kind === 0 && at(2, 3, 7).kind === WOOD && at(3, 3, 8).kind === WOOD && steps() === 4

// Replace: a corner of the house becomes a stone slope turned a quarter (R), upside down undone (Shift+R twice).
editor.cubeMode = 'replace'
editor.cubeKind = STONE
editor.cubeShape = SLOPE
e.handleToolKey(new KeyboardEvent('keydown', { key: 'r' }))
e.handleToolKey(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }))
e.handleToolKey(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }))
await P.click(...top(2, 2, 7))
const c = at(2, 2, 7)
r.replaced = c.kind === STONE && c.shape === SLOPE && c.rotation === 1 && steps() === 5

// Alt+click copies a cube: the wood wall.
editor.cubeShape = 0
editor.cubeRotation = 0
await P.click(...top(4, 2, 7), { altKey: true })
r.copied = editor.cubeKind === WOOD && editor.cubeShape === 0 && steps() === 5

// The metal layers: with the slice showing layer 26 and below, Remove leaves the metal be.
editor.cubeMode = 'remove'
ui.cubeSlice = { mode: 'below', layer: 26 }
await P.frames(1)
await P.click(...top(8, 8, 26))
r.metalKept = at(8, 8, 26).kind === kindId('metal') && steps() === 5
ui.cubeSlice = { mode: 'off', layer: 10 }
await P.frames(1)

// What is drawn is what the mesher gives for the edited world.
let want = 0
for (const key of w.chunks.keys()) want += mesher.triangles(mesher.meshChunk(w, key % w.chunksX, Math.floor(key / w.chunksX) % w.chunksZ, Math.floor(key / (w.chunksX * w.chunksZ))))
r.drawnMatches = d.cubes.drawn().triangles === want
P.save(await P.shot(), 'house')

// Undo everything and back again.
const house = text(w)
e.history.goTo(0)
r.allUndone = at(2, 2, 9).kind === 0 && at(5, 5, 9).kind === 0
e.history.goTo(steps())
r.allRedone = text(w) === house

// Saved and opened again.
editor.filePath = OUT
await mapio.saveMap(e)
r.saved = editor.filePath === OUT && !editor.dirty
e.closeDocument(d.id)
await mapio.openPath(e, OUT)
await P.frames(2)
const again = e.activeDocument().world
r.reopened = !!again && text(again) === house
editor.tool = 'select'
return { ok: Object.values(r).every(Boolean), ...r }
