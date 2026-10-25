// The game object editor's Contents tab (#220): the Truesilver Deposit's shared loot list is read with the other veins that hold it, a copy of its own, an added item and Make it a chest are unsaved edits that Save counts and Revert undoes, and its respawn field is an undo step; nothing is written to the database.
// touches: frontend/src/components/ObjectEditor.svelte, frontend/src/components/LootTab.svelte, frontend/src/lib/world/spawnEdits.ts, internal/vmangos/loot.go
const e = P.e
const { ui } = await P.state()
const se = await P.app('/src/lib/world/spawnEdits.ts')
const { spawnKey } = await P.app('/src/lib/world/SpawnLayer.ts')
const { loadObjectTemplates } = await P.app('/src/components/SpawnBrowser.svelte')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const templates = await loadObjectTemplates()
// A vein is a chest: the Truesilver Deposit (2047) holds loot list 5045 (4 rows), as 150081 and 123309 do.
// (The Solid Chest's list 2283 has 1074 rows: 150 item icons take about 40 s in the headless page.)
const vein = templates.find((t) => t.entry === 2047)
const generic = templates.find((t) => t.type === 5 && t.model && t.name)
if (!vein || !generic) return { ok: false, why: 'the world database lacks the Truesilver Deposit (2047) or a generic object' }
// Opened from spawns, as object-entry does.
const chest = se.newObjectSpawn(vein, 990001, 100, 50, 100, 0)
const other = se.newObjectSpawn(generic, 990002, 120, 50, 100, 0)
const layer = e.activeDocument().spawnLayer
layer.set([chest, other])
se.syncSpawnUi(layer, true)
// The waits give 120 s, room for a slow database; the whole probe takes about 30 s.
const WAIT = 120_000

const root = () => document.querySelector('[aria-label="Game object editor"]')
const loot = () => root()?.querySelector('.loot')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const actions = () => root()?.querySelector('header .actions')
const typeName = () => root()?.querySelector('.title .dim')?.textContent ?? ''
const listName = () => loot()?.querySelector('.head .dim')?.textContent ?? ''
const heading = () => loot()?.querySelector('.head h3')?.textContent ?? ''
const saveLabel = () => (button(actions(), 'Save') ?? button(actions(), 'Saved'))?.textContent.trim()
async function openContents(s) {
	se.selectSpawn(s)
	ui.objectEditor = { key: spawnKey(s), entry: s.entry }
	await P.frames(1)
	await P.until(() => typeName().includes(`spawn ${s.guid} ·`) && button(root()?.querySelector('nav.tabs'), 'Contents'), WAIT, 'the editor')
	button(root().querySelector('nav.tabs'), 'Contents').click()
	await P.frames(1)
}

await openContents(chest)
await P.until(() => loot()?.querySelectorAll('tbody tr').length > 0, WAIT, 'the contents')
const read = { heading: heading(), rows: loot().querySelectorAll('tbody tr').length, list: listName() }
const users = [...loot().querySelectorAll('.users li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim())

// A copy of its own: a new list with the same rows, not saved yet.
button(loot().querySelector('.warn'), 'Give').click()
await P.until(() => !loot().querySelector('.warn') && listName() !== read.list, WAIT, 'the copy')
const copied = { list: listName(), heading: heading(), save: saveLabel() }
button(actions(), 'Revert').click()
await P.until(() => listName() === read.list && loot().querySelector('.warn'), WAIT, 'the revert of the copy')

// Adding an item through the search.
const search = [...loot().querySelectorAll('input.search')].find((i) => i.placeholder === 'Item name or entry')
search.value = '2589' // Linen Cloth by entry: one result, so one icon (each takes about 0.3 s in the headless page)
search.dispatchEvent(new Event('input', { bubbles: true }))
await P.until(() => loot().querySelector('.results button:not(:disabled)'), WAIT, 'the item search')
const added = loot().querySelector('.results button:not(:disabled)').textContent.replace(/\s+/g, ' ').trim()
loot().querySelector('.results button:not(:disabled)').click()
await P.frames(1)
const afterAdd = { heading: heading(), save: saveLabel() }
button(actions(), 'Revert').click()
await P.until(() => heading() === read.heading && saveLabel() === 'Saved', WAIT, 'the revert of the item')

// The spawn's respawn time, from the Contents tab: an undo step.
const respawn = [...loot().querySelectorAll('label.inline')].find((l) => l.textContent.includes('This spawn respawns'))?.querySelector('input')
respawn.value = '900'
respawn.dispatchEvent(new Event('change', { bubbles: true }))
await P.until(() => layer.get(spawnKey(chest))?.respawnSecs === 900, 10_000, 'the respawn edit')
const respawnEdit = { label: e.history.peek()?.label, min: layer.get(spawnKey(chest)).respawnSecs, max: layer.get(spawnKey(chest)).respawnMaxSecs }
e.undo()
await P.frames(1)
const respawnUndone = layer.get(spawnKey(chest)).respawnSecs

// Make it a chest: a generic object (type 5) becomes a chest with a new, empty list.
await openContents(other)
await P.until(() => button(loot(), 'Make it a chest'), WAIT, 'the Make it a chest button')
const wasType = typeName()
button(loot(), 'Make it a chest').click()
await P.until(() => /Chest$/.test(typeName()) && loot().textContent.includes('Nothing yet'), WAIT, 'the chest')
const made = { type: typeName(), list: listName(), empty: loot().textContent.includes('Nothing yet'), save: saveLabel() }
// Close with the chest unsaved asks; Revert leaves nothing to discard, so the bar goes and Esc closes (#265).
button(actions(), 'Close').click()
await P.until(() => root()?.querySelector('.bar.warn'), WAIT, 'the unsaved bar')
button(actions(), 'Revert').click()
await P.until(() => typeName() === wasType && button(loot(), 'Make it a chest'), WAIT, 'the revert of the chest')
await P.frames(2)
const barAfterRevert = !!root()?.querySelector('.bar.warn')
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
await P.frames(2)
const closedByEsc = !root()
ui.objectEditor = null

return {
	ok:
		read.heading === 'Holds (4)' &&
		read.rows === 4 &&
		read.list.startsWith('loot list 5045') &&
		users.length === 2 &&
		users.some((u) => u.startsWith('Ooze Covered Truesilver Deposit')) &&
		copied.list !== read.list &&
		copied.heading === read.heading &&
		copied.save === 'Save object (2)' &&
		afterAdd.heading !== read.heading &&
		afterAdd.save === 'Save object (1)' &&
		respawnEdit.min === 900 &&
		respawnEdit.max >= 900 &&
		respawnUndone === chest.respawnSecs &&
		!barAfterRevert &&
		closedByEsc &&
		made.empty &&
		/^Save object \(\d+\)$/.test(made.save) &&
		/Generic/.test(wasType),
	read,
	users,
	copied,
	added,
	afterAdd,
	respawnEdit,
	respawnUndone,
	generic: generic.entry,
	wasType,
	made,
	barAfterRevert,
	closedByEsc,
}
