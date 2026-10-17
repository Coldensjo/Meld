// The benchmark scene's performance numbers (docs/TESTS.md, "Measuring performance"), for before/after.
await P.scene(P.BENCH)
await P.settle()
await P.frames(5)
const r = await P.perf()
const round = (v) => Math.round(v * 100) / 100
// frameMs is the mean interval between frame starts over the one-second window. On SwiftShader a frame
// takes most of a second, so the window holds one or two intervals and the figure swings 5x between
// identical runs (#226): give it only when the window held ten or more.
return {
	frameMs: r.frames > 10 ? round(r.frameMs) : null,
	frames: r.frames,
	cpuMs: round(r.cpuMs),
	gpuMs: r.gpu ? round(r.gpu.reduce((a, b) => a + b, 0)) : null,
	calls: r.calls,
	triangles: r.triangles,
	geometries: r.geometries,
	textures: r.textures,
	heapMB: r.heapMB,
	topModels: r.models.slice(0, 5).map((m) => `${m.type.split('?')[0].split(/[\\/]/).pop()} ${m.triangles}`),
	note: 'SwiftShader: cpuMs, calls, triangles, geometries and textures compare between runs; frameMs needs 10+ frames in the window and GPU times a real GPU.',
}
