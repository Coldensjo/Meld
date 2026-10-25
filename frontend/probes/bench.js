// The benchmark scene's performance numbers (docs/TESTS.md, "Measuring performance"), for before/after.
// touches: frontend/src/lib/bench/benchMaps.ts, frontend/src/lib/engine/perfMeter.ts, frontend/src/lib/engine/Engine.ts, frontend/src/lib/world/ObjectLayer.ts, frontend/src/lib/terrain/TerrainMaterial.ts
await P.scene(P.BENCH)
await P.settle()
await P.frames(5)
return {
	...P.perfSummary(await P.perf()),
	note: 'SwiftShader: cpuMs, calls, triangles, geometries and textures compare between runs; frameMs needs 10+ frames in the window and GPU times a real GPU.',
}
