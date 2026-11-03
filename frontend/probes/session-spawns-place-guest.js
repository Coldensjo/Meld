// A guest places spawns without a server (#1050): the page joins a scripted host (meldtool session host --on-join, through P.bun) whose map holds a wolf, a vendor and a chair, with every template, look and guid binding swapped to throw; the browser's Creatures, NPCs and Objects tabs list the templates the session map's rows use, a pick places a copy of the row (its look, a guid in the page's lane from the host's floor), the pipette picks from the same list, the placed wolf sat down is dressed from the sitting wolf's row (#1087), and the new spawns and the edit go to the host as `spawns` messages from member 2.
// touches: frontend/src/lib/session/spawnTemplates.ts, frontend/src/lib/session/shared.svelte.ts, frontend/src/components/SpawnBrowser.svelte, frontend/src/lib/tools/PipetteTool.ts, frontend/src/lib/engine/SpawnActions.ts, frontend/src/lib/world/spawnEdits.ts, frontend/probes/session-bot.mjs
// timeout: 180
const e = P.e
const S = await P.app('/src/lib/session/shared.svelte.ts')
const { toMapData } = await P.app('/src/lib/io/mapData.ts')
const { pickSpawn } = await P.app('/src/lib/tools/PipetteTool.ts')
const { editor, prefs, ui } = await P.state()
const { shared } = S
await window.go.main.App.LeaveSession()
await P.until(() => !shared.role, 5000, 'no session')
e.newDocument(64, 'flat', 0, 'Host Map')
await P.frames(1)
const map = toMapData(e.snapshot())
const row = (kind, guid, entry, x, z, extra = {}) => ({
	kind,
	guid,
	entry,
	name: `${kind} ${entry}`,
	subname: '',
	levelMin: 1,
	levelMax: 1,
	faction: 7,
	npcFlags: kind === 'npc' ? 128 : 0,
	rank: 0,
	type: 1,
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
	model: 'Creature/Wolf/Wolf.mdx',
	look: '',
	anim: 0,
	scale: 1,
	displayScale: 1,
	equipment: 0,
	equipItems: [0, 0, 0],
	standState: 0,
	emoteState: 0,
	sheathState: kind === 'object' ? 0 : 1,
	movementType: 0,
	wanderDistance: 0,
	waypoints: [],
	pathFromTemplate: false,
	events: null,
	pool: 0,
	leader: 0,
	motherPool: 0,
	...extra,
})
const rows = [
	row('monster', 10, 110, 20, 20, { look: 'skin=Wolf', standState: 1, anim: 97 }),
	row('monster', 11, 110, 22, 20, { look: 'skin=Wolf' }),
	row('npc', 12, 120, 24, 20),
	row('object', 20, 130, 30, 20, { model: 'World/Generic/Human/Passive Doodads/Chairs/ChairHumanWood01.mdx', sheathState: 0 }),
]
const floors = { creature: 900000, object: 800000, pool: 50 }
// The page is the first guest, member 2, in lane 1.
const send = [{ to: 2, kind: 'map', data: { seq: 0, map, ids: { lane: 1, nextId: 0, nextGroup: 0 }, spawns: { rows, floors } } }]
const host = await P.bun('hostBot', { name: 'Ann', seconds: 25, onJoin: true, send })
const App = window.go.main.App
const swapped = ['ListCreatureTemplates', 'ListObjectTemplates', 'SpawnLook', 'NextCreatureGUID', 'NextObjectGUID', 'NextPoolEntry']
const real = Object.fromEntries(swapped.map((n) => [n, App[n]]))
const asked = []
const was = { collapsed: prefs.browserCollapsed, tool: editor.tool }
const root = () => document.querySelector('[data-ui="AssetBrowser"]')
const tab = (name) => [...root().querySelectorAll('.tab')].find((b) => b.textContent.trim() === name)
const tiles = () => [...root().querySelectorAll('[data-ui="PaletteTile"]')]
const got = { tabs: {} }
try {
	for (const n of swapped)
		App[n] = () => {
			asked.push(n)
			return Promise.reject(new Error('no server'))
		}
	await S.joinSession(host.addr, host.code, 'Probe')
	await P.until(() => shared.docId && e.activeDocumentId() === shared.docId, 30_000, 'the map opening')
	const L = e.activeDocument().spawnLayer
	await P.until(() => L.spawns.length === 4, 15_000, "the host's spawns")
	prefs.browserCollapsed = false
	for (const name of ['Creatures', 'NPCs', 'Objects']) {
		tab(name).click()
		await P.until(() => tiles().length, 15_000, `${name} tiles`)
		await P.frames(2)
		got.tabs[name] = tiles().map((t) => t.getAttribute('title')?.match(/\((?:creature|object) (\d+)\)/)?.[1])
	}
	// A pick on the Creatures tab, then a click on the map: a copy of the wolf standing (row 11, the template's look).
	tab('Creatures').click()
	await P.until(() => tiles().length, 15_000, 'Creatures tiles')
	tiles()[0].click()
	await P.frames(1)
	got.picked = ui.placeCreature?.entry
	await e.spawnActions.placeCreature(ui.placeCreature, { x: 40, y: 0, z: 40 })
	const wolf = editor.selectedSpawn
	got.wolf = wolf && { entry: wolf.entry, guid: wolf.guid, look: wolf.look, stand: wolf.standState }
	// Sitting it down takes the sitting wolf's pose from the map's rows (#1087), with SpawnLook throwing.
	await e.editSpawn(`monster/${wolf.guid}`, { standState: 1 }, 'Stand state')
	const sat = L.get(`monster/${wolf.guid}`)
	got.sat = sat && { stand: sat.standState, anim: sat.anim, look: sat.look }
	// The pipette on the chair picks it from the session's templates, and it places as well.
	await pickSpawn(L.get('object/20'))
	got.pipette = ui.placeObject?.entry
	await e.spawnActions.placeObject(ui.placeObject, { x: 44, y: 0, z: 40 })
	const chair = editor.selectedSpawn
	got.chair = chair && { entry: chair.entry, guid: chair.guid, model: chair.model }
	await new Promise((r) => setTimeout(r, 600))
} finally {
	Object.assign(App, real)
	prefs.browserCollapsed = was.collapsed
	ui.placeCreature = ui.placeObject = null
	editor.tool = was.tool
	await S.leaveSession()
}
await P.until(() => !shared.role, 5000, 'the session ending')
const lines = await P.bun('botDone', host.bot)
const puts = lines.filter((l) => l.kind === 'spawns' && l.from === 2).flatMap((l) => l.data?.put ?? [])
const sentGuids = puts.map((p) => p.guid)
const sentSat = puts.some((p) => p.guid === got.wolf?.guid && p.standState === 1 && p.anim === 97)
const t = got.tabs
const ok =
	t.Creatures?.join() === '110' &&
	t.NPCs?.join() === '120' &&
	t.Objects?.join() === '130' &&
	got.picked === 110 &&
	got.wolf?.entry === 110 &&
	got.wolf.look === 'skin=Wolf' &&
	got.wolf.stand === 0 &&
	got.wolf.guid >= floors.creature &&
	got.wolf.guid % 16 === 1 &&
	got.sat?.stand === 1 &&
	got.sat.anim === 97 &&
	got.sat.look === 'skin=Wolf' &&
	sentSat &&
	got.pipette === 130 &&
	got.chair?.entry === 130 &&
	got.chair.guid >= floors.object &&
	got.chair.guid % 16 === 1 &&
	asked.length === 0 &&
	sentGuids.includes(got.wolf.guid) &&
	sentGuids.includes(got.chair.guid)
return { ok, got, asked, sentGuids, sentSat }
