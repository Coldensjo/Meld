// Tilting by hand (#344): with Z held the wheel tilts the Place tool's preview (Shift: rolls) 5° a notch, the camera keeping still; the next click places the model with that tilt over Random tilt; with the model selected Z+scroll tilts it as one undo step; scrolling the preview back to 0 hands the tilt back to Random tilt; with Z released the wheel no longer tilts.
// touches: frontend/src/lib/tools/ObjectTools.ts, frontend/src/lib/world/placement.ts, frontend/src/lib/world/groundTilt.ts
const e = P.e
const { editor } = await P.state()
const { selectObjects } = await P.app('/src/lib/state/selection.ts')
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'place'
editor.prefab = 'helper:cube:8'
editor.placeRandomTilt = false
editor.placeRandomRot = false
editor.followGround = true
editor.placeScatter = false
selectObjects(e.objects, [])
await P.frames(1)
const h0 = e.terrain.heightAt(128, 128)
await P.lookAt({ x: 128, y: h0, z: 128 }, { pitch: 1.1, back: 120 })
const canvas = e.renderer.domElement
const zKey = (type) => window.dispatchEvent(new KeyboardEvent(type, { key: 'z', code: 'KeyZ', bubbles: true }))
const wheel = (notches, shiftKey = false) => {
	for (let i = 0; i < Math.abs(notches); i++) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 * Math.sign(notches), shiftKey, bubbles: true }))
}
const deg = (r) => Math.round(((r ?? 0) * 1800) / Math.PI) / 10
const bad = []
const L = e.objects

// The preview: 3 notches of tilt, 1 of roll; the camera stays where it was.
const cam0 = e.camera.position.clone()
zKey('keydown')
wheel(3)
wheel(1, true)
await P.frames(2)
if (e.camera.position.distanceTo(cam0) > 1e-6) bad.push('the camera moved while Z was held')
const before = new Set(L.objects.keys())
editor.placeRandomTilt = true // a hand tilt wins over it
await P.click(0.5, 0.5, {}, 2)
const placed = [...L.objects.values()].find((o) => !before.has(o.id))
if (!placed) bad.push('no model placed')
else if (deg(placed.tiltX) !== 15 || deg(placed.tiltZ) !== 5) bad.push(`placed with tilt ${deg(placed.tiltX)}, roll ${deg(placed.tiltZ)}; want 15, 5`)

// The placed model is selected: Z+scroll tilts it, a burst is one undo step.
const pos0 = e.history.position
wheel(-2)
wheel(-1, true)
await P.frames(1)
const o = placed && L.objects.get(placed.id)
if (o && (deg(o.tiltX) !== 5 || deg(o.tiltZ) !== 0)) bad.push(`selected tilted to ${deg(o.tiltX)}, ${deg(o.tiltZ)}; want 5, 0`)
if (e.history.position !== pos0 + 1) bad.push(`the burst took ${e.history.position - pos0} undo steps`)
if (editor.selected && deg(editor.selected.tiltX) !== 5) bad.push('the Inspector copy did not follow')
e.undo()
await P.frames(1)
if (o && (deg(o.tiltX) !== 15 || deg(o.tiltZ) !== 5)) bad.push(`undo left ${deg(o.tiltX)}, ${deg(o.tiltZ)}`)

// Flipped all the way round: 36 notches more wraps through 180.
wheel(36)
await P.frames(1)
if (o && deg(o.tiltX) !== -165) bad.push(`after 36 notches more the tilt is ${deg(o.tiltX)}, want -165`)

// Nothing selected: scroll the preview back to upright, and Random tilt applies again.
selectObjects(L, [])
wheel(-3)
wheel(-1, true)
await P.frames(1)
const before2 = new Set(L.objects.keys())
await P.click(0.5, 0.5, {}, 2)
const random = [...L.objects.values()].find((x) => !before2.has(x.id))
if (!random) bad.push('no second model placed')
else if (Math.abs(deg(random.tiltX)) > 8 || Math.abs(deg(random.tiltZ)) > 8 || (random.tiltX === undefined && random.tiltZ === undefined)) bad.push(`second model tilt ${deg(random.tiltX)}, ${deg(random.tiltZ)}; want Random tilt's`)

// Z released: the wheel is the camera's again and tilts nothing.
zKey('keyup')
const t0 = random && L.objects.get(random.id).tiltX
wheel(2)
await P.frames(1)
if (random && L.objects.get(random.id).tiltX !== t0) bad.push('the wheel tilted with Z released')
editor.placeRandomTilt = false
return { ok: bad.length === 0, bad }
