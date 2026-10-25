// Loading Northshire (P.BENCH) logs no console warning or error and no HTTP 400+ besides known ones, and the terrain asks only for the sheen twins that exist (#336).
// Known messages, each with its issue; drop an entry when its issue is fixed.
// touches: frontend/src/lib/terrain/paletteArray.ts, frontend/src/lib/terrain/sheen.ts, frontend/src/lib/terrain/TerrainMaterial.ts, internal/wow/client.go
const known = []
const seen = []
const wrap = (level) => {
	const orig = console[level]
	console[level] = (...args) => {
		seen.push({
			level,
			text: args
				.map((a) => (a instanceof Error ? a.message : String(a)))
				.join(' ')
				.slice(0, 200),
		})
		return orig.apply(console, args)
	}
	return () => (console[level] = orig)
}
const restore = [wrap('warn'), wrap('error')]
const onError = (ev) => seen.push({ level: 'exception', text: String(ev.message ?? ev.reason).slice(0, 200) })
window.addEventListener('error', onError)
window.addEventListener('unhandledrejection', onError)
// Every request of the load, with its status (Chrome's responseStatus); the buffer holds 250 by default.
// Don't clear it: P.app finds the page's modules among its entries.
performance.setResourceTimingBufferSize(100000)
const t0 = performance.now()
const noTwin = 'Tileset\\Elwynn\\ElwynnRockBase.blp'
const withTwin = 'Tileset\\Elwynn\\ElwynnGrassBase.blp'
let extra = null
try {
	await P.scene(P.BENCH)
	await P.settle()
	await P.frames(5)
	// Northshire's palette has a twin for every texture, so load one without (ElwynnRockBase) beside one with.
	const { PaletteArray } = await P.app('/src/lib/terrain/paletteArray.ts')
	extra = new PaletteArray(() => {}, false)
	extra.set([noTwin, withTwin])
	await P.until(() => extra.loaded?.size === 2 || seen.length > 0, 20000, 'the extra palette loads')
	await P.settle()
} finally {
	extra?.dispose()
	restore.forEach((r) => r())
	window.removeEventListener('error', onError)
	window.removeEventListener('unhandledrejection', onError)
}
const res = performance.getEntriesByType('resource').filter((r) => r.startTime >= t0)
const failed = res.filter((r) => r.responseStatus >= 400).map((r) => `${r.responseStatus} ${decodeURIComponent(r.name.replace(location.origin, ''))}`)
const sheen = res.filter((r) => /_s\.blp/i.test(decodeURIComponent(r.name)))
const knownOf = (text) => known.find(([re]) => re.test(text))?.[1]
const unexpected = seen.filter((m) => !knownOf(m.text))
// The palette's paths, and how many of them have a twin: each twin is asked for once, and none other.
const { hasSheenTwin } = await P.app('/src/lib/terrain/paletteArray.ts')
const paths = P.e.terrain.palette.entries.filter((p) => p && !p.startsWith('#'))
const twins = (await Promise.all(paths.map((p) => hasSheenTwin(p)))).filter(Boolean).length
return {
	ok: failed.length === 0 && unexpected.length === 0 && twins > 0 && sheen.length >= twins && sheen.every((r) => r.responseStatus === 200) && !(await hasSheenTwin(noTwin)) && (await hasSheenTwin(withTwin)),
	requests: res.length,
	failed: failed.slice(0, 10),
	unexpected: unexpected.slice(0, 10),
	known: seen
		.filter((m) => knownOf(m.text))
		.map((m) => `${knownOf(m.text)}: ${m.text.slice(0, 80)}`)
		.slice(0, 5),
	palette: paths.length,
	twins,
	sheenRequests: sheen.length,
}
