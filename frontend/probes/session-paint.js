// Texture paint in a shared session (#1002): the page hosts a flat map, a scripted guest (meldtool session join, through P.bun) sends a `paint` message with a texture the page's palette lacks, and the page appends it and takes the chunk; then a Paint stroke with a new texture and its undo in the page go out live as `paint` messages, and the paint the bot's messages give in the host's order matches the page's, compared by texture path.
// touches: frontend/src/lib/session/**, frontend/src/lib/terrain/Terrain.ts, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const { editor } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { bytesToBase64, base64ToBytes } = await P.app('/src/lib/io/base64.ts')
const { shared } = S
const SLOTS = 4
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(64, 'flat', 0, 'Paint Probe')
// A colour of its own keeps App's default-palette swap (the client's tilesets for the swatches) from renaming the entries under the probe.
editor.palette = [...editor.palette, '#010203']
await P.frames(2)
await new Promise((r) => setTimeout(r, 300))
const t = e.terrain
const side = t.paintChunksPerSide
const res = t.splatRes
const per = res / side
const start = { w: Uint8Array.from(t.weights), s: Uint8Array.from(t.chunkSlots), p: [...editor.palette] }
await S.hostSession(0, 'Probe')
// The bot's edit: chunk 9 all one new colour.
const botTex = '#123456'
const botW = new Uint8Array(per * per * SLOTS)
for (let i = 0; i < botW.length; i += SLOTS) botW[i] = 255
const send = [{ kind: 'paint', data: { id: 1, chunks: [{ c: 9, slots: [botTex, '', '', ''], w: bytesToBase64(botW) }] } }]
let bot
let got
let sentLive = 0
try {
	bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 10, send })
	await P.until(() => editor.palette.includes(botTex) && editor.palette[t.chunkSlots[9 * SLOTS]] === botTex, 60_000, "the bot's paint in the page")
	got = { palette: editor.palette.length - start.p.length, unsaved: editor.dirty }
	const real = window.go.main.App.SessionSend
	let sends = 0
	window.go.main.App.SessionSend = (to, kind, data) => {
		if (kind === 'paint') sends++
		return real(to, kind, data)
	}
	try {
		editor.tool = 'paint'
		editor.paintMode = 'paint'
		editor.paintSpray = false
		await P.frames(1)
		editor.paintLayer = e.useTexture('#a0b0c0')
		editor.brush.radius = 12
		editor.brush.strength = 1
		await P.stroke('paint', { x: 40, z: 60 }, { x: 140, z: 60 }, 20)
		sentLive = sends
		await new Promise((r) => setTimeout(r, 400))
		e.history.undo()
		await new Promise((r) => setTimeout(r, 400))
	} finally {
		window.go.main.App.SessionSend = real
	}
} catch (err) {
	await S.leaveSession()
	throw err
}
const lines = await P.bun('botDone', bot)
const page = { w: Uint8Array.from(t.weights), s: Uint8Array.from(t.chunkSlots), p: [...editor.palette] }
await S.leaveSession()
await P.until(() => !shared.role, 5000, 'the session ending')
// The bot's view: the map's start, then every paint message in the host's order, its paths into a palette of its own.
const you = lines[0]?.data?.you
const msgs = lines.filter((l) => l.kind === 'paint').sort((a, b) => a.seq - b.seq)
const mine = msgs.filter((l) => l.from === 1)
const replay = { w: Uint8Array.from(start.w), s: Uint8Array.from(start.s), p: [...start.p] }
for (const m of msgs) {
	for (const ch of m.data.chunks) {
		for (let k = 0; k < SLOTS; k++) {
			const path = ch.slots[k]
			let i = path ? replay.p.indexOf(path) : 255
			if (path && i < 0) i = replay.p.push(path) - 1
			replay.s[ch.c * SLOTS + k] = i
		}
		const w = base64ToBytes(ch.w)
		const x0 = (ch.c % side) * per
		const z0 = Math.floor(ch.c / side) * per
		for (let z = 0; z < per; z++) replay.w.set(w.subarray(z * per * SLOTS, (z + 1) * per * SLOTS), ((z0 + z) * res + x0) * SLOTS)
	}
}
// A texel by path: its textures with weight, sorted.
const texel = (m, x, z) => {
	const c = Math.floor(z / per) * side + Math.floor(x / per)
	const o = (z * res + x) * SLOTS
	const out = []
	for (let k = 0; k < SLOTS; k++) if (m.w[o + k]) out.push(`${m.p[m.s[c * SLOTS + k]] ?? '?'}=${m.w[o + k]}`)
	return out.sort().join(',')
}
let differ = 0
let fromStart = 0
for (let z = 0; z < res; z++) {
	for (let x = 0; x < res; x++) {
		const p = texel(page, x, z)
		if (p !== texel(replay, x, z)) differ++
		if (p !== texel(start, x, z)) fromStart++
	}
}
// After the undo, the page holds the start with the bot's chunk.
const ok = got.palette === 1 && got.unsaved && msgs.some((m) => m.from === you) && mine.length >= 2 && sentLive >= 1 && differ === 0 && fromStart === per * per
return { ok, got, you, paintMsgs: msgs.length, fromHost: mine.length, sentLive, differ, fromStart, chunks: mine.map((m) => m.data.chunks.map((c) => c.c)) }
