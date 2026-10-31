// The creature editor's Export… and Import… (#938): on Pratt McGrubben (7852), Export… hands the binding the creature's entry and name and notes where it wrote; Import… shows the plan's bar (the template rows, the shop and quest lists it replaces, the items the server lacks) and Cancel drops it; a confirmed import notes the creature and reads the open one again. The dialogs and the writes are stand-ins, so nothing is written (the SQL itself is Go's: TestCreatureScriptRoundTrip, TestCreaturesLive).
// touches: frontend/src/components/CreatureEditor.svelte, frontend/src/lib/ui/templateIo.ts, internal/vmangos/creaturescripts.go, internal/vmangos/sqlscript.go, internal/vmangos/sqlparse.go
const { ui } = await P.state()
const App = window.go.main.App
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[data-editor="creature"]')
const actions = () => root()?.querySelector('header .actions')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const planBar = () => root()?.querySelector('.bar.plan')
const text = (el) => el?.textContent.replace(/\s+/g, ' ').trim() ?? ''

ui.creatureEditor = { key: null, entry: 7852 }
await P.until(() => button(actions(), 'Export'), WAIT, 'the editor')
await P.until(() => /Pratt McGrubben/.test(text(root()?.querySelector('h2'))), WAIT, 'the creature')

const names = ['ExportCreatures', 'OpenCreaturesDialog', 'PlanCreatureImport', 'ImportCreatures', 'ReadVendor']
const real = Object.fromEntries(names.map((n) => [n, App[n]]))
const calls = { exported: null, imported: null, vendorReads: 0 }
try {
	App.ExportCreatures = async (entries, suggested) => {
		calls.exported = { entries, suggested }
		return 'C:/Meld-probe/Pratt McGrubben.sql'
	}
	button(actions(), 'Export').click()
	await P.until(() => /Exported Pratt McGrubben/.test(text(root())), WAIT, 'the export note')
	const exportNote = /Exported Pratt McGrubben \(creature 7852\) to C:\/Meld-probe\/Pratt McGrubben\.sql/.test(text(root()))

	App.OpenCreaturesDialog = async () => 'C:/Meld-probe/creatures.sql'
	App.PlanCreatureImport = async () => ({
		creatures: [
			{ entry: 7852, patch: 0, name: 'Pratt McGrubben', exists: true },
			{ entry: 90001, patch: 0, name: 'Probe Vendor', exists: false },
		],
		lists: [
			{ entry: 7852, table: 'npc_vendor', what: 'shop items', rows: 19, had: 19 },
			{ entry: 90001, table: 'creature_questrelation', what: 'quests it starts', rows: 2, had: 0 },
		],
		skipped: 1,
		others: 0,
		unknown: ['npc_vendor.shiny'],
		missingItems: [99999],
		missingQuests: [],
	})
	button(actions(), 'Import').click()
	await P.until(() => planBar(), WAIT, 'the plan bar')
	const bar = text(planBar())
	button(planBar(), 'Cancel').click()
	await P.frames(2)
	const cancelled = !planBar()

	// A confirmed import: the open creature was among those written, so its tabs read their rows again.
	App.ImportCreatures = async (path) => {
		calls.imported = path
		return [7852]
	}
	App.ReadVendor = async (entry) => {
		calls.vendorReads++
		return real.ReadVendor(entry)
	}
	button(actions(), 'Import').click()
	await P.until(() => planBar(), WAIT, 'the plan bar again')
	button(planBar(), 'Import').click()
	await P.until(() => /Imported 1 creature into the world database/.test(text(root())), WAIT, 'the import note')
	await P.until(() => calls.vendorReads > 0, WAIT, 'the shop read again')
	await P.until(() => /Pratt McGrubben/.test(text(root()?.querySelector('h2'))), WAIT, 'the creature read again')
	const importNote = /Imported 1 creature into the world database/.test(text(root()))

	const ok =
		exportNote &&
		calls.exported?.entries?.length === 1 &&
		calls.exported.entries[0] === 7852 &&
		calls.exported.suggested === 'Pratt McGrubben' &&
		bar.includes('Import 2 creature rows into the world database?') &&
		bar.includes('Pratt McGrubben (7852, replaces it)') &&
		bar.includes('Probe Vendor (90001, new)') &&
		bar.includes('Replaces the lists: shop items of 7852 (19, replacing 19); quests it starts of 90001 (2).') &&
		bar.includes('99999') &&
		bar.includes('1 other statement is left out') &&
		bar.includes('npc_vendor.shiny') &&
		cancelled &&
		calls.imported === 'C:/Meld-probe/creatures.sql' &&
		importNote
	return { ok, exportNote, calls, bar, cancelled, importNote }
} finally {
	for (const n of names) App[n] = real[n]
	ui.creatureEditor = null
	await P.frames(1)
}
