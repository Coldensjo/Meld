// The quest editor (#259): Tools › Quests… finds Wolves Across the Border (33) and names what its numbers stand for (its zone, the wolf meat it asks for, its reward choices, its faction, the quest before it) and who gives it; a level past 255 and an item the database lacks are unsaved edits (Go's refusals are tests, #419; Save is never pressed), and Revert drops the edits; Edit in Eagan Peltskinner's Quests tab opens the quest over the creature editor, and Esc closes only the quest editor.
// touches: frontend/src/components/QuestEditor.svelte, frontend/src/lib/world/questFields.ts, internal/vmangos/quests.go, frontend/src/components/EditorFrame.svelte, frontend/src/lib/ui/templateEditor.svelte.ts
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
// The waits give room for a slow database; the whole probe takes about 10 s.
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Quest editor"]')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const type = (input, value) => {
	input.value = value
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
const openTab = async (name) => {
	button(root().querySelector('nav.tabs'), name).click()
	await P.frames(1)
}
/** The name a reference field shows, by its label; null while it loads. */
const refName = (label) => {
	const r = [...root().querySelectorAll('.ref')].find((x) => x.querySelector('.label')?.textContent.trim() === label)
	const t = r?.querySelector('.name')?.textContent.replace(/\s+/g, ' ').trim() ?? ''
	return t && t !== '…' ? t : null
}
/** A plain field's input, by its label. */
const field = (label) => [...root().querySelectorAll('.grid > label')].find((l) => l.querySelector('span')?.textContent.split(' · ')[0].trim() === label)?.querySelector('input')
const names = async (labels) => {
	await P.until(() => labels.every(refName), WAIT, `the names of ${labels.join(', ')}`)
	return Object.fromEntries(labels.map((l) => [l, refName(l)]))
}

ui.questEditor = { entry: 0 }
await P.frames(1)
await P.until(() => root(), WAIT, 'the editor')
type(root().querySelector('aside input[type=search]'), 'Wolves Across')
await P.until(() => root().querySelector('[aria-label="Quests found"] button'), WAIT, 'the search')
root().querySelector('[aria-label="Quests found"] button').click()
await P.until(() => root().querySelector('nav.tabs') && field('Level'), WAIT, 'the quest')
const title = root().querySelector('h2').textContent.trim()
const quest = await names(['Quest log heading'])
await openTab('Objectives')
const objectives = await names(['Item 1'])
await openTab('Rewards')
const rewards = await names(['Choice 1', 'Choice 2', 'Faction 1'])
await openTab('Requirements')
const requirements = await names(['After quest'])
await openTab('Givers')
await P.until(() => root().querySelector('[aria-label="Starts it"] .name') && root().querySelector('[aria-label="Ends it"] .name'), WAIT, 'the givers')
const givers = ['Starts it', 'Ends it'].map((l) => root().querySelector(`[aria-label="${l}"] .name`).textContent.trim())

// A level past a tinyint's 255 is an unsaved edit; Go's refusal of it is a Go test (TestEditorSavesRefuseOutOfRangeValues, #419), so Save is never pressed here.
await openTab('Quest')
type(field('Level'), '300')
await P.frames(1)
const saveText = button(root().querySelector('header .actions'), 'Save')?.textContent.trim()
button(root().querySelector('header .actions'), 'Revert').click()
await P.frames(1)

// The client's $ codes are listed under the text areas, and a code button inserts at the cursor.
const details = root().querySelector('textarea')
const codesShown = root().querySelector('.codes')?.textContent.includes('a line break') ?? false
const before = details.value
details.focus()
details.setSelectionRange(0, 0)
button(details.closest('label').querySelector('.codes'), '$N').click()
await P.frames(1)
const inserted = details.value === '$N' + before && details.selectionStart === 2
const codeSave = button(root().querySelector('header .actions'), 'Save')?.textContent.trim()
button(root().querySelector('header .actions'), 'Revert').click()
await P.frames(1)

// An item the world database doesn't have is named as missing (Go refuses its Save: checkQuest's test).
await openTab('Objectives')
const item = [...root().querySelectorAll('.ref')].find((x) => x.querySelector('.label')?.textContent.trim() === 'Item 1').querySelector('input[type=number]')
type(item, '16000000')
await P.until(() => refName('Item 1')?.startsWith('No item'), WAIT, 'the missing item')
const missing = refName('Item 1')
await openTab('Quest')
button(root().querySelector('header .actions'), 'Close').click()
await P.frames(1)
const warned = root()?.querySelector('.bar.warn')?.textContent ?? ''
button(root().querySelector('header .actions'), 'Revert').click()
await P.frames(1)
const reverted = button(root().querySelector('header .actions'), 'Saved') !== undefined
const stored = await window.go.main.App.ReadQuest(33)
ui.questEditor = null
await P.frames(1)

// From the creature editor's Quests tab, over it.
const ce = () => document.querySelector('[aria-label="Creature editor"]')
ui.creatureEditor = { key: null, entry: 196 }
await P.until(() => button(ce()?.querySelector('nav.tabs'), 'Quests'), WAIT, 'the creature editor')
button(ce().querySelector('nav.tabs'), 'Quests').click()
const row = () => [...ce().querySelectorAll('.quests .list li')].find((li) => li.textContent.includes('Wolves Across'))
await P.until(row, WAIT, 'the Quests tab')
button(row(), 'Edit').click()
await P.until(() => root()?.querySelector('h2')?.textContent.trim() === 'Wolves Across the Border', WAIT, 'the quest over the creature')
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
await P.frames(1)
const afterEsc = { questEditor: !!root(), creatureEditor: !!ce() }
ui.creatureEditor = null
await P.frames(1)

const ok =
	title === 'Wolves Across the Border' &&
	quest['Quest log heading'].startsWith('Northshire') &&
	objectives['Item 1'] === 'Tough Wolf Meat' &&
	rewards['Choice 1'] !== '' &&
	!rewards['Choice 1'].startsWith('No ') &&
	!rewards['Choice 2'].startsWith('No ') &&
	rewards['Faction 1'] === 'Stormwind' &&
	requirements['After quest'] !== '' &&
	!requirements['After quest'].startsWith('No ') &&
	givers.every((g) => g.startsWith('Eagan Peltskinner')) &&
	saveText === 'Save quest (1)' &&
	codesShown &&
	inserted &&
	codeSave === 'Save quest (1)' &&
	missing === 'No item 16000000' &&
	warned.includes('Unsaved changes') &&
	reverted &&
	stored.values.QuestLevel === '2' &&
	stored.values.ReqItemId1 === '750' &&
	!afterEsc.questEditor &&
	afterEsc.creatureEditor
return { ok, codesShown, inserted, codeSave, afterEsc, title, quest, objectives, rewards, requirements, givers, saveText, missing, warned, reverted, stored: { level: stored.values.QuestLevel, item: stored.values.ReqItemId1 } }
