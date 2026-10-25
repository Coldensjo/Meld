// Attached objects follow their parent (#329): a move, an undo-style snapshot that detaches one, re-parenting through place, a type change, a sculpt re-snap, and the parent deleted and added back.
// touches: frontend/src/lib/world/ObjectLayer.ts, frontend/src/lib/world/placement.ts, frontend/src/lib/world/pivot.ts
// tier: smoke
const e = P.e
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const L = e.objects
const A = L.add({ type: 'helper:cube:4', x: 100, z: 100, yOff: 0, rotY: 0, scale: 1 })
const B = L.add({ type: 'helper:cube:1', parent: A.id, x: 5, z: 0, yOff: 2, rotY: 0, scale: 1 })
const C = L.add({ type: 'helper:disc:8', parent: B.id, x: 1, z: 0, yOff: 0, rotY: 0, scale: 1 })
await P.frames(1)
// The drawn instance's position of an object, from its batch.
const drawn = (o) => {
	const b = L.batches.get(o.type)
	const i = b.rows.items.indexOf(o.id)
	if (i < 0) return null
	const m = b.rows.matrices
	return [m[i * 16 + 12], m[i * 16 + 13], m[i * 16 + 14]].map((v) => Math.round(v * 100) / 100)
}
const out = {}
out.start = { B: drawn(B), C: drawn(C) }
// Move the parent by writing its fields and touching it (as editSelected does).
Object.assign(A, { x: 110 })
L.touch(A.id)
await P.frames(1)
out.moved = { B: drawn(B), C: drawn(C) }
// Snapshot restore that detaches B (as transformCommand's undo does).
const snap = { ...B }
delete snap.parent
snap.x = 50
snap.z = 50
snap.yOff = 0
delete B.parent
Object.assign(B, snap)
L.touch(B.id)
await P.frames(1)
out.detached = { B: drawn(B), C: drawn(C) }
// A move of A now leaves B alone.
Object.assign(A, { x: 120 })
L.touch(A.id)
await P.frames(1)
out.afterDetachMoveA = { B: drawn(B) }
// Re-attach B to A through place, then move A.
L.place(B, A.id, L.worldPlacement(B))
Object.assign(A, { x: 130 })
L.touch(A.id)
await P.frames(1)
out.reattached = { B: drawn(B), C: drawn(C) }
// A type change keeps the attachment.
L.setType(B.id, 'helper:cube:16')
await P.frames(1)
out.retyped = { B: drawn(B), inOld: L.batches.get('helper:cube:1').rows.items.includes(B.id), C: drawn(C) }
// A sculpt stamp under A re-snaps the whole tree.
const h0 = drawn(C)[1]
for (let i = 0; i < e.terrain.heights.length; i++) e.terrain.heights[i] += 3
L.markRegionDirty(0, 0, 1000, 1000)
await P.frames(1)
out.raised = { C: drawn(C), dy: Math.round((drawn(C)[1] - h0) * 100) / 100 }
// Remove A and add it back (delete and undo): its children follow again.
const a = { ...A }
L.remove(A.id)
await P.frames(1)
L.add(a)
Object.assign(L.objects.get(A.id), { x: 140 })
L.touch(A.id)
await P.frames(1)
out.readded = { B: drawn(B), C: drawn(C) }
const ok =
	out.moved.B[0] === out.start.B[0] + 10 &&
	out.moved.C[0] === out.start.C[0] + 10 &&
	out.detached.B[0] === 50 &&
	out.detached.C[0] === 51 &&
	out.afterDetachMoveA.B[0] === 50 &&
	out.reattached.B[0] === 60 &&
	out.reattached.C[0] === 61 &&
	out.retyped.B[0] === 60 &&
	!out.retyped.inOld &&
	out.raised.dy === 3 &&
	out.readded.B[0] === 70 &&
	out.readded.C[0] === 71
return { ok, ...out }
