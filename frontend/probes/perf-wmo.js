// Benchmark map wmo (#322; docs/TESTS.md, "Benchmark maps"): its performance numbers, for before/after.
// timeout: 600 (the map alone takes about 250 s to build and load on SwiftShader, #635)
// touches: frontend/src/lib/bench/benchMaps.ts, frontend/src/lib/engine/perfMeter.ts, frontend/src/lib/engine/Engine.ts, frontend/src/lib/world/ObjectLayer.ts, frontend/src/lib/terrain/TerrainMaterial.ts
return await P.benchMap('wmo')
