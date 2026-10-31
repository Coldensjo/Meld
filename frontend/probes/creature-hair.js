// A character creature draws the hair the client draws (#965): a bald human man (display 1276) and a bald dwarf (display 1363), both CharHairGeosets submesh 0, are dressed with the scalp (hair submesh 1) and a hair texture (variation 1's, which also dresses the dwarf's beard); the human model has a scalp, which adds triangles to the loaded model, and the dwarf's has none. Saves a shot of each (`--shot <dir>`).
// touches: internal/vmangos/looks.go, internal/wow/look.go
await P.scene(P.BENCH)
const e = P.e
const { editor } = await P.state()
const { loadAsset } = await P.app('/src/lib/models/assets.ts')
const { spawnType } = await P.app('/src/lib/world/spawnInfo.ts')
const App = window.go.main.App
const bad = []
const out = {}
const tris = (a) => (a.geometry.index ? a.geometry.index.count : a.geometry.attributes.position.count) / 3
for (const [name, display, scalp] of [
	['bald human', 1276, true],
	['bald dwarf', 1363, false],
]) {
	const r = await App.SpawnLook(display, 0, 0, 0, 0)
	if (!r.model) {
		bad.push(`${name}: display ${display} has no model`)
		continue
	}
	const q = new URLSearchParams(r.look)
	const geo = (q.get('geo') ?? '').split(',').map(Number)
	const hair = geo.filter((id) => id > 0 && id < 100)
	if (hair.length !== 1 || hair[0] !== 1) bad.push(`${name}: hair geosets ${JSON.stringify(hair)}, want the scalp [1]`)
	if (!q.getAll('tex').some((t) => t.startsWith('6:'))) bad.push(`${name}: no hair texture in ${r.look}`)
	const withHair = await loadAsset(spawnType({ model: r.model, look: r.look }))
	q.set('geo', geo.filter((id) => id !== 1).join(','))
	const without = await loadAsset(spawnType({ model: r.model, look: q.toString() }))
	if (!withHair.ready || !without.ready) {
		bad.push(`${name}: the model did not load`)
		continue
	}
	out[name] = { display, hair, tris: tris(withHair), withoutScalp: tris(without) }
	if (scalp !== tris(withHair) > tris(without)) bad.push(`${name}: ${tris(withHair)} triangles with the scalp, ${tris(without)} without; the model has ${scalp ? 'a' : 'no'} scalp`)
	// A shot of the look as the Place tool's preview, close up.
	editor.tool = 'place'
	editor.placeScatter = false
	editor.placeRandomScale = false
	editor.prefab = spawnType({ model: r.model, look: r.look })
	await P.lookAt(e.controller.target.clone(), { pitch: 0.8, back: 30 })
	P.pointer('pointermove', 0.5, 0.5)
	await P.until(() => e.placeTool.ghost.visible && e.placeTool.ghost.geometry === withHair.geometry, 30_000, `${name}'s preview`)
	// Close up on the head, the pointer kept over the preview's feet so it stays put.
	const feet = e.placeTool.ghost.position.clone()
	await P.lookAt({ x: feet.x, y: feet.y + 1.6, z: feet.z }, { pitch: 0.35, back: 2.5 })
	const s = feet.clone().project(e.camera)
	P.pointer('pointermove', (s.x + 1) / 2, (1 - s.y) / 2)
	await P.frames(4)
	P.save(await P.shot(), name.replace(/[^a-z0-9]+/g, '-'))
}
editor.prefab = 'helper:cube:8'
editor.tool = 'select'
await P.frames(2)
return { ok: bad.length === 0, bad, ...out }
