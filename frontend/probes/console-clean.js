// Opening the world format's fixture (crates/world/tests/fixtures/small.world) and drawing it logs no console warning or error and no HTTP 400+ besides known ones (#336).
// Known messages, each with its issue; drop an entry when its issue is fixed.
const known = [
]
if (!window.go?.main?.App?.LoadWorld) throw new Error('no Go bindings on the page (cube worlds need the backend)')
const seen = []
const wrap = (level) => {
	const orig = console[level]
	console[level] = (...args) => {
		seen.push({ level, text: args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ').slice(0, 200) })
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
try {
	const mapio = await P.app('/src/lib/io/mapio.ts')
	await mapio.openPath(P.e, '../crates/world/tests/fixtures/small.world')
	const d = P.e.activeDocument()
	await P.until(() => !d?.world || d.cubes.pending === 0, 60_000, 'the chunks built')
	await P.settle()
} finally {
	restore.forEach((r) => r())
	window.removeEventListener('error', onError)
	window.removeEventListener('unhandledrejection', onError)
}
const res = performance.getEntriesByType('resource').filter((r) => r.startTime >= t0)
const failed = res.filter((r) => r.responseStatus >= 400).map((r) => `${r.responseStatus} ${decodeURIComponent(r.name.replace(location.origin, ''))}`)
const knownOf = (text) => known.find(([re]) => re.test(text))?.[1]
const unexpected = seen.filter((m) => !knownOf(m.text))
return {
	ok: failed.length === 0 && unexpected.length === 0 && !!P.e.activeDocument()?.world,
	requests: res.length,
	failed: failed.slice(0, 10),
	unexpected: unexpected.slice(0, 10),
	known: seen.filter((m) => knownOf(m.text)).map((m) => `${knownOf(m.text)}: ${m.text.slice(0, 80)}`).slice(0, 5),
}
