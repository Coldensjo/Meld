// The benchmark scene's performance numbers (docs/TESTS.md, "Measuring performance"), for before/after.
await P.scene(P.BENCH)
await P.settle()
await P.frames(5)
const r = await P.perf()
const round = (v) => Math.round(v * 100) / 100
return {
	frameMs: round(r.frameMs),
	cpuMs: round(r.cpuMs),
	gpuMs: r.gpu ? round(r.gpu.reduce((a, b) => a + b, 0)) : null,
	calls: r.calls,
	triangles: r.triangles,
	geometries: r.geometries,
	textures: r.textures,
	heapMB: r.heapMB,
	topModels: r.models.slice(0, 5).map((m) => `${m.type.split('?')[0].split(/[\\/]/).pop()} ${m.triangles}`),
	note: 'SwiftShader: CPU and triangle counts compare between runs; GPU times need a real GPU.',
}
