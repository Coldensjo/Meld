// The server's spawns as a guest (#1020): the page joins a scripted host (meldtool session host --on-join, through P.bun) that sends a `spawns` edit before the map (held until the map opens, then applied), the map with two stand-in spawns and its next guids, and a delete after; the page shows the host's spawns without reading a server, takes a new creature guid in its lane (1) from the host's floor without asking its own database, and its new spawn goes to the host as a `spawns` message from member 2 with what it was when placed.
// touches: frontend/src/lib/session/**, frontend/src/lib/world/SpawnLayer.ts, frontend/src/lib/world/spawnEdits.ts, frontend/src/lib/engine/SpawnActions.ts, frontend/probes/session-bot.mjs, frontend/probes/run.mjs, app_session.go, internal/session/**, cmd/meldtool/session.go
// timeout: 180
const e = P.e
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { toMapData } = await P.app('/src/lib/io/mapData.ts')
const { spawnAdd } = await P.app('/src/lib/world/spawnEdits.ts')
const { editor } = await P.state()
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(64, 'flat', 0, 'Host Map')
await P.frames(1)
const map = toMapData(e.snapshot())
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
const rows = [row('monster', 10, 20, 20), row('object', 20, 30, 20)]
const floors = { creature: 900000, object: 800000, pool: 50 }
// The page is the first guest, member 2, in lane 1; seq 0 in the handoff: every edit the host sends is newer than the map.
const send = [
	{ kind: 'spawns', data: { id: 1, put: [{ ...rows[0], x: 25 }], del: [] } },
	{ to: 2, kind: 'map', data: { seq: 0, map, ids: { lane: 1, nextId: 0, nextGroup: 0 }, spawns: { rows, floors } } },
	{ kind: 'spawns', data: { id: 2, put: [], del: ['object/20'] } },
]
const host = await P.bun('hostBot', { name: 'Ann', seconds: 8, onJoin: true, send })
const real = window.go.main.App.NextCreatureGUID
let asked = 0
let got
let guid = 0
try {
	window.go.main.App.NextCreatureGUID = () => {
		asked++
		return real()
	}
	await S.joinSession(host.addr, host.code, 'Probe')
	await P.until(() => shared.docId && e.activeDocumentId() === shared.docId, 30_000, 'the map opening')
	const L = e.activeDocument().spawnLayer
	await P.until(() => L.spawns.length === 1, 15_000, "the host's delete after the map")
	got = { held: L.get('monster/10')?.x, listed: editor.spawns.length }
	const ids = await e.spawnActions.pasteIds({ creatures: 1, objects: 0, pools: false })
	guid = ids.guid('creature')
	e.history.push(spawnAdd(L, row('npc', guid, 40, 40), 'Place'))
	// A flush or two (HEIGHTS_FLUSH_MS) sends it.
	await new Promise((r) => setTimeout(r, 500))
} finally {
	window.go.main.App.NextCreatureGUID = real
	await S.leaveSession()
}
await P.until(() => !shared.role, 5000, 'the session ending')
const lines = await P.bun('botDone', host.bot)
const sent = lines.find((l) => l.kind === 'spawns' && l.from === 2)
const put = sent?.data?.put?.[0]
const ok = got.held === 25 && got.listed === 1 && guid >= floors.creature && guid % 16 === 1 && asked === 0 && put?.guid === guid && !!sent.data.orig?.[`npc/${guid}`]
return { ok, got, guid, asked, sent: sent ? { put: put?.guid, orig: Object.keys(sent.data.orig ?? {}) } : null, hostSaw: lines.map((l) => l.kind ?? (l.hosting ? 'hosting' : '?')) }
