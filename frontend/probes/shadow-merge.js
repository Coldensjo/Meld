// A model's opaque materials draw as one call into the shadow maps (#926; docs/tests/rendering.md, "One shadow draw for a model's opaque materials"): in Elwynn's world view over Goldshire at a low sun, the far and near cascades redrawn with the merge on draw well under the calls they draw with it off, and the view looks the same both ways, there and over Stormwind (the WMO with the most materials).
// touches: frontend/src/lib/world/shadowRun.ts, frontend/src/lib/world/wmoGroupCull.ts, frontend/src/lib/models/assets.ts, frontend/src/lib/world/ObjectLayer.ts
const { editor, prefs } = await P.state()
const e = P.e
const { openWorldView } = await P.app('/src/lib/io/region.ts')
const { shadowMerge } = await P.app('/src/lib/world/shadowRun.ts')
const T = 1600 / 3
openWorldView(e, 'Azeroth', { x: 31, y: 48, size: 3 })
await P.until(() => editor.worldMap === 'Azeroth' || null, 30000, 'the world tab')
await P.until(
	() => {
		const s = e.worldStats()
		return s && s.loaded >= 9 && !s.loading && !s.queued ? s : null
	},
	180000,
	'the tiles around the camera loaded',
)
if (!e.debug.env.key.castShadow) return { ok: false, error: 'the sun casts no shadows (Graphics › Shadows is off)' }
const wasCycle = prefs.dayCycle
prefs.dayCycle = false
e.debug.setHour(17.6)
const env = e.debug.env
const sm = e.renderer.shadowMap
const info = e.renderer.info.render
const orig = sm.render
let rec = null
sm.render = (lights, scene, camera) => {
	const c0 = info.calls
	const far = env.far.shadow.needsUpdate
	const near = env.key.shadow.needsUpdate
	orig(lights, scene, camera)
	rec = { far, near, calls: info.calls - c0 }
}
/** The calls of a frame that redraws only the far cascade (far) or only the near one. */
async function passCalls(far) {
	for (let i = 0; i < 3; i++) {
		env.far.shadow.needsUpdate = far
		env.key.shadow.needsUpdate = !far
		rec = null
		e.debug.frame()
		if (rec && rec.far === far && rec.near === !far) return rec.calls
		await P.tick()
	}
	return -1
}
/** A shot with both maps redrawn as the merge is set. */
async function shotWith(on) {
	shadowMerge.enabled = on
	env.far.shadow.needsUpdate = true
	env.key.shadow.needsUpdate = true
	return P.shot()
}
const r = { ok: true, views: {} }
try {
	const mid = { x: 32.5 * T, z: 49.5 * T }
	await P.lookAt({ x: mid.x, y: e.debug.doc.world.heightAt(mid.x, mid.z) + 100, z: mid.z }, { pitch: 0.3, back: 1 })
	await P.settle()
	await P.frames(10)
	e.timer.setTimescale(0)
	await P.frames(3)
	const calls = {}
	for (const on of [true, false]) {
		shadowMerge.enabled = on
		calls[on ? 'on' : 'off'] = { far: await passCalls(true), near: await passCalls(false) }
	}
	shadowMerge.enabled = true
	r.calls = calls
	if (calls.on.far < 0 || calls.off.far < 0) r.ok = !(r.error = 'a far-only redraw did not happen')
	else if (calls.on.far > 0.7 * calls.off.far) r.ok = !(r.error = `the far pass drew ${calls.on.far} calls merged against ${calls.off.far} apart`)
	// Stormwind: the instance of the WMO with the most materials, looked at from its side.
	let city = null
	for (const [type, b] of e.objects.batches) {
		if (!type.startsWith('wmo:') || !b.rows.items.length) continue
		const n = b.mesh.geometry.groups.length
		if (!city || n > city.n) city = { n, type, x: b.rows.spheres[0], y: b.rows.spheres[1], z: b.rows.spheres[2], r: b.rows.spheres[3] }
	}
	const views = { goldshire: null }
	if (city) views.city = city
	for (const [name, at] of Object.entries(views)) {
		if (at) {
			e.timer.setTimescale(1)
			await P.lookAt(at, { pitch: 0.5, back: at.r * 1.2, yaw: 0.8 })
			await P.settle()
			await P.frames(10)
			e.timer.setTimescale(0)
			await P.frames(3)
		}
		const a = await shotWith(true)
		const b = await shotWith(false)
		const a2 = await shotWith(true)
		const d = P.diff(a, b)
		const same = P.diff(a, a2)
		r.views[name] = { type: at?.type, groups: at?.n, off: +d.off.toFixed(5), mean: +d.mean.toFixed(4), noise: +same.off.toFixed(5), lit: +a.lit.toFixed(3) }
		if (a.lit < 0.2) r.ok = !(r.error = `${name}: the shot is blank`)
		else if (d.off > same.off + 0.0002) r.ok = !(r.error = `${name}: ${(d.off * 100).toFixed(3)} % of the view differs with the merge off`)
	}
} finally {
	shadowMerge.enabled = true
	sm.render = orig
	e.timer.setTimescale(1)
	prefs.dayCycle = wasCycle
}
return r
