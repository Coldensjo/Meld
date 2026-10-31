// The Characters and Accounts tool's Export… and Import character… (#941): on a character's page, Export… hands the binding the character's guid and notes the path; on its account's page, Import character… asks for a file, shows the plan's bar (the character, what comes with it, the name taken so the Name field starts empty and Import is off until a name is typed), Cancel drops it, and a confirmed import sends the file, the account and the name, and opens the new character with a note. The dialogs and the server's .pdump write and load are stand-ins, so nothing is written (the server's side is Go's: TestExportCharacterWritesThroughTheConsole, TestImportCharacterLoadsThroughTheConsole, TestCheckDumpRefusesWhatTheLoadMisreads in internal/vmangos/chardump_test.go). It skips when the server's databases can't be read or no account has a character.
// touches: frontend/src/components/CharacterEditor.svelte, internal/vmangos/chardump.go, app_characters.go
const { ui } = await P.state()
const App = window.go.main.App
const accounts = await App.ListAccounts().catch((err) => String(err))
if (typeof accounts === 'string') return { ok: true, skipped: `the server's databases can't be read: ${accounts}` }
const withChars = (accounts ?? []).find((a) => a.characters > 0)
if (!withChars) return { ok: true, skipped: 'no account on the server has a character' }

const WAIT = 60_000
const root = () => document.querySelector('[data-editor="character"]')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const actions = () => root().querySelector('header .actions')

ui.characterEditor = { account: withChars.id, guid: 0 }
await P.until(() => root()?.querySelector('[aria-label="Characters"] button'), WAIT, 'the characters')
const chars = await App.ListCharacters(withChars.id)
const first = chars[0]
root().querySelector('[aria-label="Characters"] button').click()
await P.until(() => ui.characterEditor.guid > 0 && button(actions(), 'Export'), WAIT, 'the character')
const guid = ui.characterEditor.guid

const real = {
	ExportCharacter: App.ExportCharacter,
	OpenCharacterDumpDialog: App.OpenCharacterDumpDialog,
	PlanCharacterImport: App.PlanCharacterImport,
	ImportCharacter: App.ImportCharacter,
}
const exp = {}
const imp = {}
try {
	App.ExportCharacter = async (g) => {
		exp.sent = g
		return 'C:/probe/Probe.pdump'
	}
	button(actions(), 'Export').click()
	await P.until(() => root().querySelector('.bar.ok'), WAIT, 'the export note')
	exp.note = root().querySelector('.bar.ok').textContent.trim()
	exp.ok = exp.sent === guid && exp.note.includes('C:/probe/Probe.pdump')

	// Back to the account: Import character… asks for the file and shows what the plan says.
	button(root().querySelector('nav.tabs'), '‹').click()
	await P.until(() => ui.characterEditor.guid === 0 && button(root(), 'Import character'), WAIT, 'the account page')
	App.OpenCharacterDumpDialog = async () => 'C:/probe/Probe.pdump'
	App.PlanCharacterImport = async (path, account) => {
		imp.planned = { path, account }
		return { name: first.name, race: first.race, class: first.class, gender: first.gender, level: first.level, items: 11, mail: 1, pets: 0, spells: 3, skills: 13, quests: 0, nameTaken: true, characters: withChars.characters }
	}
	const bar = () => root().querySelector('.bar.import')
	button(root(), 'Import character').click()
	await P.until(() => bar(), WAIT, 'the import bar')
	imp.text = bar().querySelector('span').textContent.replace(/\s+/g, ' ').trim()
	imp.says = imp.text.includes(`Import ${first.name}, level ${first.level}`) && imp.text.includes('11 items, 1 letter') && imp.text.includes('another name')
	const field = () => bar().querySelector('input')
	imp.emptyName = field().value === ''
	imp.offWithoutName = button(bar(), 'Import').disabled
	button(bar(), 'Cancel').click()
	await P.frames(1)
	imp.cancelled = !bar()

	App.ImportCharacter = async (path, account, name) => {
		imp.sent = { path, account, name }
		return { guid: first.guid, name: 'Probecopy' }
	}
	button(root(), 'Import character').click()
	await P.until(() => bar(), WAIT, 'the import bar again')
	field().value = 'probecopy'
	field().dispatchEvent(new Event('input', { bubbles: true }))
	await P.frames(1)
	imp.onWithName = !button(bar(), 'Import').disabled
	button(bar(), 'Import').click()
	await P.until(() => ui.characterEditor.guid === first.guid && root().querySelector('.bar.ok')?.textContent.includes('Imported Probecopy'), WAIT, 'the imported character')
	imp.note = root().querySelector('.bar.ok').textContent.trim()
	imp.ok =
		imp.planned?.path === 'C:/probe/Probe.pdump' &&
		imp.planned.account === withChars.id &&
		imp.says &&
		imp.emptyName &&
		imp.offWithoutName &&
		imp.cancelled &&
		imp.onWithName &&
		imp.sent?.path === 'C:/probe/Probe.pdump' &&
		imp.sent.account === withChars.id &&
		imp.sent.name === 'probecopy'
} finally {
	Object.assign(App, real)
}

button(actions(), 'Close').click()
await P.frames(1)
const closed = !root() && ui.characterEditor === null
return { ok: !!exp.ok && !!imp.ok && closed, account: withChars.name, exp, imp, closed }
