// Autosave copies a big map in slices (#546) and sends it in parts (#637): on a dirty 1024-cell map (4x4 tiles, ~95 MB of base64), no copy is taken while a stroke is held, and the second copy (the first warms the bridge, whose first tens of MB pause a page once) encodes heights and paint a slice a turn, with the browser's native toBase64 hidden so the slow fallback (older WebKitGTK) runs, and sends each slice through its own SaveRecoveryPart call: the longest the page goes without a turn before the first part, and the longest part call, stay far under that fallback's one-go encoding, the parts join into the one-go encoding, and the copy loads back with both edits; prints the ms of each, and bindingCallMs, the longest stretch without a turn from the first part on: 55-760 ms across runs (most under 300) against 290-530 ms for the whole map in one call before #637, the rest of it pauses of the headless page with no script running (no part call is over 15 ms), so it is printed, not checked.
// touches: frontend/src/lib/io/recovery.ts, frontend/src/lib/io/mapData.ts, app.go, internal/recovery/*
const e = P.e
const { prefs } = await P.state()
const rec = await P.app('/src/lib/io/recovery.ts')
const mapData = await P.app('/src/lib/io/mapData.ts')
const App = window.go?.main?.App
if (!App?.SaveRecoveryPart) throw new Error('no Go bindings on the page (autosave needs the backend)')

e.newDocument(1024, 'hills', 5, 'Probe autosave')
await P.frames(1)
const d = e.activeDocument()
const t = d.terrain
// A real change through History, so the tab is dirty and its change count moves.
const before = t.heights[1000]
e.history.push({
	label: 'probe',
	undo: () => {
		t.heights[1000] = before
	},
	redo: () => {
		t.heights[1000] = before + 7
	},
})
t.heights[1000] = before + 7

// Catch what autosave hands the bindings, and the copies it writes.
const saves = []
const parts = []
const warm = []
const save = App.SaveRecovery
const savePart = App.SaveRecoveryPart
let sendAt = 0
let partCallMs = 0
App.SaveRecoveryPart = (...args) => {
	const t0 = performance.now()
	if (!sendAt) sendAt = t0
	parts.push(args)
	const r = savePart(...args)
	partCallMs = Math.max(partCallMs, performance.now() - t0)
	return r
}
App.SaveRecovery = async (...args) => {
	const r = await save(...args)
	saves.push({ docId: args[0], data: args[2], id: r.id })
	return r
}
const turn = () =>
	new Promise((done) => {
		const ch = new MessageChannel()
		ch.port1.onmessage = () => done()
		ch.port2.postMessage(0)
	})
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

	// A first copy, not measured: a page's first tens of MB across the bridge pause it once for 300-700 ms,
	// with no script running, as much for one whole-map call as for the parts (#637), which would hide the
	// cost each later copy pays.
	await rec.autosave(e)
	if (saves.length !== 1) throw new Error(`the first autosave wrote ${saves.length} copies, not 1`)
	warm.push(saves[0].id)
	saves.length = 0
	parts.length = 0
	sendAt = 0
	partCallMs = 0
	// A second change, which the measured copy must hold too.
	e.history.push({
		label: 'probe paint',
		undo: () => {
			t.weights[12345] = 0
		},
		redo: () => {
			t.weights[12345] = 200
		},
	})
	t.weights[12345] = 200
	await new Promise((r) => setTimeout(r, 50))

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
			}
			turns++
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
		whole = mapData.toMapData(e.snapshotOf(d))
		oneGoMs = performance.now() - t1
	} finally {
		running = false
		if (native) Object.defineProperty(proto, 'toBase64', native)
	}
	const mine = saves.filter((s) => s.docId === d.id)
	if (mine.length !== 1) throw new Error(`autosave wrote ${mine.length} copies of the tab, not 1`)

	const got = { ...mine[0].data }
	for (const k of ['heights', 'weights', 'chunkSlots']) {
		if (got[k]) throw new Error(`SaveRecovery itself carried the ${k}, not only the parts`)
		const mineK = parts.filter((p) => p[0] === d.id && p[1] === k)
		if (mineK.some((p, i) => p[2] !== i)) throw new Error(`the parts of ${k} were not sent in order`)
		got[k] = mineK.map((p) => p[3]).join('')
	}
	const longestPart = Math.max(...parts.map((p) => p[3].length))
	if (longestPart > 4.5e6) throw new Error(`a part was ${longestPart} characters, over a slice's 4 MB of base64`)
	for (const k of ['heights', 'weights', 'chunkSlots', 'holes']) if (got[k] !== whole[k]) throw new Error(`the sliced copy's ${k} differ from the one-go encoding`)

	// It loads back as the map.
	const back = mapData.fromMapData(await App.LoadRecovery(mine[0].id))
	const h = new Float32Array(back.heights.slice().buffer)
	if (h[1000] !== before + 7 || back.weights[12345] !== 200 || h.length !== t.heights.length) throw new Error('the copy did not load back with the edit')
	await App.DropRecovery(mine[0].id)

	const slices = Math.ceil(t.weights.length / (3 << 20))
	if (turns < slices) throw new Error(`the encoding took ${turns} turns, under the ${slices} slices of the paint`)
	if (longest > oneGoMs / 3) throw new Error(`the longest stretch without a turn before the first part was ${longest.toFixed(1)} ms against ${oneGoMs.toFixed(1)} ms in one go`)
	if (partCallMs > oneGoMs / 3) throw new Error(`a SaveRecoveryPart call kept the page ${partCallMs.toFixed(1)} ms against ${oneGoMs.toFixed(1)} ms in one go`)
	const mb = (s) => Math.round((s?.length ?? 0) / 1e5) / 10
	const ms = (v) => Math.round(v * 10) / 10
	return {
		size: t.size,
		parts: parts.length,
		base64MB: { heights: mb(got.heights), weights: mb(got.weights), chunkSlots: mb(got.chunkSlots) },
		turns,
		longestBeforeSendMs: ms(longest),
		partCallMs: ms(partCallMs),
		oneGoFallbackMs: ms(oneGoMs),
		bindingCallMs: ms(sendMs),
	}
} finally {
	App.SaveRecovery = save
	App.SaveRecoveryPart = savePart
	prefs.autosaveMinutes = oldMinutes
	for (const id of [...warm, ...saves.map((s) => s.id)]) await App.DropRecovery(id).catch(() => {})
}
