// What the hover outline (#641) costs with Stormwind under the pointer (#642): the triangles its mask pass draws, and on the real GPU (`PROBE_GPU=1`) the Outlines pass's ms with the pref on and off. The mask draws only the WMO groups the scene pass draws (the group cull), so it costs far less than the whole city.
// touches: frontend/src/lib/engine/SelectionOutline.ts, frontend/src/lib/world/wmoGroupCull.ts
const e = P.e
const { prefs } = await P.state()
await P.scene(P.BENCH)
await P.settle()
const batch = await P.until(() => [...e.objects.batches.entries()].find(([k, b]) => k.includes('stormwind.wmo') && b.cull), 120_000, 'the Stormwind batch')
const storm = [...e.objects.objects.values()].find((o) => o.type.toLowerCase().includes('stormwind.wmo'))
// In a street of the city, where the scene pass draws about 96k of its 1.33M triangles (`PROBE_VIEW` takes another view's JSON).
e.setSceneView(JSON.parse(P.env('VIEW', JSON.stringify({ target: [-300, 100, 250], yaw: 4.71, pitch: 0.05, distance: 40, hour: 13 }))))
await P.settle()
prefs.hoverOutline = true
// The first point of a grid over the viewport that hovers the city.
let at = null
for (let y = 0.3; y <= 0.8 && !at; y += 0.1)
	for (let x = 0.2; x <= 0.8 && !at; x += 0.1) {
		P.pointer('pointermove', x, y)
		await P.frames(2)
		if (e.hovered.id === storm.id && e.hoverOutline.active) at = [x, y]
	}
if (!at) return { ok: false, bad: 'no point of the viewport hovers Stormwind' }

// The mask pass's triangles: the outline's own render call into its mask.
const outline = e.hoverOutline
const r3 = e.renderer
const render = r3.render
let mask = -1
r3.render = function (scene, camera) {
	render.call(this, scene, camera)
	if (scene === outline.maskScene) mask = r3.info.render.triangles
}
const { meshTriangles } = await P.app('/src/lib/engine/perfMeter.ts')
const WmoGroupCull = batch[1].cull.constructor
const runs = { on: [], off: [], whole: [] }
let city, whole
try {
	await P.frames(3)
	city = { scene: meshTriangles(batch[1].mesh), mask }
	WmoGroupCull.enabled = false
	await P.frames(3)
	whole = { scene: meshTriangles(batch[1].mesh), mask }
	WmoGroupCull.enabled = true
	// The Outlines pass's GPU ms (null without timer queries, as on SwiftShader), the pref on and off, alternated.
	const n = P.env('WINDOWS', 2)
	for (let i = 0; i < n; i++)
		for (const on of i % 2 ? [true, false] : [false, true]) {
			prefs.hoverOutline = on
			P.pointer('pointermove', ...at)
			await P.frames(3)
			const r = await P.perf(1)
			runs[on ? 'on' : 'off'].push(r.gpu ? r.gpu[2] : null)
		}
	// And on, with the cull off: what the mask cost before #642.
	prefs.hoverOutline = true
	WmoGroupCull.enabled = false
	for (let i = 0; i < n; i++) {
		P.pointer('pointermove', ...at)
		await P.frames(3)
		const r = await P.perf(1)
		runs.whole.push(r.gpu ? r.gpu[2] : null)
	}
} finally {
	r3.render = render
	WmoGroupCull.enabled = true
}
const mean = (a) => (a.some((v) => v === null) ? null : Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 1000) / 1000)
const gl = r3.getContext()
const info = gl.getExtension('WEBGL_debug_renderer_info')
return {
	// The mask draws about what the scene pass draws of the city, and far fewer than the whole city.
	ok: city.mask > 0 && city.mask < whole.mask / 4 && city.mask <= city.scene * 1.05 + 2,
	at,
	city,
	whole,
	outlinesGpuMs: { off: mean(runs.off), on: mean(runs.on), onWhole: mean(runs.whole) },
	renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
}
