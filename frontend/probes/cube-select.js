// Boxes of cubes (#70): in a themed world's tab the Select tool selects a box of cubes by a drag (reaching the Higher layers up), Ctrl+C copies it, the arrows (camera-relative) and PgUp move it as one History step that undo puts back with the selection, Delete empties it, Ctrl+V pastes it into a second world tab under the cursor (a quarter turned with R the second time, its cubes turned with it), every step undoes and redoes, the Edit menu's items name cubes, the stand-in terrain is untouched, and what is drawn in both tabs is what the mesher gives.
const e = P.e
const THREE = await P.app('/deps/three.js')
const mesher = await P.app('/src/lib/cubes/mesher.ts')
const { CubeWorld, GROUND_LAYER, kindId } = await P.app('/src/lib/cubes/world.ts')
const { copyBox, clipCount, turnClip } = await P.app('/src/lib/cubes/clip.ts')
const { editor, ui } = await P.state()

const STONE = kindId('stone')
const WOOD = kindId('wood')
const SLOPE = 2
const UP = GROUND_LAYER - 1
const r = {}

ui.cubeSlice = { mode: 'off', layer: 10 }
e.openWorld(CubeWorld.create(1, 1, true), 'Probe select A', '')
const a = e.activeDocument()
const wa = a.world
await P.until(() => a.cubes.pending === 0, 60_000, 'world A built')
// A small thing to copy: a stone pillar two high at (4, 4), a stone cube at (5, 4) with a wood slope on it.
const { CubeChanges } = await P.app('/src/lib/cubes/edit.ts')
const setup = new CubeChanges(wa)
setup.set(4, 4, UP, STONE)
setup.set(4, 4, UP - 1, STONE)
setup.set(5, 4, UP, STONE)
setup.set(5, 4, UP - 1, WOOD, SLOPE, 0)
a.cubes.rebuild(setup.dirty())
editor.tool = 'select'
editor.cubeBoxExtra = 0
await P.lookAt({ x: 15, y: 3, z: 15 }, { pitch: 1.2, back: 45, yaw: 0 })
e.history.clear()
r.selectInWorld = editor.tool === 'select' && !!e.scene.getObjectByName('cube selection')

/** The viewport share (x, y) where the top face of cube (x, z) of `layer` is seen, at its middle. */
function top(x, z, layer) {
	const v = new THREE.Vector3(x * 3 + 1.5, mesher.layerBottom(layer) + 3, z * 3 + 1.5).project(e.camera)
	return [(v.x + 1) / 2, (1 - v.y) / 2]
}
const key = (k, o = {}) => {
	window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }))
	window.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, ...o }))
}
const steps = () => e.history.steps().length
const text = (w) => JSON.stringify(w.toData().chunks.sort((p, q) => p.layer - q.layer || p.cz - q.cz || p.cx - q.cx))
const box = () => ui.cubeSelection && { ...ui.cubeSelection }
const drawnOk = (d) => {
	const w = d.world
	let want = 0
	for (const k of w.chunks.keys()) want += mesher.triangles(mesher.meshChunk(w, k % w.chunksX, Math.floor(k / w.chunksX) % w.chunksZ, Math.floor(k / (w.chunksX * w.chunksZ))))
	return d.cubes.drawn().triangles === want
}

// A drag from the pillar's top to the ground at (5, 5), one layer higher: the box (4..5, 4..5), layers 7 to 10.
editor.cubeBoxExtra = 1
await P.drag(top(4, 4, UP - 1), top(5, 5, GROUND_LAYER))
await P.frames(1)
r.selected = JSON.stringify(box()) === JSON.stringify({ x0: 4, x1: 5, z0: 4, z1: 5, top: UP - 2, bottom: GROUND_LAYER }) && steps() === 0
// The box to copy: from the ground at (4, 5) (in front of the pillar, seen from the camera) to the slope on (5, 4) (layer 8), two layers higher: (4..5, 4..5), layers 6 to 10.
editor.cubeBoxExtra = 2
await P.drag(top(4, 5, GROUND_LAYER), top(5, 4, UP - 1))
await P.frames(1)
const sel = box()
r.reselected = !!sel && sel.x0 === 4 && sel.x1 === 5 && sel.z0 === 4 && sel.z1 === 5 && sel.top === UP - 3 && sel.bottom === GROUND_LAYER
// Ctrl+C through the window's keys.
key('c', { ctrlKey: true })
r.copied = ui.hasCubeClip
const before = text(wa)
const copied = copyBox(wa, sel)

// The arrows move it a column the way the camera faces (yaw 0: up is -z, right is +x), PgUp a layer: one step.
const target = e.controller.target.clone()
key('ArrowRight')
key('ArrowUp')
key('PageUp')
await P.frames(1)
const moved = box()
r.moved = wa.get(6, 3, UP - 1).kind === STONE && wa.get(6, 3, UP - 2).shape === SLOPE && wa.get(4, 4, UP).kind === 0 && wa.get(4, 4, UP - 1).kind === 0 && steps() === 1
r.selectionMoved = moved.x0 === 5 && moved.z0 === 3 && moved.top === UP - 4
// The ground cubes the box held moved up a layer too, and the hole they left is empty.
r.groundMoved = wa.get(4, 5, GROUND_LAYER).kind === 0 && wa.get(5, 4, UP).kind !== 0 && wa.get(5, 4, UP).kind !== STONE
r.cameraStill = e.controller.target.distanceTo(target) < 1e-6
e.undo()
await P.frames(1)
r.moveUndone = text(wa) === before && JSON.stringify(box()) === JSON.stringify(sel)
e.redo()
await P.frames(1)
r.moveRedone = JSON.stringify(box()) === JSON.stringify(moved) && wa.get(6, 3, UP - 1).kind === STONE
e.undo()
await P.frames(1)
r.drawnA = drawnOk(a)

// Delete empties the box; undo puts it back.
key('Delete')
await P.frames(1)
r.deleted = clipCount(copyBox(wa, sel)) === 0 && steps() === 1
e.undo()
await P.frames(1)
r.deleteUndone = text(wa) === before
// Deleted again, so world A's tab is edited and the next world opens beside it, not in its place.
e.redo()
await P.frames(1)
const aBefore = text(wa)

// The Edit menu names cubes in a world tab.
const menu = [...document.querySelectorAll('.menubar .title')].find((b) => b.textContent.trim() === 'Edit')
menu?.click()
await P.frames(1)
const labels = [...document.querySelectorAll('.menubar .dropdown .item')].map((x) => x.textContent)
r.menu = labels.some((l) => l.includes('Copy Cubes')) && labels.some((l) => l.includes('Paste Cubes')) && labels.some((l) => l.includes('Delete Selected Cubes'))
menu?.click()
await P.frames(1)

// A second world tab, empty: Ctrl+V pastes under the cursor, on the ground layer's bottom.
e.openWorld(CubeWorld.create(1, 1, false), 'Probe select B', '')
const b = e.activeDocument()
const wb = b.world
await P.until(() => b.cubes.pending === 0, 60_000, 'world B built')
await P.lookAt({ x: 24, y: 3, z: 24 }, { pitch: 1.2, back: 45, yaw: 0 })
editor.tool = 'select'
await P.frames(1)
r.noSelectionInB = ui.cubeSelection === null
key('v', { ctrlKey: true })
await P.frames(1)
r.pasting = ui.cubePasting
// The cursor over the cell (8, 8) of the ground layer: the clip (2 x 2 x 5) goes from (8, 8), its bottom on layer 10.
const floor = (x, z) => {
	const v = new THREE.Vector3(x * 3 + 1.5, mesher.layerBottom(GROUND_LAYER), z * 3 + 1.5).project(e.camera)
	return [(v.x + 1) / 2, (1 - v.y) / 2]
}
await P.click(...floor(8, 8))
const pasted = box()
r.pasted = !ui.cubePasting && !!pasted && pasted.x0 === 8 && pasted.z0 === 8 && pasted.bottom === GROUND_LAYER && b.history.steps().length === 1
let same = true
const got = copyBox(wb, pasted)
for (let i = 0; i < copied.cubes.length; i++) if ((copied.cubes[i] & 0xff) && got.cubes[i] !== copied.cubes[i]) same = false
r.pastedSame = same && clipCount(got) === clipCount(copied)
r.aKept = text(wa) === aBefore
const afterPaste = text(wb)
e.undo()
r.pasteUndone = clipCount(copyBox(wb, pasted)) === 0
e.redo()
r.pasteRedone = text(wb) === afterPaste

// R turns the next paste a quarter: its cubes turned with it.
key('v', { ctrlKey: true })
key('r')
await P.click(...floor(2, 12))
const turned = box()
const want = turnClip(copied)
const t = copyBox(wb, turned)
let turnSame = turned.x1 - turned.x0 + 1 === want.w && turned.z1 - turned.z0 + 1 === want.d
for (let i = 0; i < want.cubes.length; i++) if ((want.cubes[i] & 0xff) && t.cubes[i] !== want.cubes[i]) turnSame = false
r.turned = turnSame && b.history.steps().length === 2
r.drawnB = drawnOk(b)
P.save(await P.shot(), 'pasted')

// Back in world A its own selection is shown again.
e.switchDocument(a.id)
await P.frames(2)
r.selectionPerTab = e.activeDocument() === a && JSON.stringify(box()) === JSON.stringify(sel)

e.closeDocument(b.id)
e.closeDocument(a.id)
editor.cubeBoxExtra = 0
editor.tool = 'select'
return { ok: Object.values(r).every(Boolean), ...r }
