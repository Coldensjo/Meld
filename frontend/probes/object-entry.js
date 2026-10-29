// A game object spawn turned into another object in the game object editor (#136): its entry, name and model change as one undo step, the SQL writes the new id, the pool's other vein shows, and undo turns it back. Then Tools › Game Objects… with no spawn selected (#351): the editor opens on Find object, the search finds the Small Thorium Vein by name and the Copper Vein by entry (1731), a click opens it on its Object tab with the template's columns, Find object stays as a tab to open another, and New object still shows its form. Nothing is written to the database.
// touches: frontend/src/components/ObjectEditor.svelte, frontend/src/components/SpawnBrowser.svelte, frontend/src/lib/world/spawnEdits.ts, frontend/src/lib/world/SpawnLayer.ts, internal/vmangos/spawnedit.go, frontend/src/components/EditorFrame.svelte, frontend/src/lib/ui/templateEditor.svelte.ts
const e = P.e
const { editor, ui } = await P.state()
const se = await P.app('/src/lib/world/spawnEdits.ts')
const { spawnKey } = await P.app('/src/lib/world/SpawnLayer.ts')
const { loadObjectTemplates } = await P.app('/src/components/SpawnBrowser.svelte')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const templates = await loadObjectTemplates()
const byEntry = (n) => templates.find((t) => t.entry === n)
const thorium = byEntry(324) // Small Thorium Vein
const truesilver = byEntry(2047) // Truesilver Deposit
if (!thorium || !truesilver) return { ok: false, why: 'the world database lacks entries 324 and 2047' }
// Two veins of one pool on one spot, as the database has them in Silithus (guids 23510 and 23539).
const vein = Object.assign(se.newObjectSpawn(thorium, 23510, 100, 50, 100, 0), { pool: 22973, poolLimit: 1, poolName: 'Truesilver Deposit / Small Thorium Vein' })
const mate = Object.assign(se.newObjectSpawn(truesilver, 23539, 100, 50, 100, 0), { pool: 22973, poolLimit: 1, poolName: 'Truesilver Deposit / Small Thorium Vein' })
const layer = e.activeDocument().spawnLayer
layer.set([vein, mate])
se.syncSpawnUi(layer, true)
const key = spawnKey(vein)
se.selectSpawn(vein)
ui.objectEditor = { key, entry: 324 }
const root = () => document.querySelector('[data-editor="object"]')
const title = () => root()?.querySelector('h2')?.textContent ?? ''
const rows = () => [...(root()?.querySelectorAll('[aria-label="Game objects"] button.row') ?? [])]
await P.until(() => rows().length > 0 && title() === 'Small Thorium Vein', 60_000, 'the editor and its object list')
const category = root().querySelector('.pick select').value
const poolRow = [...root().querySelectorAll('.spawn-fields button.row')].map((b) => b.textContent.replace(/\s+/g, ' ').trim())
const row = rows().find((b) => b.title === 'Entry 2047')
if (!row) return { ok: false, why: 'Truesilver Deposit is not listed under ' + category }
row.click()
await P.until(() => layer.get(key)?.entry === 2047 && title() === 'Truesilver Deposit', 30_000, 'the entry change')
const changed = { ...layer.get(key) } // a copy: the undo below changes the spawn itself
const edits = layer.edits()
const sql = await window.go.main.App.SpawnEditSQL('Azeroth', 32, 48, 1, edits)
const label = e.history.peek()?.label
e.undo()
await P.until(() => title() === 'Small Thorium Vein', 30_000, 'the editor to follow the undo')
const back = { ...layer.get(key) }
ui.objectEditor = null
await P.frames(1)

// Find object (#351, once the probe object-find), with no spawn selected.
editor.selectedSpawn = null
const find = await (async () => {
	const WAIT = 60_000
	const root = () => document.querySelector('[data-editor="object"]')
	const tabs = () => [...(root()?.querySelectorAll('nav.tabs button') ?? [])]
	const tabOn = () => root()?.querySelector('nav.tabs button.on')?.textContent.trim() ?? ''
	const tabButton = (text) => tabs().find((b) => b.textContent.trim().startsWith(text))
	const rows = () => [...(root()?.querySelectorAll('[aria-label="Game objects"] button.row') ?? [])]
	const title = () => root()?.querySelector('h2')?.textContent.trim() ?? ''
	const type = (input, value) => {
		input.value = value
		input.dispatchEvent(new Event('input', { bubbles: true }))
	}

	// What the menu entry sets (MenuBar.svelte).
	ui.objectEditor = { key: null, entry: 0 }
	await P.until(() => rows().length > 0, WAIT, 'the object list')
	const opened = { title: title(), tab: tabOn(), tabs: tabs().map((b) => b.textContent.trim()), category: root().querySelector('.pick select').value }

	const search = () => root().querySelector('.pick input[type=search]')
	type(search(), 'Small Thorium')
	await P.until(() => rows().some((b) => b.title === 'Entry 324'), WAIT, 'the name search')
	const byName = rows().map((b) => b.title)
	type(search(), '1731')
	await P.until(() => rows().length === 1 && rows()[0].title === 'Entry 1731', WAIT, 'the entry search')
	const byEntry = rows()[0].querySelector('.name').textContent.trim()

	type(search(), 'Small Thorium')
	await P.until(() => rows().some((b) => b.title === 'Entry 324'), WAIT, 'the name search again')
	rows()
		.find((b) => b.title === 'Entry 324')
		.click()
	await P.until(() => title() === 'Small Thorium Vein' && root().querySelectorAll('.scroll h3').length > 1, WAIT, 'the object opened')
	await P.until(() => root().querySelector('header .dim')?.textContent.includes('entry 324'), WAIT, 'the header')
	const object = {
		tab: tabOn(),
		tabs: tabs().map((b) => b.textContent.trim()),
		groups: [...root().querySelectorAll('.scroll h3')].map((h) => h.textContent.trim()),
		save: [...root().querySelectorAll('header button')].map((b) => b.textContent.trim()),
	}

	// Back to Find object: the search is kept and the open object is marked.
	tabButton('Find object').click()
	await P.frames(1)
	const back = { tab: tabOn(), query: search()?.value, active: root().querySelector('[aria-label="Game objects"] button.row.active')?.title }

	// New object still opens its form.
	tabButton('New object').click()
	await P.until(() => title() === 'New game object', WAIT, 'New object')
	const fresh = { tab: tabOn(), form: !!root().querySelector('.new input[type=text]') }
	ui.objectEditor = null
	await P.frames(1)

	const ok =
		opened.title === 'Game objects' &&
		opened.tab === 'Find object' &&
		opened.tabs.join(',') === 'Find object,New object' &&
		opened.category === '' &&
		byName.includes('Entry 324') &&
		byEntry === 'Copper Vein' &&
		object.tab === 'Object' &&
		object.tabs[0] === 'Find object' &&
		object.tabs.includes('Object') &&
		object.tabs.includes('Contents') &&
		object.groups.length > 1 &&
		back.tab === 'Find object' &&
		back.query === 'Small Thorium' &&
		back.active === 'Entry 324' &&
		fresh.tab === 'New object' &&
		fresh.form
	return { ok, opened, byName: byName.slice(0, 5), byEntry, object, back, fresh }
})()
return {
	ok:
		find.ok &&
		category === 'Ore' &&
		poolRow.some((t) => t.startsWith('Truesilver Deposit') && t.includes('same spot')) &&
		changed.name === 'Truesilver Deposit' &&
		changed.model === truesilver.model &&
		edits.length === 1 &&
		sql.sql.includes('UPDATE `gameobject` SET `id` = 2047,') &&
		(sql.skipped ?? []).length === 0 &&
		back.entry === 324 &&
		back.model === thorium.model &&
		layer.edits().length === 0,
	category,
	poolRow,
	label,
	model: changed.model,
	skipped: sql.skipped,
	afterUndo: { entry: back.entry, name: back.name, edits: layer.edits().length },
	find,
}
