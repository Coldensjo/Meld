// Stormwind, drawn once in the benchmark scene, is culled by WMO group (#198) in the scene pass and the near shadow cascade (#215): far fewer triangles than drawn whole, and the same picture.
await P.scene(P.BENCH)
await P.settle()
const batch = await P.until(() => [...P.e.objects.batches.entries()].find(([k, b]) => k.includes('stormwind.wmo') && b.cull), 300_000, 'the Stormwind batch')
// The class the batch was made with: an import gives another module instance after an edit (Vite's `?t=` URLs).
const WmoGroupCull = batch[1].cull.constructor
// The triangles the shadow maps drew in the last frame: three draws them inside renderer.render.
const sm = P.e.renderer.shadowMap
const render = sm.render
let shadow = 0
sm.render = function (...args) {
	const info = P.e.renderer.info.render
	const t = info.triangles
	render.apply(this, args)
	shadow = info.triangles - t
}
const storm = async () => {
	await P.frames(3)
	const r = await P.perf()
	return { frame: r.triangles, shadow, stormwind: r.models.find((m) => m.type.includes('stormwind.wmo'))?.triangles ?? 0 }
}
let on, off, look
try {
	on = await storm()
	WmoGroupCull.enabled = false
	off = await storm()
	WmoGroupCull.enabled = true
	// The same picture culled and whole, over the city (#198 had 0.14% of pixels differ there, edges and
	// swaying trees): two culled shots give the noise floor.
	P.e.setSceneView({ target: [-300, 120, 250], yaw: 4.71, pitch: 0.25, distance: 500, hour: 13 })
	await P.settle()
	await P.frames(3)
	const a = await P.shot()
	const b = await P.shot()
	WmoGroupCull.enabled = false
	await P.frames(2)
	const c = await P.shot()
	const noise = P.diff(a, b)
	const cull = P.diff(a, c)
	look = { noiseOff: +(noise.off * 100).toFixed(2) + '%', cullOff: +(cull.off * 100).toFixed(2) + '%', lit: +a.lit.toFixed(2), ok: a.lit > 0.2 && cull.off < noise.off + 0.01 }
} finally {
	WmoGroupCull.enabled = true
	sm.render = render
}
return {
	// The near cascade holds about 2k of the city's 1.33M triangles; the far one is redrawn only when its fit changes.
	ok: on.stormwind > 0 && on.stormwind * 4 < off.stormwind && off.shadow - on.shadow > 1_000_000 && look.ok,
	culled: on,
	whole: off,
	look,
	batch: batch[0].split(/[\\/]/).pop(),
}
