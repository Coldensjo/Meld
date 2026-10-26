// A far WMO's LOD draws its groups merged by class (#691), its textures from the shared layer array: in Elwynn's world view every far WMO drawn has the merged LOD, with a few groups each instead of one a texture, every layer taken is drawn; and a house drawn with its LOD close up (every instance forced to its LOD, the doodads hidden) looks as the full house does: under a fifth of its middle differs, far less than with the LOD's class materials hidden (a blank or grey layer array would not be).
// touches: frontend/src/lib/models/farLayers.ts, frontend/src/lib/models/lod.ts, frontend/src/lib/models/modelData.ts, frontend/src/lib/models/modelBuild.ts, frontend/src/lib/models/assets.ts, frontend/src/lib/world/ObjectLayer.ts
const { editor } = await P.state()
const e = P.e
const { openWorldView } = await P.app('/src/lib/io/region.ts')
const { farLayerCounts } = await P.app('/src/lib/models/farLayers.ts')
const T = 1600 / 3
openWorldView(e, 'Azeroth', { x: 31, y: 48, size: 3 })
await P.until(() => editor.worldMap === 'Azeroth' || null, 30000, "Azeroth's world tab")
await P.until(
	() => {
		const s = e.worldStats()
		return s && s.loaded >= 9 && !s.loading && !s.queued ? s : null
	},
	180000,
	'the tiles around the camera loaded',
)
const mid = { x: 32.5 * T, z: 49.5 * T }
await P.lookAt({ x: mid.x, y: e.doc.world.heightAt(mid.x, mid.z) + 120, z: mid.z + 300 }, { pitch: 0.35, back: 1 })
await P.settle()
await P.frames(10)
// The far WMOs drawn: merged, a few groups each.
const far = { batches: 0, merged: 0, groups: 0 }
for (const [type, b] of e.objects.batches) {
	if (!type.startsWith('wmo:') || !b.lod || !b.lod.visible || !b.lod.count) continue
	far.batches++
	if (b.lod.geometry.userData.farLayers) far.merged++
	far.groups += b.lod.geometry.groups.length
}
const layers = farLayerCounts()
// The WMO nearest Goldshire of a house's size, close up, the doodads hidden.
const goldshire = { x: 32.3 * T, z: 49.35 * T }
let best = null
for (const [type, b] of e.objects.batches) {
	if (!type.startsWith('wmo:') || !b.lod?.geometry.userData.farLayers) continue
	const sp = b.rows.spheres
	for (let i = 0; i < b.rows.items.length; i++) {
		const r = sp[i * 4 + 3]
		if (r < 8 || r > 60) continue
		const d = Math.hypot(sp[i * 4] - goldshire.x, sp[i * 4 + 2] - goldshire.z)
		if (!best || d < best.d) best = { d, type, batch: b, x: sp[i * 4], y: sp[i * 4 + 1], z: sp[i * 4 + 2], r }
	}
}
let look = null
if (best) {
	const hidden = []
	for (const [type, b] of e.objects.batches)
		if (type.startsWith('m2:'))
			for (const m of [b.mesh, b.lod]) {
				if (!m) continue
				m.layers.set(7)
				hidden.push(m)
			}
	try {
		await P.lookAt(best, { pitch: 0.45, back: best.r * 2.2, yaw: 1 })
		await P.settle()
		await P.frames(5)
		const full = await P.shot()
		const fullDrawn = best.batch.mesh.count
		// Every instance with its LOD.
		Object.defineProperty(e.cullView, 'lodPx', { get: () => 1e9, set() {}, configurable: true })
		await P.frames(5)
		const lod = await P.shot()
		const lodDrawn = best.batch.lod.count
		// The house's middle, where it fills the frame.
		const region = { x0: 0.35, x1: 0.65, y0: 0.3, y1: 0.75 }
		const classes = best.batch.lod.material.filter((m) => m.userData.far)
		for (const m of classes) m.visible = false
		const none = await P.shot()
		for (const m of classes) m.visible = true
		const close = P.diff(full, lod, 24, region)
		const gone = P.diff(full, none, 24, region)
		look = { house: best.type.split(/[\\/]/).pop(), fullDrawn, lodDrawn, lodOff: +close.off.toFixed(3), hiddenOff: +gone.off.toFixed(3) }
	} finally {
		delete e.cullView.lodPx
		for (const m of hidden) m.layers.set(0)
	}
}
return {
	ok: far.batches > 10 && far.merged * 10 >= far.batches * 8 && far.groups < far.batches * 10 && layers.layers > 0 && layers.queued === 0 && !!look && look.lodDrawn > 0 && look.lodOff < 0.2 && look.lodOff * 2.5 < look.hiddenOff,
	far,
	layers,
	look,
}
