// The benchmark scene's performance numbers (docs/TESTS.md, "Measuring performance"), for before/after, and a guard (#429):
// draw calls, triangles, geometries and textures are deterministic on this scene, so the probe fails when one drifts more than
// the band (10 %) from bench-baseline.json. Milliseconds and heap are printed only (SwiftShader, #226, #337).
// touches: frontend/src/lib/bench/benchMaps.ts, frontend/src/lib/engine/perfMeter.ts, frontend/src/lib/engine/Engine.ts, frontend/src/lib/world/ObjectLayer.ts, frontend/src/lib/terrain/TerrainMaterial.ts
await P.scene(P.BENCH)
await P.settle()
await P.frames(5)
const summary = P.perfSummary(await P.perf())
const base = window.__benchBaseline
const drift = {}
const failures = []
for (const k of ['calls', 'triangles', 'geometries', 'textures']) {
	const d = (summary[k] - base[k]) / base[k]
	drift[k] = `${summary[k]} vs ${base[k]} (${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} %)`
	if (Math.abs(d) > base.band) failures.push(`${k} ${drift[k]}`)
}
return {
	ok: failures.length === 0,
	...(failures.length ? { error: `drifted more than ${base.band * 100} % from bench-baseline.json: ${failures.join('; ')}. If the change is on purpose, update the file and say why in the commit.` } : {}),
	baseline: drift,
	...summary,
	note: 'SwiftShader: cpuMs, calls, triangles, geometries and textures compare between runs; frameMs needs 10+ frames in the window and GPU times a real GPU.',
}
