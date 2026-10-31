// Leaving single items out of a write from the Changes window, and Copy SQL (#960). Opens Azeroth 31_50
// (1x1), raises one vertex and stands in two moved spawns for the region's spawn edits, opens File ›
// Review Changes… and unticks the first spawn and the tile: the document keeps both keys (leftOut) and
// the window says items are unticked. A spawn's Copy puts its own UPDATE on the clipboard, Copy ticked
// SQL the other spawn's only, Copy all SQL both. Save Spawns' dialog counts the one change it writes and
// the one left out; Save Spawns (ApplySpawnEdits a stand-in that records the edits, markSpawnsSaved
// another) sends only the ticked spawn and marks only it saved; Compile to Client (SaveRegion a
// stand-in) passes the unticked tile in `skip`, says it was left out and forgets the compiled
// fingerprint. Nothing is written to the patch or the database.
// touches: frontend/src/components/ChangesDialog.svelte, frontend/src/lib/io/leaveOut.ts, frontend/src/lib/io/changes.ts, frontend/src/lib/io/compile.ts, frontend/src/components/AppDialogs.svelte, frontend/src/lib/world/SpawnLayer.ts, internal/vmangos/region.go
const { ui, editor, prefs } = await P.state()
const regionIo = await P.app('/src/lib/io/region.ts')
const compileIo = await P.app('/src/lib/io/compile.ts')
regionIo.openWowRegion(P.e, 'Azeroth', 31, 50, 1)
await P.until(() => (editor.regionMap === 'Azeroth' && P.e.activeRegion()?.x === 31) || null, 120000, 'the Azeroth 31_50 tab')

const raised = Float32Array.from(P.e.terrain.heights)
raised[Math.floor(raised.length / 2)] += 5
P.e.setHeights(raised, 'Probe raise')

const base = { kind: 'npc', entry: 3, y: 50, z: 200, orientation: 1, respawnSecs: 300, respawnMaxSecs: 300, equipment: -1, sheathState: 1, leader: 0, pool: 0 }
const a = { ...base, guid: 990001, name: 'Probe guard A', x: 100 }
const b = { ...base, guid: 990002, name: 'Probe guard B', x: 140 }
const moved = [
	{ spawn: { ...a, x: 120 }, original: a, created: false, deleted: false },
	{ spawn: { ...b, x: 160 }, original: b, created: false, deleted: false },
]

const App = window.go.main.App
const real = { SaveRegion: App.SaveRegion, ApplySpawnEdits: App.ApplySpawnEdits, VmangosPath: App.VmangosPath }
const realEdits = P.e.spawnEdits
const realSaved = P.e.markSpawnsSaved
const realCheck = prefs.checkBeforeCompile
const realCount = ui.spawnChanges
const doc = P.e.activeDocument()
let sent = null
let savedKeys = null
let skip = null
P.e.spawnEdits = () => moved
P.e.markSpawnsSaved = (keys) => (savedKeys = keys ? [...keys] : 'all')
App.ApplySpawnEdits = async (_m, _x, _y, _s, edits) => {
	sent = edits.map((e) => e.spawn.guid)
	return { added: 0, changed: edits.length, deleted: 0, skipped: [], sql: '' }
}
App.SaveRegion = async (edit) => {
	skip = edit.skip ?? []
	return { patch: '', tiles: 1, changed: 0, outside: 0, changedTiles: [], mapId: 0, tilesCurrent: true, building: false, files: 0, skipped: skip }
}
prefs.checkBeforeCompile = false

const box = () => [...document.querySelectorAll('[data-ui="Modal"] header h2')].find((h) => h.textContent.trim().startsWith('Changes'))?.closest('.dialog') ?? null
const text = () => box()?.textContent ?? ''
const button = (label) => [...(box()?.querySelectorAll('button') ?? [])].find((btn) => btn.textContent.trim() === label)
const tick = (label) => box()?.querySelector(`input[aria-label="${label}"]`)
const clip = () => window.runtime.ClipboardGetText().catch((e) => `(${e})`)

let window_ = {}
let copied = {}
let dialog = {}
let save = {}
let compile = {}
try {
	ui.dialog = 'changes'
	await P.until(() => (text().includes('World database') && tick('Write 31_50')) || null, 60000, 'the Changes window with its ticks')
	const ticks = { spawnA: !!tick('Write guid 990001'), spawnB: !!tick('Write guid 990002'), tile: !!tick('Write 31_50') }
	tick('Write guid 990001').click()
	tick('Write 31_50').click()
	await P.frames(2)
	window_ = {
		...ticks,
		leftOut: [...doc.leftOut].sort().join(','),
		warned: text().includes('Some items are unticked'),
		unticked: tick('Write guid 990001')?.checked === false && tick('Write guid 990002')?.checked === true,
	}

	const row = [...box().querySelectorAll('li.row')].find((li) => li.textContent.includes('guid 990001'))
	;[...row.querySelectorAll('button')].find((btn) => btn.textContent.trim() === 'Copy').click()
	await P.until(() => (ui.status.includes('Copied the SQL') ? true : null), 10000, 'the row copied')
	const one = await clip()
	button('Copy ticked SQL').click()
	await P.until(() => (ui.status.includes('the ticked rows') ? true : null), 20000, 'the ticked SQL copied')
	const ticked = await clip()
	button('Copy all SQL').click()
	await P.until(() => (ui.status.includes('every row') ? true : null), 20000, 'all the SQL copied')
	const all = await clip()
	copied = {
		one: one.includes('`guid` = 990001') && !one.includes('990002'),
		ticked: ticked.includes('`guid` = 990002') && !ticked.includes('990001'),
		all: all.includes('`guid` = 990001') && all.includes('`guid` = 990002'),
	}
	ui.dialog = null
	await P.frames(1)

	ui.spawnChanges = 2
	ui.dialog = 'saveSpawns'
	await P.frames(2)
	const t = [...document.querySelectorAll('[data-ui="Modal"]')]
		.map((m) => m.textContent)
		.join(' ')
		.replace(/\s+/g, ' ')
	dialog = { writes: t.includes('Write 1 change to'), leftOut: t.includes('1 edit is left out') }
	ui.dialog = null

	await compileIo.saveSpawns(P.e)
	save = { sent: (sent ?? []).join(','), marked: Array.isArray(savedKeys) ? savedKeys.join(',') : String(savedKeys), status: ui.status.includes('1 spawn edit was left out') }

	// No server folder for the compile, so nothing but the tiles is touched (the window above needs one for the spawns' SQL).
	App.VmangosPath = async () => ''
	await compileIo.compileRegion(P.e, 'client')
	compile = { skip: (skip ?? []).join(','), status: ui.status.includes('1 changed tile was left out'), forgot: doc.compiled.key === null }
} finally {
	Object.assign(App, real)
	P.e.spawnEdits = realEdits
	P.e.markSpawnsSaved = realSaved
	prefs.checkBeforeCompile = realCheck
	ui.spawnChanges = realCount
	doc.leftOut.clear()
	ui.dialog = null
}

const ok =
	Object.values(window_).every((v) => v === true || v === 'spawn:npc/990001,tile:31_50') &&
	window_.leftOut === 'spawn:npc/990001,tile:31_50' &&
	Object.values(copied).every((v) => v === true) &&
	dialog.writes &&
	dialog.leftOut &&
	save.sent === '990002' &&
	save.marked === 'npc/990002' &&
	save.status &&
	compile.skip === '31_50' &&
	compile.status &&
	compile.forgot
return { ok, window: window_, copied, dialog, save, compile }
