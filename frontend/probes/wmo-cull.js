// Stormwind, drawn once in the benchmark scene, is culled by WMO group (#198): far fewer triangles than drawn whole.
await P.scene(P.BENCH)
await P.settle()
const { WmoGroupCull } = await P.app('/src/lib/world/wmoGroupCull.ts')
const batch = await P.until(() => [...P.e.objects.batches.entries()].find(([k, b]) => k.includes('stormwind.wmo') && b.cull), 300_000, 'the Stormwind batch')
const storm = async () => {
	await P.frames(3)
	const r = await P.perf()
	return { frame: r.triangles, stormwind: r.models.find((m) => m.type.includes('stormwind.wmo'))?.triangles ?? 0 }
}
const on = await storm()
WmoGroupCull.enabled = false
const off = await storm()
WmoGroupCull.enabled = true
return {
	ok: on.stormwind > 0 && on.stormwind * 4 < off.stormwind,
	culled: on,
	whole: off,
	batch: batch[0].split(/[\\/]/).pop(),
}
