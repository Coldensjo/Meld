// A model the client draws nothing of (#333): Blackrock's open-door collision blocker loads once, with no warning, as a ready marker (its hull's wireframe) that casts no shadow, instead of failing and retrying every 30 s.
// touches: frontend/src/lib/models/assets.ts, frontend/src/lib/models/modelBuild.ts, frontend/src/lib/world/ObjectLayer.ts
const e = P.e
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const type = 'm2:World\\KhazModan\\Blackrock\\PassiveDoodads\\Doors\\BlackRockHugeDoorsOpenDoorCollision.m2'
const warnings = []
const fetches = []
const warn = console.warn
const fetch0 = window.fetch
console.warn = (...a) => {
	if (String(a[0]).includes('model load failed')) warnings.push(a.map(String).join(' '))
	return warn.apply(console, a)
}
window.fetch = (input, init) => {
	const u = String(input instanceof Request ? input.url : input)
	if (u.includes('/wow/model') && u.includes('OpenDoorCollision')) fetches.push(u)
	return fetch0(input, init)
}
try {
	const L = e.objects
	const o = L.add({ type, x: 128, z: 128, yOff: 0, rotY: 0, scale: 1 })
	await P.until(() => L.batches.get(type)?.mesh.material.wireframe === true, 30_000, 'the door to load as a marker')
	await P.frames(3)
	// A second object of the same type, and a fresh frame, must not fetch the model again.
	L.add({ type, x: 140, z: 128, yOff: 0, rotY: 0, scale: 1 })
	await P.frames(3)
	const b = L.batches.get(type)
	const g = b.mesh.geometry
	g.computeBoundingBox()
	const size = g.boundingBox.getSize(new g.boundingBox.min.constructor())
	const out = {
		warnings: warnings.length,
		fetches: fetches.length,
		castShadow: b.mesh.castShadow,
		wireframe: b.mesh.material.wireframe,
		triangles: (g.index?.count ?? 0) / 3,
		size: [size.x, size.y, size.z].map((v) => Math.round(v * 10) / 10),
		drawn: b.mesh.count,
		id: o.id,
	}
	out.ok = out.warnings === 0 && out.fetches <= 1 && !out.castShadow && out.wireframe && out.triangles > 0 && out.size[1] > 1 && out.drawn === 2
	return out
} finally {
	console.warn = warn
	window.fetch = fetch0
}
