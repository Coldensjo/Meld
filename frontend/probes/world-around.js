// The world around a region (#15, View › World Around the Block, the owner's choice of 2026-10-30): a region tab of Azeroth's tile 32_48 (Northshire) streams the client's tiles past its block around the camera as a world view does, in the region's frame (the block's corner at its origin): every tile within the reach but the block's own is drawn, none of the block's, the near ones in their texture layers, with their models in a look-only layer of their own (each once, none the block holds by unique ID; drawn), with the WDL horizon past them on no tile of the block and the region's own horizon hidden; the view differs with them hidden; it is look-only (the region's objects, history, dirty mark and compile fingerprint are what they were with it off); the camera may fly off the block and rides the streamed ground there; Edit Here with the camera over the block refuses, and past its edge opens the block there in a new tab, the region left open; and turning the preference off lets it go.
// touches: frontend/src/lib/world/ObjectLayer.ts, frontend/src/lib/world/WorldStream.ts, frontend/src/lib/world/WorldPainter.ts, frontend/src/lib/engine/Engine.ts, frontend/src/lib/engine/MapDocument.ts, frontend/src/lib/engine/CameraController.ts, frontend/src/lib/io/region.ts, frontend/src/lib/ui/menus.ts
const { ui, editor, prefs } = await P.state()
const { editWorldHere } = await P.app('/src/lib/io/region.ts')
const { streamReach, wantedTiles } = await P.app('/src/lib/world/worldGround.ts')
const { tileKey } = await P.app('/src/lib/io/mapTiles.ts')
const T = 1600 / 3
const BLOCK = { x: 32, y: 48, size: 1 }
await P.scene({
	v: 1,
	map: { region: { mapName: 'Azeroth', ...BLOCK } },
	view: { target: [266, 120, 266], yaw: 0.5, pitch: 0.5, distance: 1, hour: 13 },
	prefs: {},
	tool: 'select',
	selectedIds: [],
	selected: null,
	area: null,
	viewport: [1000, 600],
})
await P.until(() => (editor.regionMap === 'Azeroth' ? true : null), 120000, "Azeroth's region tab")
await P.settle()
const e = P.e
const doc = e.debug.doc
const regionId = e.activeDocumentId()
// What the region is with the world around it off: its objects, history, dirty mark and fingerprint.
const off = { surround: !!doc.surround, objects: doc.objects.objects.size, history: !!doc.history.peek(), dirty: editor.dirty, key: await e.regionKey() }
prefs.worldAround = true
await P.until(() => (doc.surround ? true : null), 10000, 'the world around the region started')
const s = doc.surround
await P.until(
	() => {
		const st = e.surroundStats()
		return st && st.loaded > 0 && !st.loading && !st.queued && !st.painting && !st.paintWaiting && !st.horizonPending ? st : null
	},
	180000,
	'the tiles around the block loaded and painted, and the horizon packed for them',
)
await P.frames(3)
const st = e.surroundStats()
// Every tile within the reach of the eye but the block's own is drawn, none of the block's.
const eye = e.camera.position
const block = new Set([tileKey(BLOCK.x, BLOCK.y)])
const have = new Set([...e.surroundTiles()].filter((k) => !block.has(k)))
const want = wantedTiles(eye.x + BLOCK.x * T, eye.z + BLOCK.y * T, streamReach(prefs.viewDistance), have)
let blockDrawn = 0
for (const t of s.tiles.values()) if (t.mesh && block.has(t.key)) blockDrawn++
const tiles = { loaded: st.loaded, wanted: want.length, blockDrawn, painted: st.painted, failed: st.failed, paintFailed: st.paintFailed, wet: st.wet }
// In the region's frame: a neighbour tile's mesh sits at its map corner less the block's.
const east = s.tiles.get(tileKey(BLOCK.x + 1, BLOCK.y))
const eastWorld = east?.mesh ? east.mesh.getWorldPosition(new eye.constructor()) : null
const frame = eastWorld ? Math.hypot(eastWorld.x - T, eastWorld.z) : -1
// The horizon: drawn past the streamed ground, on no tile of the block (nor one with ground), and the region's own is hidden.
let horizonOnBlock = 0
const hz = s.horizon
const hzIndex = hz.geometry.index?.array
for (let k = 0; hzIndex && k < hz.geometry.drawRange.count; k += 3072) {
	const t = s.horizonTiles[Math.floor(hzIndex[k] / 545)]
	if (block.has(t.key) || s.tiles.get(t.key)?.mesh) horizonOnBlock++
}
const horizon = { tiles: st.horizon, onBlockOrGround: horizonOnBlock, regionHorizonShown: !!e.scene.getObjectByName('horizon')?.visible }
// What the world around costs at the block's middle, 120 yd up: not checked, only reported (with it and with its groups hidden).
const pick = (r) => ({ calls: r.calls, triangles: r.triangles, cpuMs: r.cpuMs })
const perfAround = pick(P.perfSummary(await P.perf()))
for (const g of [s.group, s.water, doc.surroundObjects.group]) g.visible = false
const perfBlock = pick(P.perfSummary(await P.perf()))
for (const g of [s.group, s.water, doc.surroundObjects.group]) g.visible = true
// Drawn: looking east off the block, the view with the world around hidden differs.
await P.lookAt({ x: 500, y: e.terrain.heightAt(500, 266) + 80, z: 266 }, { yaw: -Math.PI / 2, pitch: 0.3, back: 60 })
await P.settle()
const shown = await P.shot()
const layer = doc.surroundObjects
layer.group.visible = false
s.group.visible = false
s.water.visible = false
const hidden = await P.shot()
s.group.visible = true
s.water.visible = true
layer.group.visible = true
const drawn = +P.diff(shown, hidden).off.toFixed(3)
P.save(shown, 'around')
P.save(hidden, 'block-alone')
// Its models: in a look-only layer of their own, each placed once, none of the block's again (the
// region's buildings have no copy at their spot), and drawn (the view differs with them hidden).
const v = new eye.constructor()
const w = new eye.constructor()
let twice = 0
let regionWmos = 0
for (const o of doc.objects.objects.values()) {
	if (!o.type.startsWith('wmo:') || o.parent !== undefined) continue
	regionWmos++
	doc.objects.worldPosition(o, v)
	for (const q of layer.objects.values()) {
		if (q.type !== o.type) continue
		layer.worldPosition(q, w)
		if (w.distanceTo(v) < 0.05) twice++
	}
}
// Drawn: looking at the streamed building nearest the block's east edge, the view with the layer hidden differs.
let near = null
let nearD = Infinity
for (const q of layer.objects.values()) {
	if (!q.type.startsWith('wmo:') || q.parent !== undefined) continue
	const d = Math.hypot(q.x - T, q.z - 266)
	if (d < nearD) {
		nearD = d
		near = q
	}
}
let modelsDrawn = -1
if (near) {
	layer.worldPosition(near, w)
	await P.lookAt({ x: w.x, y: w.y + 5, z: w.z }, { yaw: -Math.PI / 2, pitch: 1.1, back: 150 })
	await P.settle()
	const withModels = await P.shot()
	layer.group.visible = false
	const bare = await P.shot()
	layer.group.visible = true
	modelsDrawn = +P.diff(withModels, bare).off.toFixed(3)
	P.save(withModels, 'models')
	P.save(bare, 'no-models')
}
const models = { placed: layer.objects.size, counted: e.surroundStats().models, lookOnly: layer.lookOnly, regionWmos, twice, looked: near ? `${near.type} ${Math.round(nearD)} yd off` : '', drawn: modelsDrawn }
// Look-only: the region holds what it held with it off.
const on = { objects: doc.objects.objects.size, history: !!doc.history.peek(), dirty: editor.dirty, key: await e.regionKey() }
const lookOnly = on.objects === off.objects && on.history === off.history && on.dirty === off.dirty && on.key === off.key
// The camera flies off the block and, following the ground, rides the streamed ground there.
const c = e.controller
prefs.cameraFollowGround = true
await P.frames(2)
c.focus(T + 200, 266, 120)
await P.frames(20)
const ground = s.heightAt(c.target.x, c.target.z)
const rides = { x: Math.round(c.target.x), ground: +ground.toFixed(2), target: +c.target.y.toFixed(2), off: +Math.abs(c.target.y - ground).toFixed(2) }
prefs.cameraFollowGround = false
await P.frames(2)
// Edit Here: refused over the block, and past its edge opens the block there (a project lent in the state, as world-view does).
const hadProject = ui.project
ui.project = hadProject ?? { name: 'probe', path: '', clientPath: '' }
c.setView(266, 120, 266, 0.5, 0.5, 1)
await P.frames(2)
const tabsBefore = e.documents.length
await editWorldHere(e)
const refused = { sameTab: e.activeDocumentId() === regionId, tabs: e.documents.length === tabsBefore, said: /own block/.test(ui.status) }
c.setView(T + 200, 120, 266, 0.5, 0.5, 1)
await P.frames(2)
await editWorldHere(e)
await P.until(() => (e.activeDocumentId() !== regionId && editor.regionMap === 'Azeroth' ? true : null), 180000, 'the block east of the region opened')
const r = e.activeRegion()
const opened = {
	block: `${r.x}_${r.y} ${r.size}`,
	holdsEast: r.x <= BLOCK.x + 1 && BLOCK.x + 1 < r.x + r.size && r.y <= BLOCK.y && BLOCK.y < r.y + r.size,
	regionKept: e.documents.some((d) => d.id === regionId),
	camOff: +Math.hypot(c.target.x + r.x * T - (BLOCK.x * T + T + 200), c.target.z + r.y * T - (BLOCK.y * T + 266)).toFixed(2),
}
ui.project = hadProject
e.closeDocument(e.activeDocumentId())
await P.until(() => (e.activeDocumentId() === regionId ? true : null), 10000, 'back on the region')
// Off: the stream goes.
prefs.worldAround = false
await P.frames(3)
const gone = { surround: !!doc.surround, inScene: !!s.group.parent, models: !!doc.surroundObjects, modelsInScene: !!layer.group.parent }
const ok =
	!off.surround &&
	tiles.loaded >= tiles.wanted &&
	tiles.wanted > 0 &&
	tiles.blockDrawn === 0 &&
	tiles.painted > 0 &&
	tiles.failed === 0 &&
	frame >= 0 &&
	frame < 0.01 &&
	horizon.tiles > 0 &&
	horizon.onBlockOrGround === 0 &&
	!horizon.regionHorizonShown &&
	drawn > 0.05 &&
	models.placed > 0 &&
	models.placed === models.counted &&
	models.lookOnly &&
	models.regionWmos > 0 &&
	models.twice === 0 &&
	models.drawn > 0.005 &&
	lookOnly &&
	rides.x > T &&
	rides.off < 1 &&
	refused.sameTab &&
	refused.tabs &&
	refused.said &&
	opened.holdsEast &&
	opened.regionKept &&
	opened.camOff < 1 &&
	!gone.surround &&
	!gone.inScene &&
	!gone.models &&
	!gone.modelsInScene
return { ok, off, on, tiles, frame, horizon, drawn, models, rides, refused, opened, gone, perf: { around: perfAround, block: perfBlock } }
