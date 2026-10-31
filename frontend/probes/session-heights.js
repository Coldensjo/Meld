// Terrain heights in a shared session (#1001): the page hosts a flat map, a scripted guest (meldtool session join, through P.bun) sends a `heights` message and the page's ground takes it; then a Raise stroke and its undo in the page go out live as `heights` messages, and the heights the bot's messages give in the host's order match the page's.
// touches: frontend/src/lib/session/**, frontend/src/lib/terrain/Terrain.ts, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const { editor } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { floatsToBase64, base64ToFloats } = await P.app('/src/lib/io/base64.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(64, 'flat', 0, 'Heights Probe')
await P.frames(2)
const t = e.terrain
const V = t.verts
const start = Float32Array.from(t.heights)
await S.hostSession(0, 'Probe')
// The bot's edit: two vertices on row 10.
const botRect = { x0: 10, z0: 10, x1: 11, z1: 10 }
const send = [{ kind: 'heights', data: { id: 1, rect: botRect, h: floatsToBase64(new Float32Array([5, 6])) } }]
let bot
let got
let sentLive = 0
try {
	bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 10, send })
	await P.until(() => t.heights[10 * V + 10] === 5, 60_000, "the bot's heights in the page")
	got = { a: t.heights[10 * V + 10], b: t.heights[10 * V + 11], unsaved: editor.dirty }
	// Count the page's sends while the stroke lasts: the heights go out during it, not only at its end.
	const real = window.go.main.App.SessionSend
	let sends = 0
	window.go.main.App.SessionSend = (to, kind, data) => {
		if (kind === 'heights') sends++
		return real(to, kind, data)
	}
	try {
		editor.tool = 'sculpt'
		await P.frames(1)
		editor.sculptMode = 'raise'
		editor.brush.radius = 30
		editor.brush.strength = 1
		await P.stroke('sculpt', { x: 100, z: 120 }, { x: 160, z: 120 }, 30)
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
const page = Float32Array.from(t.heights)
await S.leaveSession()
await P.until(() => !shared.role, 5000, 'the session ending')
// The bot's view: the map's start, then every heights message in the host's order.
const you = lines[0]?.data?.you
const msgs = lines.filter((l) => l.kind === 'heights').sort((a, b) => a.seq - b.seq)
const mine = msgs.filter((l) => l.from === 1)
const grid = Float32Array.from(start)
for (const m of msgs) {
	const r = m.data.rect
	const h = base64ToFloats(m.data.h)
	const w = r.x1 - r.x0 + 1
	for (let z = r.z0; z <= r.z1; z++) grid.set(h.subarray((z - r.z0) * w, (z - r.z0 + 1) * w), z * V + r.x0)
}
let differ = 0
for (let i = 0; i < grid.length; i++) if (grid[i] !== page[i]) differ++
// After the undo, the page holds the start with the bot's two vertices.
let fromStart = 0
for (let i = 0; i < page.length; i++) if (page[i] !== start[i]) fromStart++
const ok = got.a === 5 && got.b === 6 && got.unsaved && msgs.some((m) => m.from === you) && mine.length >= 2 && sentLive >= 2 && differ === 0 && fromStart === 2
return { ok, got, you, heightsMsgs: msgs.length, fromHost: mine.length, sentLive, differ, fromStart, rects: mine.map((m) => m.data.rect) }
