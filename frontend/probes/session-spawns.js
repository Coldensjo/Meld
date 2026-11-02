// The server's spawns in a shared session (#1020): the page hosts a flat map holding two stand-in spawns (no server needed), a scripted guest (meldtool session join, through P.bun) moves the creature and places an NPC in its guid lane, and the page takes both as edits its Save Spawns would write (the move against the database's row, the NPC as created with what it was when placed); then the page moves the game object, deletes the bot's NPC and undoes the delete, each going out live as `spawns` messages. The map the bot was handed carries the spawns (the bot's own too when they came while the host read its next guids) and the host's next guids, and the rows the bot's messages give in the host's order match the page's.
// touches: frontend/src/lib/session/**, frontend/src/lib/world/SpawnLayer.ts, frontend/src/lib/world/spawnEdits.ts, frontend/src/lib/engine/SpawnActions.ts, frontend/src/lib/io/region.ts, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { LANES } = await P.app('/src/lib/session/objects.ts')
const { spawnChange, spawnDelete } = await P.app('/src/lib/world/spawnEdits.ts')
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(64, 'flat', 0, 'Spawns Probe')
await P.frames(2)
const d = e.activeDocument()
const row = (kind, guid, x, z) => ({
	kind,
	guid,
	entry: 100 + guid,
	name: `${kind} ${guid}`,
	subname: '',
	levelMin: 1,
	levelMax: 1,
	faction: 7,
	npcFlags: 0,
	rank: 0,
	type: 0,
	x,
	y: 0,
	z,
	orientation: 0,
	tilt: null,
	respawnSecs: 300,
	respawnMaxSecs: 300,
	display: 0,
	ownDisplay: false,
	ownEquipment: false,
	model: '',
	look: '',
	anim: 0,
	scale: 1,
	displayScale: 1,
	equipment: 0,
	equipItems: [0, 0, 0],
	standState: 0,
	emoteState: 0,
	sheathState: 0,
	movementType: 0,
	wanderDistance: 0,
	waypoints: [],
	pathFromTemplate: false,
	events: null,
	pool: 0,
	leader: 0,
	motherPool: 0,
})
e.setSpawns(d, [row('monster', 10, 20, 20), row('object', 20, 30, 20)])
const start = JSON.parse(JSON.stringify(d.spawnLayer.spawns))
await S.hostSession(0, 'Probe')
// The bot is the first guest, so lane 1: a guid in it, far above the map's.
const botGuid = LANES * 1000 + 1
const npc = row('npc', botGuid, 40, 40)
const send = [
	{ kind: 'spawns', data: { id: 1, put: [{ ...start[0], x: 35, orientation: 1 }], del: [] } },
	{ kind: 'spawns', data: { id: 2, put: [{ ...npc, display: 5, ownDisplay: true }], del: [], orig: { [`npc/${botGuid}`]: npc } } },
]
let bot
let got
let sentLive = 0
try {
	bot = await P.bun('joinBot', `127.0.0.1:${shared.port}`, shared.code, { name: 'Bot', seconds: 10, send })
	await P.until(() => d.spawnLayer.get('monster/10')?.x === 35 && d.spawnLayer.get(`npc/${botGuid}`), 60_000, "the bot's move and NPC in the page")
	const edits = d.spawnLayer.edits()
	const made = edits.find((x) => x.spawn.guid === botGuid)
	const moved = edits.find((x) => x.spawn.guid === 10)
	got = { edits: edits.length, created: made?.created, origDisplay: made?.original?.display, display: made?.spawn.display, movedFrom: moved?.original?.x }
	const real = window.go.main.App.SessionSend
	let sends = 0
	window.go.main.App.SessionSend = (to, kind, data) => {
		if (kind === 'spawns') sends++
		return real(to, kind, data)
	}
	const settle = () => new Promise((r) => setTimeout(r, 300))
	try {
		e.history.push(spawnChange(d.spawnLayer, 'object/20', { x: 44, orientation: 2 }, 'Move'))
		await settle()
		e.history.push(spawnDelete(d.spawnLayer, `npc/${botGuid}`, 'Delete'))
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
const page = JSON.parse(JSON.stringify(d.spawnLayer.spawns))
await S.leaveSession()
await P.until(() => !shared.role, 5000, 'the session ending')
// The bot's view: the handoff's rows, then every spawns message in the host's order.
const you = lines[0]?.data?.you
const handoff = lines.find((l) => l.kind === 'map')?.data
const msgs = lines.filter((l) => l.kind === 'spawns').sort((a, b) => a.seq - b.seq)
const key = (s) => `${s.kind}/${s.guid}`
const replay = new Map((handoff?.spawns?.rows ?? []).map((s) => [key(s), s]))
for (const m of msgs) {
	if (m.seq <= handoff?.seq) continue
	for (const k of m.data.del) replay.delete(k)
	for (const s of m.data.put) replay.set(key(s), s)
}
const norm = (list) => JSON.stringify([...list].sort((a, b) => key(a).localeCompare(key(b))))
const same = norm(page) === norm([...replay.values()])
const fromHost = msgs.filter((m) => m.from === 1).length
const floors = handoff?.spawns?.floors
const ok =
	handoff?.spawns?.rows?.length >= 2 &&
	floors?.creature > 10 &&
	floors?.object > 20 &&
	got.edits === 2 &&
	got.created === true &&
	got.origDisplay === 0 &&
	got.display === 5 &&
	got.movedFrom === 20 &&
	msgs.some((m) => m.from === you) &&
	fromHost >= 3 &&
	sentLive >= 2 &&
	page.some((s) => s.guid === botGuid) &&
	page.find((s) => s.guid === 20)?.x === 44 &&
	same
return { ok, got, you, floors, rows: handoff?.spawns?.rows?.length, spawnsMsgs: msgs.length, fromHost, sentLive, same, page: page.length, replay: replay.size }
