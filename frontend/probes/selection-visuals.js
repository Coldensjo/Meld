// The selection's outline colour and warn boxes (#551): on objects-mixed with 16 floating models selected, each one's touching flag and a single selection's warn boxes match a scan of every object and the handles stand at the pivot or the model, still, after a move, a hide and an attached prop; prints updateSelectionVisuals' ms a frame, still and dragging.
// touches: frontend/src/lib/engine/SelectionOutline.ts, frontend/src/lib/state/selection.ts, frontend/src/lib/world/ModelBoxes.ts
const t = await P.time({ '/src/lib/engine/Engine.ts:Engine': ['updateSelectionVisuals'] })
const map = await P.loadBenchMap('objects-mixed')
const e = P.e
const L = e.objects
const { editor } = await P.state()
const { selectObjects } = await P.app('/src/lib/state/selection.ts')
const { getAsset } = await P.app('/src/lib/models/assets.ts')
const Box3 = e.tmpBox.constructor
const M4 = e.tmpM.constructor
const V3 = e.camera.position.constructor
editor.tool = 'select'
await P.frames(1)

// What the outline should show, from a scan of every object.
const M = new M4()
const v = new V3()
const worldBox = (o, out) => {
	out.copy(getAsset(o.type).bbox).applyMatrix4(L.matrixOf(o, M))
	return out.expandByVector(out.getSize(v).multiplyScalar(-0.05))
}
const overlaps = (o) => {
	if (!getAsset(o.type).ready) return []
	const box = worldBox(o, new Box3())
	const family = L.descendantIds(o.id)
	for (const id of L.ancestorIds(o)) family.add(id)
	const out = []
	for (const q of L.objects.values()) {
		if (family.has(q.id) || L.isHidden(q.id) || !getAsset(q.type).ready) continue
		const b = worldBox(q, new Box3())
		if (box.intersectsBox(b)) out.push(b)
	}
	return out
}
const touching = (o, n) => {
	if (o.parent !== undefined) return true
	const box = new Box3().copy(getAsset(o.type).bbox).applyMatrix4(L.matrixOf(o, M))
	let g = e.groundAt((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2)
	for (const [x, z] of [
		[box.min.x, box.min.z],
		[box.max.x, box.min.z],
		[box.min.x, box.max.z],
		[box.max.x, box.max.z],
	])
		g = Math.max(g, e.groundAt(x, z))
	if (box.min.y <= g + 0.25) return true
	return n <= 16 && overlaps(o).length > 0
}
const bad = []
/** The handles stand at (x, z): a group's pivot, or one model's spot. */
const gizmoAt = (label, x, z) => {
	const r = e.gizmo.ring.position
	if (!e.gizmo.visible || Math.hypot(r.x - x, r.z - z) > 1e-3) bad.push(`${label}: handles at ${r.x.toFixed(2)},${r.z.toFixed(2)}, want ${x.toFixed(2)},${z.toFixed(2)}`)
}
/** Compares the outline's flags (and, for one model, its warn boxes) with the scan. */
const check = (label) => {
	const sel = editor.selectedIds.map((id) => L.objects.get(id))
	const got = e.outlineTargets.map((x) => x.touching)
	const want = sel.map((o) => touching(o, sel.length))
	if (got.join() !== want.join()) bad.push(`${label}: touching ${got.map(Number).join('')} want ${want.map(Number).join('')}`)
	if (sel.length !== 1) return want
	const ref = overlaps(sel[0])
	const s = e.outline.shared
	const n = s.boxCount.value
	if (n !== Math.min(ref.length, 8)) bad.push(`${label}: ${n} warn boxes, want ${Math.min(ref.length, 8)}`)
	for (let i = 0; i < n; i++) {
		const near = (a, b) => a.distanceTo(b) < 1e-3
		if (!ref.some((b) => near(b.min, s.boxMin.value[i]) && near(b.max, s.boxMax.value[i]))) bad.push(`${label}: warn box ${i} overlaps nothing`)
	}
	return ref.length
}

// The 16 roots nearest the map's middle, lifted off the ground so the prop test decides their colour.
const mid = e.terrain.size * e.terrain.cellSize * 0.5
const roots = [...L.objects.values()].filter((o) => o.parent === undefined)
roots.sort((a, b) => (a.x - mid) ** 2 + (a.z - mid) ** 2 - ((b.x - mid) ** 2 + (b.z - mid) ** 2))
const picked = roots.slice(0, 16)
for (const o of picked) {
	o.yOff += 30
	L.touch(o.id)
}
// One more of the first's model in its place, not selected, so the first surely overlaps something.
const lead = picked[0]
const twin = L.add({ type: lead.type, x: lead.x + 0.2, z: lead.z, yOff: lead.yOff, rotY: lead.rotY, scale: lead.scale })
selectObjects(
	L,
	picked.map((o) => o.id),
	lead.id,
)
await P.frames(2)
const many = check('16 selected')
let pivot = e.selectionPivot()
gizmoAt('16 selected', pivot.x, pivot.z)

const N = P.env('N', 10)
t.reset()
await P.frames(N)
const still = t.snap()
t.reset()
for (let i = 0; i < N; i++) {
	lead.x += i % 2 ? -0.05 : 0.05
	L.touch(lead.id)
	await P.frames(1)
}
const drag = t.snap()
check('16 selected, dragged')
pivot = e.selectionPivot()
gizmoAt('16 selected, dragged', pivot.x, pivot.z)

// One model: its warn boxes, then moved away from everything, hidden twin, and a prop hung on another.
selectObjects(L, [lead.id], lead.id)
await P.frames(2)
const one = check('one selected')
t.reset()
await P.frames(N)
const oneStill = t.snap()
const x0 = lead.x
lead.x += 60
L.touch(lead.id)
await P.frames(1)
check('one moved away')
gizmoAt('one moved away', lead.x, lead.z)
lead.x = x0
L.touch(lead.id)
L.setHidden(twin.id, true)
await P.frames(1)
check('twin hidden')
L.setHidden(twin.id, false)
const host = picked[1]
const prop = L.add({ type: lead.type, x: 0, z: 0, yOff: 0, rotY: 0, scale: 1 })
L.place(prop, host.id, { pos: L.worldPosition(lead, new V3()), rot: 0, scale: lead.scale })
await P.frames(1)
const withProp = check('prop attached at its spot')
L.remove(prop.id)
L.remove(twin.id)
await P.frames(1)
check('prop and twin removed')
t.restore()
const per = (s) => Math.round((s['Engine.updateSelectionVisuals'].ms / N) * 1000) / 1000
return {
	ok: bad.length === 0,
	bad: bad.slice(0, 10),
	objects: L.objects.size,
	touching16: many.filter(Boolean).length,
	warnOne: one,
	warnWithProp: withProp,
	msFrame: { still16: per(still), drag16: per(drag), still1: per(oneStill) },
}
