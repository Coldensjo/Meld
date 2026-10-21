// Autosave copies a big map in slices (#546): on a dirty 1024-cell map (4x4 tiles, ~95 MB of base64), no copy is taken while a stroke is held, and the copy taken after it encodes heights and paint over many turns, with the browser's native toBase64 hidden so the slow fallback (older WebKitGTK) runs: the longest the page goes without a turn before the binding call stays far under that fallback's one-go encoding, and the copy loads back with the edit; prints the ms of each, and of the binding call (the bridge's JSON, not sliced).
const e = P.e
const { prefs } = await P.state()
const rec = await P.app('/src/lib/io/recovery.ts')
const mapio = await P.app('/src/lib/io/mapio.ts')
const App = window.go?.main?.App
if (!App?.SaveRecovery) throw new Error('no Go bindings on the page (autosave needs the backend)')

e.newDocument(1024, 'hills', 5, 'Probe autosave')
await P.frames(1)
const d = e.activeDocument()
const t = d.terrain
// A real change through History, so the tab is dirty and its change count moves.
const before = t.heights[1000]
e.history.push({ label: 'probe', undo: () => { t.heights[1000] = before }, redo: () => { t.heights[1000] = before + 7 } })
t.heights[1000] = before + 7
t.weights[12345] = 200

// Catch what autosave hands the binding, and the copies it writes.
const saves = []
const save = App.SaveRecovery
let sendAt = 0
App.SaveRecovery = async (...args) => {
	sendAt = performance.now()
	const r = await save(...args)
	saves.push({ docId: args[0], data: args[2], id: r.id })
	return r
}
const turn = () => new Promise((done) => { const ch = new MessageChannel(); ch.port1.onmessage = () => done(); ch.port2.postMessage(0) })
const oldMinutes = prefs.autosaveMinutes
try {
	prefs.autosaveMinutes = 0.0001
	await rec.autosave(e) // first sight of the dirty tab: its interval starts
	await new Promise((r) => setTimeout(r, 50))

	// A held stroke: no copy.
	e.leftDown = true
	await rec.autosave(e)
	e.leftDown = false
	if (saves.length) throw new Error('autosave copied the map while a stroke was held')

	// The copy, with a ticker measuring the longest the page goes without a turn.
	// The fallback encoder, as a WebView without Uint8Array.prototype.toBase64 runs it.
	const proto = Uint8Array.prototype
	const native = Object.getOwnPropertyDescriptor(proto, 'toBase64')
	if (native) delete proto.toBase64
	let running = true
	let longest = 0
	let turns = 0
	let sendMs = 0
	const ticker = (async () => {
		let last = performance.now()
		while (running) {
			await turn()
			const now = performance.now()
			if (sendAt) {
				sendMs = Math.max(sendMs, now - Math.max(last, sendAt))
				if (sendAt > last) longest = Math.max(longest, sendAt - last)
			} else {
				longest = Math.max(longest, now - last)
				turns++
			}
			last = now
		}
	})()
	let oneGoMs = 0
	let whole
	try {
		await rec.autosave(e)
		running = false
		await ticker
		// The same map encoded in one go, as before #546.
		const t1 = performance.now()
		whole = mapio.toMapData(e.snapshotOf(d))
		oneGoMs = performance.now() - t1
	} finally {
		running = false
		if (native) Object.defineProperty(proto, 'toBase64', native)
	}
	const mine = saves.filter((s) => s.docId === d.id)
	if (mine.length !== 1) throw new Error(`autosave wrote ${mine.length} copies of the tab, not 1`)

	const got = mine[0].data
	for (const k of ['heights', 'weights', 'chunkSlots', 'holes']) if (got[k] !== whole[k]) throw new Error(`the sliced copy's ${k} differ from the one-go encoding`)

	// It loads back as the map.
	const back = mapio.fromMapData(await App.LoadRecovery(mine[0].id))
	const h = new Float32Array(back.heights.slice().buffer)
	if (h[1000] !== before + 7 || back.weights[12345] !== 200 || h.length !== t.heights.length) throw new Error('the copy did not load back with the edit')
	await App.DropRecovery(mine[0].id)

	const slices = Math.ceil(t.weights.length / (3 << 20))
	if (turns < slices) throw new Error(`the encoding took ${turns} turns, under the ${slices} slices of the paint`)
	if (longest > oneGoMs / 3) throw new Error(`the longest stretch without a turn before the binding call was ${longest.toFixed(1)} ms against ${oneGoMs.toFixed(1)} ms in one go`)
	const mb = (s) => Math.round((s?.length ?? 0) / 1e5) / 10
	const ms = (v) => Math.round(v * 10) / 10
	return { size: t.size, base64MB: { heights: mb(got.heights), weights: mb(got.weights), chunkSlots: mb(got.chunkSlots) }, turns, longestBeforeSendMs: ms(longest), oneGoFallbackMs: ms(oneGoMs), bindingCallMs: ms(sendMs) }
} finally {
	App.SaveRecovery = save
	prefs.autosaveMinutes = oldMinutes
	for (const s of saves) await App.DropRecovery(s.id).catch(() => {})
}
