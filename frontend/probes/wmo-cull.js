// Stormwind, drawn once in the benchmark scene, is culled by WMO group (#198) in the scene pass and the near shadow cascade (#215): far fewer triangles than drawn whole.
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
let on, off
try {
	on = await storm()
	WmoGroupCull.enabled = false
	off = await storm()
} finally {
	WmoGroupCull.enabled = true
	sm.render = render
}
return {
	// The near cascade holds about 2k of the city's 1.33M triangles; the far one is redrawn only when its fit changes.
	ok: on.stormwind > 0 && on.stormwind * 4 < off.stormwind && off.shadow - on.shadow > 1_000_000,
	culled: on,
	whole: off,
	batch: batch[0].split(/[\\/]/).pop(),
}
