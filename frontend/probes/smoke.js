// The benchmark scene opens, its models load, and it draws with no WebGL or page errors.
await P.scene(P.BENCH)
await P.settle()
P.glError()
await P.frames(3)
const r = window.__engine.renderer.info.render
const objects = window.__engine.objects.objects.size
const gl = P.glError()
return {
	ok: gl === 0 && r.triangles > 0 && objects > 0,
	triangles: r.triangles,
	calls: r.calls,
	objects,
	glErrors: gl,
}
