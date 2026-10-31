// Placed objects in a shared session (#1003): the page hosts a flat map, a scripted guest (meldtool session join, through P.bun) places a model in its id lane and moves it, and the page takes both; then the page places a model of its own (an id in the host's lane), moves it, deletes the bot's and undoes the delete, each going out live as `objects` messages; the map the bot was handed carries its lane, and the objects the bot's messages give in the host's order match the page's.
// touches: frontend/src/lib/session/**, frontend/src/lib/world/ObjectLayer.ts, frontend/src/lib/world/objectCommands.ts, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const { editor } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { LANES, wireOf } = await P.app('/src/lib/session/objects.ts')
const { selectObjects } = await P.app('/src/lib/state/selection.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(64, 'flat', 0, 'Objects Probe')
await P.frames(2)
const start = e.objects.list().map(wireOf)
await S.hostSession(0, 'Probe')
// The bot is the first guest, so lane 1: an id in it, far above the map's.
const botId = LANES * 1000 + 1
const cube = { id: botId, type: 'helper:cube:4', x: 30, z: 30, yOff: 0, rotY: 0, scale: 1 }
const send = [
	{ kind: 'objects', data: { id: 1, put: [cube], del: [] } },
	{ kind: 'objects', data: { id: 2, put: [{ ...cube, x: 40, rotY: 0.5 }], del: [] } },
]
let bot
let got
let mineId = 0
let sentLive = 0
try {
	bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 10, send })
	await P.until(() => e.objects.objects.get(botId)?.x === 40, 60_000, "the bot's model in the page, moved")
	got = { rotY: e.objects.objects.get(botId).rotY, unsaved: editor.dirty }
	const real = window.go.main.App.SessionSend
	let sends = 0
	window.go.main.App.SessionSend = (to, kind, data) => {
		if (kind === 'objects') sends++
		return real(to, kind, data)
	}
	const settle = () => new Promise((r) => setTimeout(r, 300))
	try {
		e.addObjects([{ type: 'helper:sphere:2', x: 50, z: 20, yOff: 1, rotY: 0, scale: 1 }])
		mineId = Math.max(...e.objects.list().map((o) => (o.id === botId ? 0 : o.id)))
		await settle()
		const o = e.objects.objects.get(mineId)
		e.objects.place(o, null, { ...e.objects.worldPlacement(o), rot: 1.25 })
		await settle()
		selectObjects(e.objects, [botId])
		e.deleteSelected()
		await settle()
		sentLive = sends
		e.history.undo()
		await settle()
	} finally {
		window.go.main.App.SessionSend = real
	}
} catch (err) {
	await S.leaveSession()
	throw err
}
const lines = await P.bun('botDone', bot)
const page = e.objects.list().map(wireOf)
await S.leaveSession()
await P.until(() => !shared.role, 5000, 'the session ending')
// The bot's view: the map's start, then every objects message in the host's order.
const you = lines[0]?.data?.you
const handoff = lines.find((l) => l.kind === 'map')?.data
const msgs = lines.filter((l) => l.kind === 'objects').sort((a, b) => a.seq - b.seq)
const replay = new Map(start.map((w) => [w.id, w]))
for (const m of msgs) {
	for (const id of m.data.del) replay.delete(id)
	for (const w of m.data.put) replay.set(w.id, w)
}
const norm = (list) => JSON.stringify([...list].sort((a, b) => a.id - b.id))
const same = norm(page) === norm([...replay.values()])
const fromHost = msgs.filter((m) => m.from === 1).length
const ok =
	got.rotY === 0.5 &&
	got.unsaved &&
	handoff?.ids?.lane === 1 &&
	mineId > 0 &&
	mineId % LANES === 0 &&
	msgs.some((m) => m.from === you) &&
	fromHost >= 4 &&
	sentLive >= 3 &&
	page.some((w) => w.id === botId) &&
	page.find((w) => w.id === mineId)?.rotY === 1.25 &&
	same
return { ok, got, you, lane: handoff?.ids, mineId, objectsMsgs: msgs.length, fromHost, sentLive, same, page: page.length, replay: replay.size }
