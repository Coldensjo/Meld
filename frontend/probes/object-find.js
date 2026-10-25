// Tools › Game Objects… with no spawn selected (#351): the editor opens on Find object, the search finds the Small Thorium Vein by name and the Copper Vein by entry (1731), a click opens it on its Object tab with the template's columns, Find object stays as a tab to open another, and New object still shows its form. Nothing is written to the database.
// touches: frontend/src/components/ObjectEditor.svelte, frontend/src/components/EditorFrame.svelte, frontend/src/lib/ui/templateEditor.svelte.ts
const { editor, ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
editor.selectedSpawn = null
const WAIT = 60_000
const root = () => document.querySelector('[aria-label="Game object editor"]')
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
