// Stormwind, drawn once in the benchmark scene, is culled by WMO group (#198) in the scene pass and the near shadow cascade (#215): far fewer triangles than drawn whole, and the same picture.
// At the benchmark view the city is outside the near cascade's box, which since #325 leaves it out of that pass whole, so the near cascade's group cull is measured over the city.
// touches: frontend/src/lib/world/wmoGroupCull.ts, frontend/src/lib/world/ObjectLayer.ts, frontend/src/lib/engine/shadowCascades.ts
await P.scene(P.BENCH)
await P.settle()
const batch = await P.until(() => [...P.e.objects.batches.entries()].find(([k, b]) => k.includes('stormwind.wmo') && b.cull), 120_000, 'the Stormwind batch')
// The class the batch was made with: an import gives another module instance after an edit (Vite's `?t=` URLs).
const WmoGroupCull = batch[1].cull.constructor
// The triangles the near cascade drew in its last redraw on its own: three draws the shadow maps inside
// renderer.render. A frame that also redrew the far map doesn't count: it draws the city whole with the
// cull on or off, and it is redrawn whenever the scene changes, as when a spawn's model arrives after the
// settle (#392: the culled read caught such a frame, 1.9M against the whole read's 173k).
const sm = P.e.renderer.shadowMap
const render = sm.render
const { key, far } = P.e.env
let shadow = -1
sm.render = function (...args) {
	const info = P.e.renderer.info.render
	const t = info.triangles
	const nearOnly = key.shadow.needsUpdate && !far.shadow.needsUpdate
	render.apply(this, args)
	if (nearOnly) shadow = info.triangles - t
}
// The city's own count, from its batch: the report lists only the top five models, and the culled city
// (2k triangles at 13:00) falls off it, which read as 0 (#252).
const { meshTriangles } = await P.app('/src/lib/engine/perfMeter.ts')
const storm = async () => {
	await P.frames(3)
	const r = await P.perf(1)
	// The near map is kept while nothing changes, so it is asked for again until a frame redraws it alone.
	shadow = -1
	await P.until(
		() => {
			key.shadow.needsUpdate = true
			return shadow >= 0
		},
		30_000,
		'a redraw of the near shadow map alone',
	)
	return { frame: r.triangles, shadow, stormwind: meshTriangles(batch[1].mesh) }
}
let on, off, cityOn, cityOff, look
try {
	on = await storm()
	WmoGroupCull.enabled = false
	off = await storm()
	WmoGroupCull.enabled = true
	// The same picture culled and whole, over the city (#198 had 0.14% of pixels differ there, edges and
	// swaying trees): two culled shots give the noise floor.
	P.e.setSceneView({ target: [-300, 120, 250], yaw: 4.71, pitch: 0.25, distance: 500, hour: 13 })
	await P.settle()
	cityOn = await storm()
	WmoGroupCull.enabled = false
	cityOff = await storm()
	WmoGroupCull.enabled = true
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
	// The 0.1% slack: a posed model at the cascade edge once made the two counts differ by 16 triangles (#350).
	// Over the city the near cascade draws about 390k fewer triangles with the cull; the far one is redrawn only when its fit changes.
	ok: on.stormwind > 0 && on.stormwind * 4 < off.stormwind && on.shadow <= off.shadow * 1.001 && cityOff.shadow - cityOn.shadow > 200_000 && look.ok,
	culled: on,
	whole: off,
	city: { culled: cityOn, whole: cityOff },
	look,
	batch: batch[0].split(/[\\/]/).pop(),
}
