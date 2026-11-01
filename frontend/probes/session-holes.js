// Holes in a shared session (#1016): the page hosts a flat map, a scripted guest (meldtool session join, through P.bun) sends a `holes` message and the page cuts it; then the page cuts a hole (Cut hole, one undo step) and undoes it, both going out as `holes` messages, and the holes the bot's messages give in the host's order match the page's.
// touches: frontend/src/lib/session/**, frontend/src/lib/terrain/Terrain.ts, frontend/src/lib/engine/terrainOps.ts, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const { editor } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { bytesToBase64, base64ToBytes } = await P.app('/src/lib/io/base64.ts')
const { cutHoles } = await P.app('/src/lib/engine/terrainOps.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(64, 'flat', 0, 'Holes Probe')
await P.frames(2)
const t = e.terrain
const N = t.size
await S.hostSession(0, 'Probe')
// The bot's cut: a 2x2 block at cells (10, 10).
const botRect = { x0: 10, z0: 10, x1: 11, z1: 11 }
const send = [{ kind: 'holes', data: { id: 1, rect: botRect, b: bytesToBase64(new Uint8Array([1, 1, 1, 1])) } }]
let bot
let got
let afterCut = 0
try {
	bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 8, send })
	await P.until(() => t.holes[10 * N + 10] === 1, 60_000, "the bot's hole in the page")
	got = { a: t.holes[10 * N + 10], b: t.holes[11 * N + 11], unsaved: editor.dirty }
	// The page's own cut, one undo step, then its undo: both go out.
	const n = cutHoles(t, e.history, { x0: 30, z0: 30, x1: 34, z1: 34 }, null, true)
	await new Promise((r) => setTimeout(r, 400))
	afterCut = n
	e.history.undo()
	await new Promise((r) => setTimeout(r, 400))
} catch (err) {
	await S.leaveSession()
	throw err
}
const lines = await P.bun('botDone', bot)
const page = Uint8Array.from(t.holes)
await S.leaveSession()
await P.until(() => !shared.role, 5000, 'the session ending')
// The bot's view: solid ground, then every holes message in the host's order.
const you = lines[0]?.data?.you
const msgs = lines.filter((l) => l.kind === 'holes').sort((a, b) => a.seq - b.seq)
const mine = msgs.filter((l) => l.from === 1)
const grid = new Uint8Array(N * N)
for (const m of msgs) {
	const r = m.data.rect
	const b = base64ToBytes(m.data.b)
	const w = r.x1 - r.x0 + 1
	for (let z = r.z0; z <= r.z1; z++) grid.set(b.subarray((z - r.z0) * w, (z - r.z0 + 1) * w), z * N + r.x0)
}
let differ = 0
for (let i = 0; i < grid.length; i++) if (grid[i] !== page[i]) differ++
// After the undo, the page holds only the bot's four cells.
let cut = 0
for (let i = 0; i < page.length; i++) if (page[i]) cut++
const ok = got.a === 1 && got.b === 1 && got.unsaved && afterCut > 0 && msgs.some((m) => m.from === you) && mine.length === 2 && differ === 0 && cut === 4
return { ok, got, you, afterCut, holesMsgs: msgs.length, fromHost: mine.length, differ, cut, rects: mine.map((m) => m.data.rect) }
