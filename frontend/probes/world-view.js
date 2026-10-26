// The world view (#15): opening Azeroth's from the Start dialog's block (Elwynn, 31-33 x 48-50) streams the client's tiles around the camera, nearest first, the far ones at a coarser stride, the near ones (within PAINT_REACH) in their own texture layers once those load and the rest in the minimap's colour, with the map's WDL horizon past them, with their liquids (MCLQ, drawn: the view at a lake differs with them hidden), with their models (each once, however many tiles list it; the doodads only as far as the client draws them for their size), and looks at the block's middle once its tile is in; the ground is drawn (the view differs with the tiles hidden) and the camera rides it; flying four tiles east loads the tiles there and lets go of those left behind, so what is loaded stays bounded, while the models and textures landing redraw the far shadow map at most once every 30 frames (its fit moving still redraws it at once), and the models only the dropped tiles used are let go of (no empty batch stays, the registry no longer keeps them); the tools do nothing in it (a Sculpt click makes no undo step), nor do the commands on the map's ground and models (Select All selects nothing, a paste doesn't start, the Terrain menu's clean-up, Remove Duplicate Models and Bake Shadows leave no undo step, no dirty tab and every model placed); the scene line names the world view; Edit Here opens the block around the camera in a region tab with the camera where it was (the region's coordinates are the world's less the block's corner) and the same paint and liquids as the world view drew there, and File › World View from that region goes back to the world tab, the camera again where it was.
// touches: frontend/src/lib/world/WorldStream.ts, frontend/src/lib/world/WorldPainter.ts, frontend/src/lib/world/worldPaint.ts, frontend/src/lib/terrain/TerrainMaterial.ts, frontend/src/lib/terrain/paletteArray.ts, frontend/src/lib/engine/Engine.ts, frontend/src/lib/state/selection.ts, frontend/src/components/MenuBar.svelte, frontend/src/lib/world/worldGround.ts, frontend/src/lib/world/instanceCull.ts, frontend/src/lib/world/horizonMesh.ts, frontend/src/lib/world/worldLiquid.ts, frontend/src/lib/water/liquidMaterial.ts, internal/vmangos/wdl.go, frontend/src/components/NewMapDialog.svelte, frontend/src/components/DocTabs.svelte, internal/wow/ground.go, internal/wow/client.go
const { ui, editor } = await P.state()
const e = P.e
const { openWorldView, editWorldHere } = await P.app('/src/lib/io/region.ts')
const { streamReach, keepReach, wantedTiles, groundStride, tileDistance } = await P.app('/src/lib/world/worldGround.ts')
const T = 1600 / 3
openWorldView(e, 'Azeroth', { x: 31, y: 48, size: 3 })
await P.until(() => editor.worldMap === 'Azeroth' || null, 30000, "Azeroth's world tab")
const worldId = e.activeDocumentId()
const worldDoc = e.doc
// The camera looks at the block's middle (tile 32_49's) once that tile has loaded.
const mid = { x: 32.5 * T, z: 49.5 * T }
await P.until(
	() => {
		const s = e.worldStats()
		return s && s.loaded >= 9 && !s.loading && !s.queued ? s : null
	},
	120000,
	'the tiles around the camera loaded',
)
await P.frames(3)
const c = e.controller
const first = e.worldStats()
const ground = e.doc.world.heightAt(mid.x, mid.z)
const focused = Math.abs(c.target.x - mid.x) < 600 && Math.abs(c.target.z - mid.z) < 600 && Number.isFinite(c.target.y)
// Every tile within the reach of the eye is loaded, and nothing else beyond a tile further.
const reach = streamReach(1)
const eye = e.camera.position
const want = wantedTiles(eye.x, eye.z, reach, e.worldTiles())
const loadedAll = first.loaded >= want.length && first.loaded <= wantedTiles(eye.x, eye.z, keepReach(reach), e.worldTiles()).length
// Each tile is drawn at the stride for its distance from the eye, as of the plan's last quarter tile
// (so up to a quarter tile's diagonal off), and the near and far strides are both in use.
let strideOff = 0
for (const t of worldDoc.world.tiles.values()) {
	if (!t.mesh) continue
	const d = tileDistance(eye.x, eye.z, t.x, t.y)
	if (groundStride(Math.max(0, d - T / 3)) !== t.stride && groundStride(d + T / 3) !== t.stride) strideOff++
}
const strides = first.strides[1] > 0 && first.strides[4] > 0 && strideOff === 0
// The tiles within PAINT_REACH of the eye are drawn in their texture layers once those and their
// textures are read, those past PAINT_DROP in the minimap's colour (each as of the plan's last quarter
// tile, so with the same slack as the strides).
const { PAINT_REACH, PAINT_DROP } = await P.app('/src/lib/world/worldPaint.ts')
await P.until(
	() => {
		const s = e.worldStats()
		return s && !s.painting && !s.paintWaiting ? s : null
	},
	120000,
	'the near tiles painted',
)
const paint = { painted: 0, nearUnpainted: 0, farPainted: 0, failed: e.worldStats().paintFailed, entries: worldDoc.world.painter.entries.length }
for (const t of worldDoc.world.tiles.values()) {
	if (!t.mesh) continue
	const d = tileDistance(eye.x, eye.z, t.x, t.y)
	const painted = !!t.paint && t.mesh.material === t.paint.material
	if (painted) paint.painted++
	if (!painted && d < PAINT_REACH - T / 2) paint.nearUnpainted++
	if (painted && d > PAINT_DROP + T / 2) paint.farPainted++
}
// Drawn: the view with the tiles hidden differs.
await P.lookAt({ x: mid.x, y: ground + 120, z: mid.z + 300 }, { pitch: 0.35, back: 1 })
await P.settle()
const shown = await P.shot()
e.doc.world.group.visible = false
const hidden = await P.shot()
e.doc.world.group.visible = true
const drawn = +P.diff(shown, hidden).off.toFixed(3)
// The paint is drawn: the view with the painted tiles in their minimap colour differs.
const paintedTiles = [...worldDoc.world.tiles.values()].filter((t) => t.mesh && t.paint && t.mesh.material === t.paint.material)
for (const t of paintedTiles) t.mesh.material = t.colour
const minimap = await P.shot()
for (const t of paintedTiles) t.mesh.material = t.paint.material
paint.drawn = +P.diff(shown, minimap).off.toFixed(3)
P.save(shown, 'painted')
P.save(minimap, 'minimap')
// Past the ground the map's WDL horizon is drawn, none of it on a tile whose ground is drawn: the view
// with it hidden differs.
const hz = worldDoc.world.horizon
let horizonOnGround = 0
const hzIndex = hz.geometry.index?.array
for (let k = 0; hzIndex && k < hz.geometry.drawRange.count; k += 3072) {
	// A packed tile's first index is its first vertex, 545 a tile in the mesh's order.
	const t = worldDoc.world.horizonTiles[Math.floor(hzIndex[k] / 545)]
	if (worldDoc.world.tiles.get(t.key)?.mesh) horizonOnGround++
}
// (The frame shows or hides the mesh by the preference; its material is the probe's to hide.)
hz.material.visible = false
const noHorizon = await P.shot()
hz.material.visible = true
const horizon = { tiles: e.worldStats().horizon, onGround: horizonOnGround, drawn: +P.diff(shown, noHorizon).off.toFixed(3) }
// The models are drawn too: the view with them hidden differs.
worldDoc.objects.group.visible = false
const bare = await P.shot()
worldDoc.objects.group.visible = true
const modelsDrawn = +P.diff(shown, bare).off.toFixed(3)
// The doodads (M2s) are drawn only as far across the ground as the client draws them for their size
// (doodadReach): none drawn past it, and some left out for it.
const { doodadReach, DOODAD_ALWAYS_RADIUS } = await P.app('/src/lib/world/instanceCull.ts')
const doodads = { drawn: 0, past: 0, cut: 0 }
const eyeNow = e.camera.position
for (const [type, b] of worldDoc.objects.batches) {
	if (!type.startsWith('m2:')) continue
	const { packed, items, spheres } = b.rows
	const drawn = new Set(packed)
	for (let i = 0; i < items.length; i++) {
		const r = spheres[i * 4 + 3]
		const far = r <= DOODAD_ALWAYS_RADIUS ? doodadReach(r) + r : Infinity
		const beyond = Math.hypot(spheres[i * 4] - eyeNow.x, spheres[i * 4 + 2] - eyeNow.z) > far + 0.01
		if (drawn.has(i)) {
			doodads.drawn++
			if (beyond) doodads.past++
		} else if (beyond) doodads.cut++
	}
}
// What the models cost, for the level-of-detail steps that come next: not checked, only reported.
const perfModels = P.perfSummary(await P.perf())
worldDoc.objects.group.visible = false
const perfBare = P.perfSummary(await P.perf())
worldDoc.objects.group.visible = true
// Each model is placed once: as many objects as the loaded tiles list unique IDs (and models without
// one). Not by spot: the client has a few models twice at one spot under two IDs (a haystack in Elwynn).
const uids = new Set()
let unnamed = 0
for (const t of worldDoc.world.tiles.values()) {
	if (!t.ground) continue
	const list = await (await fetch(`/wow/groundmodels?map=Azeroth&x=${t.x}&y=${t.y}`)).json()
	for (const m of list)
		if (m.uid) uids.add(m.uid)
		else unnamed++
}
const placedOnce = worldDoc.objects.objects.size === uids.size + unnamed && e.worldStats().models === worldDoc.objects.objects.size
// The tiles' liquids (MCLQ) are drawn: Elwynn has lakes and rivers near the block, and looking down at
// the loaded one nearest the eye, the view with the tiles' liquid meshes hidden differs.
const liquids = { wet: e.worldStats().wet, triangles: e.worldStats().liquidTriangles, at: '', drawn: 0 }
{
	let best = null
	for (const t of worldDoc.world.tiles.values()) {
		if (!t.liquidMesh) continue
		const d = tileDistance(eye.x, eye.z, t.x, t.y)
		if (!best || d < best.d) best = { t, d }
	}
	const l = best?.t.liquids.find((q) => q.cells.some((on) => on))
	if (l) {
		const cell = l.cells.indexOf(1)
		const r = Math.floor(cell / 8)
		const q = cell % 8
		const C = T / 128
		const at = { x: best.t.x * T + (l.indexX * 8 + q + 0.5) * C, y: l.heights[r * 9 + q], z: best.t.y * T + (l.indexY * 8 + r + 0.5) * C }
		liquids.at = `${best.t.x}_${best.t.y} chunk ${l.indexX},${l.indexY} cell ${cell}`
		await P.lookAt(at, { pitch: 0.9, back: 60 })
		await P.until(
			() => {
				const s = e.worldStats()
				return s && !s.loading && !s.queued && !s.painting && !s.paintWaiting ? s : null
			},
			120000,
			'the tiles around the lake',
		)
		await P.settle()
		const wet = await P.shot()
		const meshes = worldDoc.world.water.children
		for (const m of meshes) m.visible = false
		const dry = await P.shot()
		for (const m of meshes) m.visible = true
		liquids.drawn = +P.diff(wet, dry).off.toFixed(3)
		P.save(wet, 'liquids')
	}
}
// A Sculpt click does nothing in a world view.
editor.tool = 'sculpt'
await P.frames(2)
await P.click(0.5, 0.6, {}, 3)
const noEdit = !e.history.peek() && !editor.dirty
editor.tool = 'select'
// Nor do the commands on the map's own ground and models (refuseInWorld): Select All selects nothing
// (the streamed models are look-only), a paste doesn't start, the Terrain menu's clean-up and the
// models' Remove Duplicates change nothing, so no undo step, no dirty tab and every model still placed.
const modelsBefore = worldDoc.objects.objects.size
e.selectAll()
const pickedAll = editor.selectedIds.length + (editor.selection ? 1 : 0)
e.selectModelsOfType([...worldDoc.objects.objects.values()][0]?.type ?? '')
const pickedType = editor.selectedIds.length
const clip = { objects: e.objectClip, last: e.lastCopied }
e.objectClip = { objects: [{ type: 'helper:cube', x: 0, z: 0, yOff: 0, rotY: 0, scale: 1 }] }
e.lastCopied = 'objects'
e.startPaste()
const pasting = ui.pasting
ui.pasting = false
e.objectClip = clip.objects
e.lastCopied = clip.last
e.cleanUpTile('height')
e.removeDuplicateModels()
e.bakeShadows()
await P.frames(2)
const commandsOff = { pickedAll, pickedType, pasting, history: !!e.history.peek(), dirty: editor.dirty, models: worldDoc.objects.objects.size - modelsBefore }
const lookOnly = !pickedAll && !pickedType && !pasting && !commandsOff.history && !commandsOff.dirty && commandsOff.models === 0
const scene = await window.__sceneText()
// Four tiles east: the tiles there load, the ones far behind go.
const typesBefore = new Set(worldDoc.objects.batches.keys())
// While they stream in, the models and textures landing redraw the far shadow map at most once every
// WORLD_FAR_FRAMES (30) frames; only its fit moving redraws it sooner (Engine.markShadows).
const sm = e.renderer.shadowMap
const smRender = sm.render
let farNow = false
sm.render = function (...args) {
	farNow ||= e.env.far.shadow.needsUpdate
	return smRender.apply(this, args)
}
const frameOf = e.frame
const farRedraws = { scene: 0, fit: 0, early: 0, frames: 0 }
let sinceFar = Infinity
e.frame = function () {
	const fc = e.env.cascades[1]
	const fit = `${fc.extent} ${fc.center.x} ${fc.center.z}`
	farNow = false
	frameOf.call(this)
	farRedraws.frames++
	sinceFar++
	if (!farNow) return
	if (fit !== `${fc.extent} ${fc.center.x} ${fc.center.z}`) farRedraws.fit++
	else {
		farRedraws.scene++
		if (sinceFar < 30) farRedraws.early++
	}
	sinceFar = 0
}
c.setView(c.target.x + 4 * T, c.target.y, c.target.z, c.yaw, c.pitch, c.distance)
const east = { x: c.target.x, z: c.target.z }
await P.until(
	() => {
		const s = e.worldStats()
		return s && !s.loading && !s.queued && !Number.isNaN(e.doc.world.heightAt(east.x, east.z)) ? s : null
	},
	120000,
	'the tiles four tiles east',
)
// The redraw held back for what landed comes once its frames are up.
await P.frames(32)
delete e.frame
sm.render = smRender
const moved = e.worldStats()
const westDropped = Number.isNaN(e.doc.world.heightAt(mid.x - 2 * T, mid.z))
// What the dropped tiles alone used goes with them: no batch is left without objects, and the models
// of the types gone are let go of from the registry, unless another tab, a preview or a particle uses them.
await P.frames(2)
const { isKept, withParticleModels } = await P.app('/src/lib/models/assets.ts')
const batches = [...worldDoc.objects.batches.values()]
const keep = new Set()
for (const d of e.documents) if (d !== worldDoc) d.modelTypes(keep)
withParticleModels(worldDoc.objects.modelTypes(keep))
const gone = [...typesBefore].filter((t) => !worldDoc.objects.batches.has(t))
const released = {
	empty: batches.filter((b) => b.members.size === 0).length,
	gone: gone.length,
	stillKept: gone.filter((t) => !keep.has(t) && isKept(t)).length,
}
// Edit Here: the block around the camera in a region tab (a project lent in the state, as instance-open does).
const hadProject = ui.project
ui.project = hadProject ?? { name: 'probe', path: '', clientPath: '' }
const before = { x: c.target.x, y: c.target.y, z: c.target.z }
await editWorldHere(e)
await P.until(() => (editor.regionMap === 'Azeroth' ? true : null), 180000, 'the region tab Edit Here opens')
const r = e.activeRegion()
const tile = { x: Math.floor(before.x / T), y: Math.floor(before.z / T) }
const holds = tile.x >= r.x && tile.x < r.x + r.size && tile.y >= r.y && tile.y < r.y + r.size
const regionCam = Math.hypot(c.target.x + r.x * T - before.x, c.target.z + r.y * T - before.z)
// The region's buildings stand where the world view has them, the block's corner apart: the same
// coordinates and turn as ReadRegion gives them.
const v = new e.camera.position.constructor()
const w = new e.camera.position.constructor()
let matched = 0
let checked = 0
for (const o of e.objects.objects.values()) {
	if (!o.type.startsWith('wmo:') || o.parent !== undefined) continue
	checked++
	e.objects.worldPosition(o, v)
	for (const q of worldDoc.objects.objects.values()) {
		if (q.type !== o.type) continue
		worldDoc.objects.worldPosition(q, w)
		if (Math.hypot(w.x - v.x - r.x * T, w.y - v.y, w.z - v.z - r.y * T) < 0.05 && Math.abs(q.rotY - o.rotY) < 1e-3) {
			matched++
			break
		}
	}
}
// The world view's paint is the region's: on every tile of the block the world view has painted, each
// chunk's textures and every texel's weights are the ones the region read (a chunk with no layer,
// which the world view draws bare, aside).
const regionPaint = { tiles: 0, chunks: 0, slotsOff: 0, texelsOff: 0 }
{
	// The region's palette is editor.palette (the frame hands it to the terrain's array).
	const ter = e.terrain
	const res = ter.size * 4
	const side = ter.size / 8
	const entries = worldDoc.world.painter.entries
	for (const t of worldDoc.world.tiles.values()) {
		if (!t.paint || t.x < r.x || t.y < r.y || t.x >= r.x + r.size || t.y >= r.y + r.size) continue
		regionPaint.tiles++
		const slots = t.paint.material.uniforms.slotTex.value.image.data
		const weights = t.paint.material.uniforms.weightTex.value.image.data
		for (let cy = 0; cy < 16; cy++)
			for (let cx = 0; cx < 16; cx++) {
				const c = cy * 16 + cx
				if (entries[slots[c * 4]]?.startsWith('#')) continue
				regionPaint.chunks++
				const gx = (t.x - r.x) * 16 + cx
				const gy = (t.y - r.y) * 16 + cy
				const rc = gy * side + gx
				for (let k = 0; k < 4; k++) {
					const wp = slots[c * 4 + k] === 255 ? '' : entries[slots[c * 4 + k]].toLowerCase()
					const rp = ter.chunkSlots[rc * 4 + k] === 255 ? '' : (editor.palette[ter.chunkSlots[rc * 4 + k]] ?? '?').toLowerCase()
					if (wp !== rp) regionPaint.slotsOff++
				}
				for (let v = 0; v < 32; v++)
					for (let u = 0; u < 32; u++) {
						const wi = ((cy * 32 + v) * 512 + cx * 32 + u) * 4
						const ri = ((gy * 32 + v) * res + gx * 32 + u) * 4
						if (weights[wi] !== ter.weights[ri] || weights[wi + 1] !== ter.weights[ri + 1] || weights[wi + 2] !== ter.weights[ri + 2] || weights[wi + 3] !== ter.weights[ri + 3]) regionPaint.texelsOff++
					}
			}
	}
}
// The world view's liquids are the region's: on every tile of the block, each chunk has as many layers,
// in the same order, covering the same cells at the same heights and depths as the region read.
const regionLiquids = { tiles: 0, layers: 0, off: 0 }
{
	const map = e.doc.liquids
	for (const t of worldDoc.world.tiles.values()) {
		if (!t.liquids || t.x < r.x || t.y < r.y || t.x >= r.x + r.size || t.y >= r.y + r.size) continue
		regionLiquids.tiles++
		const byChunk = new Map()
		for (const l of t.liquids) byChunk.set(l.indexY * 16 + l.indexX, [...(byChunk.get(l.indexY * 16 + l.indexX) ?? []), l])
		for (let cy = 0; cy < 16; cy++)
			for (let cx = 0; cx < 16; cx++) {
				const mine = byChunk.get(cy * 16 + cx) ?? []
				const theirs = map.layers(((t.y - r.y) * 16 + cy) * map.side + (t.x - r.x) * 16 + cx)
				if (mine.length !== theirs.length) {
					regionLiquids.off++
					continue
				}
				mine.forEach((l, k) => {
					regionLiquids.layers++
					const o = theirs[k]
					let same = true
					for (let i = 0; i < 64; i++) if (!!l.cells[i] !== !!o.cells[i]) same = false
					for (let i = 0; i < 81; i++) if (Math.abs(l.heights[i] - o.heights[i]) > 1e-3 || Math.round(o.depth[i] * 255) !== l.depth[i]) same = false
					if (!same) regionLiquids.off++
				})
			}
	}
}
// And back to the world tab, the camera where the region had it.
openWorldView(e)
await P.frames(3)
const backToWorld = e.activeDocumentId() === worldId && editor.worldMap === 'Azeroth'
const worldCam = Math.hypot(c.target.x - before.x, c.target.z - before.z)
ui.project = hadProject
const out = {
	first,
	ground: +ground.toFixed(1),
	focused,
	loadedAll,
	strides,
	strideOff,
	paint,
	drawn,
	horizon,
	modelsDrawn,
	doodads,
	perf: { models: perfModels, bare: perfBare },
	placedOnce,
	noEdit,
	commandsOff,
	sceneNamesWorld: scene.includes('"world":{"mapName":"Azeroth"}'),
	moved,
	farRedraws,
	westDropped,
	released,
	region: `${r.x},${r.y} ${r.size}`,
	holds,
	regionCam: +regionCam.toFixed(2),
	buildings: `${matched}/${checked}`,
	regionPaint,
	liquids,
	regionLiquids,
	backToWorld,
	worldCam: +worldCam.toFixed(2),
}
out.ok =
	focused &&
	Number.isFinite(ground) &&
	loadedAll &&
	strides &&
	paint.painted > 0 &&
	paint.nearUnpainted === 0 &&
	paint.farPainted === 0 &&
	paint.failed === 0 &&
	paint.drawn > 0.05 &&
	drawn > 0.05 &&
	horizon.tiles > 0 &&
	horizon.onGround === 0 &&
	horizon.drawn > 0.002 &&
	first.models > 0 &&
	modelsDrawn > 0.01 &&
	doodads.drawn > 0 &&
	doodads.past === 0 &&
	doodads.cut > 0 &&
	placedOnce &&
	noEdit &&
	lookOnly &&
	out.sceneNamesWorld &&
	moved.loaded <= first.tiles &&
	moved.loaded <= wantedTiles(east.x, east.z, keepReach(reach) + T, e.worldTiles()).length &&
	westDropped &&
	farRedraws.early === 0 &&
	farRedraws.scene > 0 &&
	released.empty === 0 &&
	released.gone > 0 &&
	released.stillKept === 0 &&
	holds &&
	regionCam < 0.5 &&
	checked > 0 &&
	matched === checked &&
	regionPaint.tiles > 0 &&
	regionPaint.chunks > 0 &&
	regionPaint.slotsOff === 0 &&
	regionPaint.texelsOff === 0 &&
	liquids.wet > 0 &&
	liquids.drawn > 0.01 &&
	regionLiquids.tiles > 0 &&
	regionLiquids.layers > 0 &&
	regionLiquids.off === 0 &&
	backToWorld &&
	worldCam < 0.5
return out
