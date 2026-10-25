// Benchmark map water (#322; docs/TESTS.md, "Benchmark maps"): its performance numbers, for before/after.
// touches: frontend/src/lib/bench/benchMaps.ts, frontend/src/lib/engine/perfMeter.ts, frontend/src/lib/engine/Engine.ts, frontend/src/lib/world/ObjectLayer.ts, frontend/src/lib/terrain/TerrainMaterial.ts
return await P.benchMap('water')
