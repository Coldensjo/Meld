// Moving a spawn a frame at a time (a drag, an arrow-key nudge) leaves the layer's version alone, so the name labels, the particles and the paths are not rebuilt for it (#514); needs the world database.
// touches: frontend/src/lib/world/SpawnLayer.ts, frontend/src/lib/world/spawnEdits.ts, frontend/src/lib/world/SpawnLabels.ts
const e = P.e
const se = await P.app('/src/lib/world/spawnEdits.ts')
const App = window.go.main.App
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const loaded = await App.LoadSpawns('Azeroth', 30, 48, 1)
const layer = e.activeDocument().spawnLayer
layer.set(loaded)
se.syncSpawnUi(layer, true)
// Look and label work resolves after set and bumps the version (#731): wait for it to go quiet before taking the baseline.
await P.settle()
await P.frames(3)
const s = layer.spawns.find((x) => x.kind === 'monster')
const v0 = layer.version
const m0 = layer.moveSeq ?? 0
const x0 = s.x
const N = 60
const t0 = performance.now()
for (let i = 0; i < N; i++) {
	layer.touch(s)
	s.x = x0 + i * 0.05
	layer.refresh(s)
	await P.frames(1)
}
const ms = (performance.now() - t0) / N
const moved = layer.movedSince ? layer.movedSince(m0) : []
const kept = layer.version === v0
s.x = x0
layer.refresh(s)
await P.frames(1)
return { ok: kept && layer.moveSeq - m0 >= N && !!moved && moved.length === N, spawns: layer.spawns.length, versionBumps: layer.version - v0, moves: layer.moveSeq - m0, msPerFrame: +ms.toFixed(2) }
