// The status bar's creature count (#967): "N creatures" beside the objects cell counts the open region's monster and NPC spawns, not game objects, and follows an added or removed spawn; needs the world database.
// touches: frontend/src/components/StatusBar.svelte, frontend/src/lib/world/SpawnLayer.ts, frontend/src/lib/engine/Engine.ts, frontend/src/lib/state/editor.svelte.ts
const e = P.e
const se = await P.app('/src/lib/world/spawnEdits.ts')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const layer = e.activeDocument().spawnLayer
const text = () => [...document.querySelectorAll('footer.status .cell')].map((c) => c.textContent.trim()).find((t) => /creatures?$/.test(t)) ?? ''
const empty = text()
const loaded = await window.go.main.App.LoadSpawns('Azeroth', 31, 48, 2)
layer.set(loaded)
se.syncSpawnUi(layer, true)
await P.settle()
await new Promise((r) => setTimeout(r, 1200))
await P.frames(2)
const want = loaded.filter((s) => s.kind !== 'object').length
const shown = text()
const res = { empty, shown, want, objects: loaded.length - want }
const ok = empty === '0 creatures' && want > 0 && shown === `${want} creatures` && layer.creatureCount === want
return { ok, ...res }
