// The game object editor's Quests tab (#293): the Wanted Poster (68) starts Wanted: "Hogger" (176), a quest added from the search is an unsaved edit that Revert drops, and Edit opens the quest over the editor (Esc closes only the quest editor); the Solid Chest (2855, a chest, not a Quest giver) says why it gets no quests and offers no way to add one, the quest editor's Givers tab won't add it. Nothing is written to the database (Go's refusals are Go tests, #419).
// touches: frontend/src/components/ObjectEditor.svelte, frontend/src/components/QuestsTab.svelte, internal/vmangos/questrel.go
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const oe = () => document.querySelector('[aria-label="Game object editor"]')
const qe = () => document.querySelector('[aria-label="Quest editor"]')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const type = (input, value) => {
	input.value = value
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
const tab = () => oe().querySelector('.quests')
const rows = (title) => {
	const h = [...tab().querySelectorAll('h3')].find((x) => x.textContent.startsWith(title))
	const ul = h?.nextElementSibling
	return ul?.tagName === 'UL' ? [...ul.querySelectorAll('li .name')].map((n) => n.textContent.trim()) : []
}
const openQuests = async (entry) => {
	ui.objectEditor = { key: null, entry }
	await P.frames(1)
	await P.until(() => oe()?.querySelector('header .dim')?.textContent.trim().startsWith(`entry ${entry}`) && button(oe().querySelector('nav.tabs'), 'Quests'), WAIT, `the object editor on ${entry}`)
	button(oe().querySelector('nav.tabs'), 'Quests').click()
	await P.until(() => tab() && !tab().textContent.includes('Loading the quests'), WAIT, 'the Quests tab')
	await P.frames(1)
}

// The Wanted Poster: its quest, an added one, Revert.
await openQuests(68)
await P.until(() => rows('Starts').length > 0, WAIT, "the poster's quest")
const poster = { starts: rows('Starts'), warn: tab().querySelector('.warn')?.textContent ?? '' }
type(tab().querySelector('input[type=search]'), 'Kobold Camp Cleanup')
await P.until(() => tab().querySelector('.results li'), WAIT, 'the quest search')
button(tab().querySelector('.results li'), 'Starts').click()
await P.frames(1)
const added = { starts: rows('Starts'), save: button(tab().querySelector('.head'), 'Save')?.textContent.trim(), tabLabel: button(oe().querySelector('nav.tabs'), 'Quests').textContent.trim() }
button(tab().querySelector('.head'), 'Revert').click()
await P.until(() => rows('Starts').length === poster.starts.length, WAIT, 'the revert')
const reverted = button(tab().querySelector('.head'), 'Saved') !== undefined

// Edit opens the quest over the object editor; Esc closes only the quest editor.
const hogger = [...tab().querySelectorAll('.list li')].find((li) => li.textContent.includes('Hogger'))
button(hogger, 'Edit').click()
await P.until(() => qe()?.querySelector('h2')?.textContent.includes('Hogger'), WAIT, 'the quest over the object')
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
await P.frames(1)
const afterEsc = { questEditor: !!qe(), objectEditor: !!oe() }

// The Solid Chest: refused, and why.
await openQuests(2855)
const chest = {
	warn: tab().querySelector('.warn')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
	newQuest: button(tab(), 'New quest')?.disabled,
	search: tab().querySelector('input[type=search]')?.disabled,
}
ui.objectEditor = null
await P.frames(1)

// Go refuses a new quest on the chest, and the chest as a new giver (TestObjectQuestsRefuseNewQuestsOnANonGiver,
// TestGiverObjectsRefuseANewNonGiver, #419); the probe never calls those saves, so nothing can be written.
const App = window.go.main.App
const chestQuests = await App.ReadObjectQuests(2855)

// The quest editor's Givers tab won't add the chest.
ui.questEditor = { entry: 7 }
await P.until(() => button(qe()?.querySelector('nav.tabs'), 'Givers'), WAIT, 'quest 7')
button(qe().querySelector('nav.tabs'), 'Givers').click()
await P.frames(1)
const givers = qe().querySelector('.givers')
button(givers.querySelector('.search'), 'Objects').click()
await P.frames(1)
type(givers.querySelector('.search input'), 'Solid Chest')
await P.until(() => givers.querySelector('.results li'), WAIT, 'the object search')
const chestRow = [...givers.querySelectorAll('.results li')].find((li) => li.querySelector('.dim')?.textContent.startsWith('2855'))
const giverButtons = { starts: button(chestRow, 'Starts')?.disabled, ends: button(chestRow, 'Ends')?.disabled, text: chestRow?.querySelector('.dim')?.textContent ?? '' }
ui.questEditor = null
await P.frames(1)

const ok =
	poster.starts.some((s) => s.includes('Hogger')) &&
	poster.warn === '' &&
	added.starts.length === poster.starts.length + 1 &&
	added.save === 'Save quests' &&
	added.tabLabel === 'Quests (1)' &&
	reverted &&
	!afterEsc.questEditor &&
	afterEsc.objectEditor &&
	chest.warn.includes('not a Quest giver') &&
	chest.newQuest === true &&
	chest.search === true &&
	(chestQuests.starts ?? []).length === 0 &&
	giverButtons.starts === true &&
	giverButtons.ends === true &&
	giverButtons.text.includes('cannot be added')
return { ok, poster, added, reverted, afterEsc, chest, giverButtons }
