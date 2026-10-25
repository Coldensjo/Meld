// The hover outline (#641): with the Select tool, the helper cube under the pointer gets the faint stroke (what a click would pick), off the cube it clears, a selected cube gets none, a still pointer and camera pick nothing again, and View › Hover outline off or another tool draws nothing.
// touches: frontend/src/lib/engine/SelectionOutline.ts, frontend/src/lib/tools/ObjectTools.ts, frontend/src/lib/state/selection.ts
const e = P.e
const { editor, prefs } = await P.state()
const { selectObjects } = await P.app('/src/lib/state/selection.ts')
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'select'
prefs.hoverOutline = true
await P.frames(1)
const V3 = e.controller.target.constructor
const h0 = e.terrain.heightAt(128, 128)
await P.lookAt({ x: 128, y: h0, z: 128 }, { pitch: 1.1, back: 120 })
/** Where a world point is on the viewport, as shares of it (y = 0 the top). */
const share = (x, y, z) => {
	const v = new V3(x, y, z).project(e.camera)
	return [(v.x + 1) / 2, (1 - v.y) / 2]
}
const L = e.objects
const a = L.add({ type: 'helper:cube:8', x: 110, z: 128, yOff: 0, rotY: 0, scale: 1 })
const b = L.add({ type: 'helper:cube:8', x: 146, z: 128, yOff: 0, rotY: 0, scale: 1 })
await P.frames(2)
const bad = []
/** Moves the pointer to `at` and checks what the hover outline shows after two frames. */
const hover = async (label, at, want) => {
	P.pointer('pointermove', ...at)
	await P.frames(2)
	const got = e.hovered.id
	const drawn = e.hoverOutline.active
	if (got !== want || drawn !== (want !== null)) bad.push(`${label}: hovered ${got} drawn ${drawn}, want ${want}`)
}
const overA = share(110, h0 + 4, 128)
const overB = share(146, h0 + 4, 128)
const ground = share(128, h0, 90)
await hover('over a', overA, a.id)
await hover('off the cubes', ground, null)
await hover('over b', overB, b.id)

// A still pointer and camera: no pick at all.
let picks = 0
const pickHit = L.pickHit
L.pickHit = function (...args) {
	picks++
	return pickHit.apply(this, args)
}
await P.frames(10)
L.pickHit = pickHit
if (picks) bad.push(`still: ${picks} picks in 10 frames`)

// The selected cube gets no hover stroke; the other still does.
selectObjects(L, [a.id], a.id)
await hover('over selected a', overA, null)
await hover('over b with a selected', overB, b.id)
selectObjects(L, [], undefined)

// The pref off, then another tool: nothing drawn.
prefs.hoverOutline = false
await P.frames(1)
await hover('pref off', overB, null)
prefs.hoverOutline = true
await hover('pref on again', overA, a.id)
editor.tool = 'sculpt'
await P.frames(1)
await hover('sculpt tool', overA, null)
editor.tool = 'select'
await P.frames(1)
await hover('select again', overA, a.id)
return { ok: bad.length === 0, bad }
