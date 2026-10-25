// A moved model rewrites only its own instance row (#510): dragging one of 3000 cubes of one type packs nothing again and its drawn row matches it, a sculpt re-snap leaves every drawn row matching its object, and the moved cube is picked where it went.
// touches: frontend/src/lib/world/ObjectLayer.ts, frontend/src/lib/world/instanceBatch.ts, frontend/src/lib/tools/ObjectTools.ts, frontend/src/lib/world/instanceCull.ts
const e = P.e
const { editor } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'select'
await P.frames(1)
const L = e.objects
const TYPE = 'helper:cube:4'
for (let i = 0; i < 3000; i++) L.add({ type: TYPE, x: 20 + (i % 60) * 3.6, z: 20 + Math.floor(i / 60) * 4, yOff: 0, rotY: 0, scale: 1 })
await P.lookAt({ x: 128, y: e.terrain.heightAt(128, 80), z: 80 }, { pitch: 1.2, back: 140 })
await P.frames(2)
const b = L.batches.get(TYPE)
const M = new e.camera.matrixWorld.constructor()
/** The largest gap between a drawn row and its object's matrix, over every drawn instance. */
const rowsErr = () => {
	let err = 0
	for (const [mesh, ids] of [
		[b.mesh, b.ids],
		[b.lod, b.lodIds],
	]) {
		if (!mesh) continue
		const a = mesh.instanceMatrix.array
		for (let k = 0; k < mesh.count; k++) {
			L.matrixOf(L.objects.get(ids[k]), M)
			for (let j = 0; j < 16; j++) err = Math.max(err, Math.abs(a[k * 16 + j] - M.elements[j]))
		}
	}
	return err
}
const t = await P.time({ '/src/lib/world/ObjectLayer.ts:ObjectLayer': ['update', 'cull'], '/src/lib/world/instanceBatch.ts:InstanceBatch': ['pack'] })
const out = { drawn: b.mesh.count + (b.lod?.count ?? 0) }
try {
	// A drag, as the Select tool does it: the fields written and the object touched, a frame each move.
	const o = L.objects.get(b.rows.items[1500])
	const x0 = o.x
	for (let i = 1; i <= 10; i++) {
		o.x = x0 + i * 0.5
		o.rotY = i * 0.1
		L.touch(o.id)
		await P.frames(1)
	}
	const drag = t.snap()
	out.drag = { packs: drag['InstanceBatch.pack'].calls, msFrame: Math.round((drag.total.ms / 10) * 100) / 100, rowsErr: rowsErr() }
	// The moved cube is picked where it went, from straight above.
	const V3 = e.controller.target.constructor
	const top = new V3(o.x, 80, o.z)
	const R = e.raycaster.constructor
	const picked = L.pick(new R(top, new V3(0, -1, 0)))
	out.picked = picked === o.id
	out.drawnAfter = b.mesh.count + (b.lod?.count ?? 0)
	// A sculpt stroke re-snaps the cubes under it.
	editor.tool = 'sculpt'
	await P.frames(1)
	editor.sculptMode = 'raise'
	editor.brush.radius = 20
	editor.brush.strength = 1
	await P.stroke('sculpt', { x: 60, z: 100 }, { x: 160, z: 100 }, 10)
	const P3 = new V3()
	const raised = [...L.objects.values()].filter((q) => L.worldPosition(q, P3).y > 0.5).length
	out.sculpt = { raised, rowsErr: rowsErr() }
	e.history.undo()
	await P.frames(1)
	out.undone = { rowsErr: rowsErr() }
} finally {
	t.restore()
}
const close = (v) => v < 1e-3
return { ok: out.drawn > 0 && out.drag.packs === 0 && close(out.drag.rowsErr) && out.picked && out.sculpt.raised > 0 && close(out.sculpt.rowsErr) && close(out.undone.rowsErr), ...out }
