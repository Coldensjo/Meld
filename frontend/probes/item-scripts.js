// The item editor's Export… and Import… with what an item names by ID (#1044): on A Treatise on Military Ranks (18664), Export… hands the binding the item's entry and name; Import… shows the plan's bar (the item rows, the contents it replaces, an item's empty contents left unsaid, the pages and loot it writes under new IDs and those the server holds the same, an item the loot holds that the server lacks) and Cancel drops it; a confirmed import notes the items written. The dialogs and the writes are stand-ins, so nothing is written (the SQL itself is Go's: TestItemScriptCarried, TestItemsLive).
// touches: frontend/src/components/ItemEditor.svelte, frontend/src/lib/ui/templateIo.ts, internal/vmangos/itemscripts.go, internal/vmangos/carried.go, internal/vmangos/carriedmatch.go, internal/vmangos/listscripts.go, internal/vmangos/sqlscript.go, internal/vmangos/sqlparse.go
const { ui } = await P.state()
const App = window.go.main.App
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[data-editor="item"]')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const planBar = () => root()?.querySelector('.bar.plan')
const text = (el) => el?.textContent.replace(/\s+/g, ' ').trim() ?? ''

ui.itemEditor = { entry: 18664 }
await P.until(() => button(root(), 'Export'), WAIT, 'the editor')
await P.until(() => /A Treatise on Military Ranks/.test(text(root())), WAIT, 'the item')

const names = ['ExportItems', 'OpenItemsDialog', 'PlanItemImport', 'ImportItems']
const real = Object.fromEntries(names.map((n) => [n, App[n]]))
const calls = { exported: null, imported: null }
try {
	App.ExportItems = async (entries, suggested) => {
		calls.exported = { entries, suggested }
		return 'C:/Meld-probe/Treatise.sql'
	}
	button(root(), 'Export').click()
	await P.until(() => /Exported A Treatise on Military Ranks/.test(text(root())), WAIT, 'the export note')
	const exportNote = /Exported A Treatise on Military Ranks \(item 18664\) to C:\/Meld-probe\/Treatise\.sql/.test(text(root()))

	App.OpenItemsDialog = async () => 'C:/Meld-probe/items.sql'
	App.PlanItemImport = async () => ({
		items: [
			{ entry: 18664, patch: 2, name: 'A Treatise on Military Ranks', exists: true },
			{ entry: 90002, patch: 0, name: 'Probe Lockbox', exists: false },
		],
		lists: [
			{ entry: 18664, of: 'item', table: 'item_loot_template', what: 'contents', rows: 0, had: 0 },
			{ entry: 90002, of: 'item', table: 'item_loot_template', what: 'contents', rows: 2, had: 0 },
		],
		carried: [
			{ what: 'reference loot list', table: 'reference_loot_template', id: 2002, to: 30577, rows: 16, same: false },
			{ what: 'page', table: 'page_text', id: 2654, to: 2975, rows: 1, same: false },
			{ what: 'disenchant loot list', table: 'disenchant_loot_template', id: 64, to: 64, rows: 3, same: true },
		],
		skipped: 1,
		others: 0,
		unknown: [],
		missingItems: [99999],
	})
	button(root(), 'Import').click()
	await P.until(() => planBar(), WAIT, 'the plan bar')
	const bar = text(planBar())
	button(planBar(), 'Cancel').click()
	await P.frames(2)
	const cancelled = !planBar()

	App.ImportItems = async (path) => {
		calls.imported = path
		return [18664]
	}
	button(root(), 'Import').click()
	await P.until(() => planBar(), WAIT, 'the plan bar again')
	button(planBar(), 'Import').click()
	await P.until(() => /Imported 2 item rows into the world database/.test(text(root())), WAIT, 'the import note')

	const ok =
		exportNote &&
		calls.exported?.entries?.length === 1 &&
		calls.exported.entries[0] === 18664 &&
		calls.exported.suggested === 'A Treatise on Military Ranks' &&
		bar.includes('Import 2 item rows into the world database?') &&
		bar.includes('A Treatise on Military Ranks (18664, patch 2, replaces it)') &&
		bar.includes('Replaces the contents: contents of item 90002 (2).') &&
		!bar.includes('item 18664 (0)') &&
		bar.includes('reference loot list 2002 as 30577 (16 rows); page 2654 as 2975 (1 row).') &&
		bar.includes('Already here the same, left as they are: disenchant loot list 64.') &&
		bar.includes('99999') &&
		bar.includes('1 other statement is left out: only item_template rows, their contents, pages and loot are imported.') &&
		cancelled &&
		calls.imported === 'C:/Meld-probe/items.sql'
	return { ok, exportNote, calls, bar, cancelled }
} finally {
	for (const n of names) App[n] = real[n]
	ui.itemEditor = null
	await P.frames(1)
}
