// Undoing a placement with the cursor still over the model (#719): with the Place tool on a bumpy map and Fit ground on, a click places an 8 yd helper cube with the ground fitted under it in one undo step, and Ctrl+Z (`e.undo()`) takes both away while the next frames run without a throw (the preview's surface raycast met the removed model's instance, still in its batch until ObjectLayer.update, and threw every frame, so the view froze until the cursor left it), the ground comes back exactly, and the undo and its first frame take under 100 ms of script.
// touches: frontend/src/lib/world/ObjectLayer.ts, frontend/src/lib/tools/ObjectTools.ts, frontend/src/lib/engine/Engine.ts
const e = P.e
const { editor, prefs } = await P.state()
const { selectObjects } = await P.app('/src/lib/state/selection.ts')
const before = { fit: prefs.placeFitGround, tool: editor.tool, prefab: editor.prefab, tilt: editor.placeRandomTilt, rot: editor.placeRandomRot, follow: editor.followGround, scatter: editor.placeScatter }
const bad = []
const r = {}
try {
	e.newDocument(256, 'flat', 0, 'Probe place undo')
	const t = e.terrain
	const V = t.verts
	for (let z = 0; z < V; z++) for (let x = 0; x < V; x++) t.heights[z * V + x] += 3 * Math.sin(x / 3) * Math.cos(z / 4)
	t.markDirty(0, 0, V - 1, V - 1)
	const heights0 = t.heights.slice()
	prefs.placeFitGround = true
	editor.tool = 'place'
	editor.prefab = 'helper:cube:8'
	editor.placeRandomTilt = false
	editor.placeRandomRot = false
	editor.followGround = false
	editor.placeScatter = false
	selectObjects(e.objects, [])
	await P.frames(1)
	await P.lookAt({ x: 128, y: t.heightAt(128, 128), z: 128 }, { pitch: 0.9, back: 60 })
	await P.frames(2)
	const pos0 = e.history.position
	await P.click(0.5, 0.5, {}, 2)
	r.label = e.history.peek()?.label
	if (e.history.position !== pos0 + 1) bad.push(`the placement took ${e.history.position - pos0} undo steps`)
	if (r.label !== 'Place and fit ground') bad.push(`the step is "${r.label}", not "Place and fit ground"`)
	if (e.objects.objects.size !== 1) bad.push(`${e.objects.objects.size} models after the click`)
	await P.frames(2)
	let threw = null
	try {
		const t0 = performance.now()
		e.undo()
		e.frame()
		r.undoMs = Math.round(performance.now() - t0)
		await P.drawn()
		await P.frames(3)
	} catch (err) {
		threw = String(err)
	}
	if (threw) bad.push(`a frame after the undo threw: ${threw}`)
	if (e.objects.objects.size !== 0) bad.push(`${e.objects.objects.size} models after the undo`)
	let diff = 0
	for (let i = 0; i < heights0.length; i++) if (t.heights[i] !== heights0[i]) diff++
	if (diff) bad.push(`${diff} heights differ after the undo`)
	if (!threw && !(r.undoMs < 100)) bad.push(`the undo and its frame took ${r.undoMs} ms of script`)
} finally {
	prefs.placeFitGround = before.fit
	editor.prefab = before.prefab
	editor.placeRandomTilt = before.tilt
	editor.placeRandomRot = before.rot
	editor.followGround = before.follow
	editor.placeScatter = before.scatter
	editor.tool = before.tool
	await P.frames(1)
}
r.bad = bad
r.ok = !bad.length
return r
