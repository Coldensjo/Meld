// A region's alpha maps cross as one GET from the asset server, not in LoadRegion's JSON (#636): for Azeroth 31_49 3x3 the reply has no layer alpha and an alphaUrl, the fetched bytes are 4096 for every layer but each chunk's first, a second fetch of the same URL is a 404 (a handoff is served once), and the times of the call and the fetch.
// touches: app.go, internal/vmangos/region.go, internal/adt/clientalpha.go, frontend/src/lib/io/region.ts
const App = window.go.main.App
const ALPHA_BYTES = 64 * 64
const runs = []
let view
let bytes
for (let i = 0; i < 3; i++) {
	const t0 = performance.now()
	view = await App.LoadRegion('Azeroth', 31, 49, 3)
	const t1 = performance.now()
	const res = await fetch(view.alphaUrl)
	bytes = new Uint8Array(await res.arrayBuffer())
	runs.push({ call: Math.round(t1 - t0), fetch: Math.round(performance.now() - t1), status: res.status })
}
let layers = 0
let alphaInJson = 0
for (const c of view.chunks) {
	layers += Math.max((c.layers ?? []).length - 1, 0)
	for (const l of c.layers ?? []) if ('alpha' in l) alphaInJson++
}
const again = await fetch(view.alphaUrl)
const jsonMB = +(JSON.stringify(view).length / 1e6).toFixed(2)
return {
	ok: !!view.alphaUrl && alphaInJson === 0 && layers > 0 && bytes.length === layers * ALPHA_BYTES && runs.every((r) => r.status === 200) && again.status === 404 && jsonMB < 10,
	chunks: view.chunks.length,
	layers,
	alphaMB: +(bytes.length / 1e6).toFixed(2),
	jsonMB,
	secondFetch: again.status,
	runs,
}
