// The game object editor's Export… and Import… (#939): on the Battered Chest (2843), Export… hands the binding the object's entry and name and notes where it wrote; Import… shows the plan's bar (the template rows, the quest lists and contents it replaces, the other objects holding a replaced loot list, the items the server lacks) and Cancel drops it; a confirmed import notes the object and reads the open one's contents again. The dialogs and the writes are stand-ins, so nothing is written (the SQL itself is Go's: TestObjectScriptRoundTrip, TestObjectsLive).
// touches: frontend/src/components/ObjectEditor.svelte, frontend/src/lib/ui/templateIo.ts, internal/vmangos/objectscripts.go, internal/vmangos/listscripts.go, internal/vmangos/sqlscript.go, internal/vmangos/sqlparse.go
const { ui } = await P.state()
const App = window.go.main.App
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[data-editor="object"]')
const actions = () => root()?.querySelector('header .actions')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const planBar = () => root()?.querySelector('.bar.plan')
const text = (el) => el?.textContent.replace(/\s+/g, ' ').trim() ?? ''

ui.objectEditor = { key: null, entry: 2843 }
await P.until(() => button(actions(), 'Export'), WAIT, 'the editor')
await P.until(() => /Battered Chest/.test(text(root()?.querySelector('h2'))), WAIT, 'the object')

const names = ['ExportObjects', 'OpenObjectsDialog', 'PlanObjectImport', 'ImportObjects', 'ReadObjectLoot']
const real = Object.fromEntries(names.map((n) => [n, App[n]]))
const calls = { exported: null, imported: null, lootReads: 0 }
try {
	App.ExportObjects = async (entries, suggested) => {
		calls.exported = { entries, suggested }
		return 'C:/Meld-probe/Battered Chest.sql'
	}
	button(actions(), 'Export').click()
	await P.until(() => /Exported Battered Chest/.test(text(root())), WAIT, 'the export note')
	const exportNote = /Exported Battered Chest \(object 2843\) to C:\/Meld-probe\/Battered Chest\.sql/.test(text(root()))

	App.OpenObjectsDialog = async () => 'C:/Meld-probe/objects.sql'
	App.PlanObjectImport = async () => ({
		objects: [
			{ entry: 2843, patch: 7, name: 'Battered Chest', exists: true },
			{ entry: 90001, patch: 0, name: 'Probe Chest', exists: false },
		],
		lists: [
			{ entry: 2265, of: 'loot list', table: 'gameobject_loot_template', what: 'contents', rows: 28, had: 28 },
			{ entry: 90001, of: 'object', table: 'gameobject_questrelation', what: 'quests it starts', rows: 2, had: 0 },
		],
		shared: [{ loot: 2265, entry: 2886, name: 'Barrel', spawns: 3 }],
		skipped: 1,
		others: 0,
		unknown: ['gameobject_loot_template.shiny'],
		missingItems: [99999],
		missingQuests: [],
	})
	button(actions(), 'Import').click()
	await P.until(() => planBar(), WAIT, 'the plan bar')
	const bar = text(planBar())
	button(planBar(), 'Cancel').click()
	await P.frames(2)
	const cancelled = !planBar()

	// A confirmed import: the open object was among those written, so its contents are read again.
	App.ImportObjects = async (path) => {
		calls.imported = path
		return [2843]
	}
	App.ReadObjectLoot = async (entry, loot) => {
		calls.lootReads++
		return real.ReadObjectLoot(entry, loot)
	}
	button(actions(), 'Import').click()
	await P.until(() => planBar(), WAIT, 'the plan bar again')
	button(planBar(), 'Import').click()
	await P.until(() => /Imported 1 game object into the world database/.test(text(root())), WAIT, 'the import note')
	await P.until(() => calls.lootReads > 0, WAIT, 'the contents read again')
	await P.until(() => /Battered Chest/.test(text(root()?.querySelector('h2'))), WAIT, 'the object read again')
	const importNote = /Imported 1 game object into the world database/.test(text(root()))

	const ok =
		exportNote &&
		calls.exported?.entries?.length === 1 &&
		calls.exported.entries[0] === 2843 &&
		calls.exported.suggested === 'Battered Chest' &&
		bar.includes('Import 2 game object rows into the world database?') &&
		bar.includes('Battered Chest (2843, patch 7, replaces it)') &&
		bar.includes('Probe Chest (90001, new)') &&
		bar.includes('Replaces the lists: contents of loot list 2265 (28, replacing 28); quests it starts of object 90001 (2).') &&
		bar.includes('Barrel (2886, loot list 2265, 3 spawns)') &&
		bar.includes('99999') &&
		bar.includes('1 other statement is left out') &&
		bar.includes('gameobject_loot_template.shiny') &&
		cancelled &&
		calls.imported === 'C:/Meld-probe/objects.sql' &&
		importNote
	return { ok, exportNote, calls, bar, cancelled, importNote }
} finally {
	for (const n of names) App[n] = real[n]
	ui.objectEditor = null
	await P.frames(1)
}
