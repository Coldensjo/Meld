// A guest's template edits in a shared session (#1051): on the session's map the creature and object editors' Save is refused (the spawn fields' view says `guestMap`, which they check before writing), while a tab of the guest's own and the host keep it; and a template saved from another tab rebases that tab's spawns of the entry but not the session map's, whose rows are the host's and would sync to it as spawn edits. The session state is set by hand (no transport needed).
// touches: frontend/src/lib/session/shared.svelte.ts, frontend/src/lib/session/peers.ts, frontend/src/lib/toolwin/spawnFieldsHost.svelte.ts, frontend/src/lib/toolwin/spawnFields.ts, frontend/src/lib/engine/SpawnActions.ts, frontend/src/components/CreatureEditor.svelte, frontend/src/components/ObjectEditor.svelte, frontend/src/components/EditorWindows.svelte
// timeout: 120
const e = P.e
const S = await P.app('/src/lib/session/shared.svelte.ts')
const H = await P.app('/src/lib/toolwin/spawnFieldsHost.svelte.ts')
const { spawnAdd } = await P.app('/src/lib/world/spawnEdits.ts')
const { shared } = S
const row = (kind, guid, entry) => ({
	kind,
	guid,
	entry,
	name: 'Old Name',
	subname: '',
	levelMin: 1,
	levelMax: 1,
	faction: 7,
	npcFlags: 0,
	rank: 0,
	type: 0,
	x: 20,
	y: 0,
	z: 20,
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
const ENTRY = 4242
const OBJ = 4343
const tab = async (name) => {
	e.newDocument(64, 'flat', 0, name)
	await P.frames(2)
	const d = e.activeDocument()
	e.history.push(spawnAdd(d.spawnLayer, row('monster', 10, ENTRY), 'Place'))
	e.history.push(spawnAdd(d.spawnLayer, row('object', 20, OBJ), 'Place'))
	return d
}
const sessionDoc = await tab('Session Map')
const mineDoc = await tab('Mine')
const names = (d) => [d.spawnLayer.get('monster/10')?.name, d.spawnLayer.get('object/20')?.name]
let flags, after
try {
	shared.role = 'guest'
	shared.docId = sessionDoc.id
	e.switchDocument(sessionDoc.id)
	await P.frames(2)
	const onSession = H.spawnFieldsView().guestMap
	e.switchDocument(mineDoc.id)
	await P.frames(2)
	const onMine = H.spawnFieldsView().guestMap
	// A save from the guest's own tab: its spawns take the new name, the session map's don't.
	const act = H.localMapActions()
	await act.applyCreatureTemplate(ENTRY, { name: 'New Name' }, { name: 'Old Name' })
	await act.applyObjectTemplate(OBJ, { name: 'New Name', displayId: '0', type: '0', size: '1' }, { name: 'Old Name', displayId: '0', type: '0', size: '1' })
	after = { session: names(sessionDoc), mine: names(mineDoc) }
	shared.role = 'host'
	e.switchDocument(sessionDoc.id)
	await P.frames(2)
	const asHost = H.spawnFieldsView().guestMap
	flags = { onSession, onMine, asHost }
} finally {
	shared.role = ''
	shared.docId = 0
}
const ok = flags.onSession === true && flags.onMine === false && flags.asHost === false && after.session.every((n) => n === 'Old Name') && after.mine.every((n) => n === 'New Name')
return { ok, flags, after }
