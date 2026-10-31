// The quest editor's Export…, Export chain… and Import… (#940): on Kobold Camp Cleanup (7), Export… hands the binding the quest's entry and title; Export chain… reads the Chain tab's quests (783 before it, 15 after) and hands them all; Import… shows the plan's bar (the quest rows, the givers it replaces, missing and unready givers) and Cancel drops it; a plan the server's rules refuse disables Import; a confirmed import notes the quest and reads its givers again. The dialogs and the writes are stand-ins, so nothing is written (the SQL itself is Go's: TestQuestScriptRoundTrip, TestQuestScriptsLive).
// touches: frontend/src/components/QuestEditor.svelte, frontend/src/lib/ui/templateIo.ts, internal/vmangos/questscripts.go, internal/vmangos/listscripts.go, internal/vmangos/sqlscript.go, internal/vmangos/sqlparse.go
const { ui } = await P.state()
const App = window.go.main.App
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[data-editor="quest"]')
const actions = () => root()?.querySelector('header .actions')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const planBar = () => root()?.querySelector('.bar.plan')
const text = (el) => el?.textContent.replace(/\s+/g, ' ').trim() ?? ''

ui.questEditor = { entry: 7 }
await P.until(() => button(actions(), 'Export…'), WAIT, 'the editor')
await P.until(() => /Kobold Camp Cleanup/.test(text(root()?.querySelector('h2'))), WAIT, 'the quest')

const names = ['ExportQuests', 'OpenQuestsDialog', 'PlanQuestImport', 'ImportQuests', 'ReadQuestGivers']
const real = Object.fromEntries(names.map((n) => [n, App[n]]))
const calls = { exported: [], imported: null, giverReads: 0 }
const plan = (refused) => ({
	quests: [
		{ entry: 7, patch: 0, title: 'Kobold Camp Cleanup', exists: true },
		{ entry: 90001, patch: 0, title: 'Probe Errand', exists: false },
	],
	lists: [
		{ entry: 7, of: 'quest', table: 'creature_questrelation', what: 'creatures that start it', rows: 1, had: 1 },
		{ entry: 7, of: 'quest', table: 'gameobject_questrelation', what: 'game objects that start it', rows: 0, had: 0 },
		{ entry: 90001, of: 'quest', table: 'creature_involvedrelation', what: 'creatures that end it', rows: 2, had: 0 },
	],
	refused,
	skipped: 1,
	others: 0,
	unknown: ['quest_template.Shiny'],
	missingCreatures: [99999],
	missingObjects: [],
	unready: [{ kind: 'creature', id: 805, name: 'Cameron' }],
})
try {
	App.ExportQuests = async (entries, suggested) => {
		calls.exported.push({ entries, suggested })
		return `C:/Meld-probe/${suggested}.sql`
	}
	button(actions(), 'Export…').click()
	await P.until(() => /Exported Kobold Camp Cleanup/.test(text(root())), WAIT, 'the export note')
	const exportNote = /Exported Kobold Camp Cleanup \(quest 7\) to C:\/Meld-probe\/Kobold Camp Cleanup\.sql/.test(text(root()))

	button(actions(), 'Export chain').click()
	await P.until(() => calls.exported.length === 2 && /Exported the chain of Kobold Camp Cleanup/.test(text(root())), WAIT, 'the chain export note')
	const chain = calls.exported[1]
	const chainNote = /Exported the chain of Kobold Camp Cleanup \(\d+ quests\) to C:\/Meld-probe\/Kobold Camp Cleanup chain\.sql/.test(text(root()))

	App.OpenQuestsDialog = async () => 'C:/Meld-probe/quests.sql'
	App.PlanQuestImport = async () => plan(["quest 90001 (patch 0): RewItemId1 names item 4000, which the world database doesn't have"])
	button(actions(), 'Import').click()
	await P.until(() => planBar(), WAIT, 'the refused plan bar')
	const refusedBar = text(planBar())
	const refusedDisabled = button(planBar(), 'Import')?.disabled === true
	button(planBar(), 'Cancel').click()
	await P.frames(2)
	const cancelled = !planBar()

	App.PlanQuestImport = async () => plan([])
	button(actions(), 'Import').click()
	await P.until(() => planBar(), WAIT, 'the plan bar')
	const bar = text(planBar())
	// A confirmed import: the open quest was among those written, so its givers are read again.
	App.ImportQuests = async (path) => {
		calls.imported = path
		return [7]
	}
	App.ReadQuestGivers = async (entry) => {
		calls.giverReads++
		return real.ReadQuestGivers(entry)
	}
	button(planBar(), 'Import').click()
	await P.until(() => /Imported 1 quest into the world database/.test(text(root())), WAIT, 'the import note')
	await P.until(() => calls.giverReads > 0, WAIT, 'the givers read again')
	await P.until(() => /Kobold Camp Cleanup/.test(text(root()?.querySelector('h2'))), WAIT, 'the quest read again')

	const ok =
		exportNote &&
		calls.exported[0].entries.length === 1 &&
		calls.exported[0].entries[0] === 7 &&
		calls.exported[0].suggested === 'Kobold Camp Cleanup' &&
		chainNote &&
		chain.suggested === 'Kobold Camp Cleanup chain' &&
		[783, 7, 15].every((e) => chain.entries.includes(e)) &&
		refusedBar.includes("The server's rules refuse it") &&
		refusedBar.includes('RewItemId1 names item 4000') &&
		refusedDisabled &&
		cancelled &&
		bar.includes('Import 2 quest rows into the world database?') &&
		bar.includes('Kobold Camp Cleanup (7, replaces it)') &&
		bar.includes('Probe Errand (90001, new)') &&
		bar.includes('Replaces the givers: quest 7: creatures that start it (1, replacing 1); quest 90001: creatures that end it (2).') &&
		!bar.includes('game objects that start it') &&
		!bar.includes('rules refuse') &&
		bar.includes('99999') &&
		bar.includes('Cameron (creature 805)') &&
		bar.includes('1 other statement is left out') &&
		bar.includes('quest_template.Shiny') &&
		calls.imported === 'C:/Meld-probe/quests.sql'
	return { ok, exportNote, chainNote, calls, refusedBar, refusedDisabled, bar, cancelled }
} finally {
	for (const n of names) App[n] = real[n]
	ui.questEditor = null
	await P.frames(1)
}
