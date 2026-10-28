// The game object editor's Text tab (#139): "Missing: Corporal Keeshan" (1726) opens on it from the right-click menu's Edit text…, its page 245 is read into a textarea, an edited page and an added page are unsaved edits that Save counts and Revert undoes; A Treatise on Military Ranks (179706) names the item that reads its text and gets a copy of its own; a generic object can be made readable. Nothing is written to the database.
// touches: frontend/src/components/ObjectEditor.svelte, frontend/src/components/PagesTab.svelte, frontend/src/lib/engine/SpawnActions.ts, frontend/src/lib/world/objectFields.ts, internal/vmangos/pages.go
const e = P.e
const { ui } = await P.state()
const se = await P.app('/src/lib/world/spawnEdits.ts')
const { spawnKey } = await P.app('/src/lib/world/SpawnLayer.ts')
const { loadObjectTemplates } = await P.app('/src/components/SpawnBrowser.svelte')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const templates = await loadObjectTemplates()
const poster = templates.find((t) => t.entry === 1726)
const treatise = templates.find((t) => t.entry === 179706)
const generic = templates.find((t) => t.type === 5 && t.model && t.name)
if (!poster || !treatise || !generic) return { ok: false, why: 'the world database lacks Missing: Corporal Keeshan (1726), A Treatise on Military Ranks (179706) or a generic object' }
const posterSpawn = se.newObjectSpawn(poster, 990001, 100, 50, 100, 0)
const genericSpawn = se.newObjectSpawn(generic, 990002, 120, 50, 100, 0)
const layer = e.activeDocument().spawnLayer
layer.set([posterSpawn, genericSpawn])
se.syncSpawnUi(layer, true)
const WAIT = 120_000

const root = () => document.querySelector('[aria-label="Game object editor"]')
const text = () => root()?.querySelector('.text')
const button = (el, t) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(t))
const actions = () => root()?.querySelector('header .actions')
const tabOn = () => root()?.querySelector('nav.tabs button.on')?.textContent.trim() ?? ''
const typeName = () => root()?.querySelector('.title .dim')?.textContent ?? ''
const areas = () => [...(text()?.querySelectorAll('textarea') ?? [])]
const heading = () => text()?.querySelector('.head h3')?.textContent ?? ''
const saveLabel = () => (button(actions(), 'Save') ?? button(actions(), 'Saved'))?.textContent.trim()
const type = (area, value) => {
	area.value = value
	area.dispatchEvent(new Event('input', { bubbles: true }))
}

// The right-click menu of a readable spawn has Edit text…, which opens the editor on the Text tab.
const menu = e.spawnActions.menu(posterSpawn)
const item = menu.items.find((i) => i.label === 'Edit text…')
const genericMenu = e.spawnActions.menu(genericSpawn).items.some((i) => i.label === 'Edit text…')
if (!item) return { ok: false, why: 'no Edit text… in the menu', labels: menu.items.map((i) => i.label) }
item.run()
await P.until(() => areas().length > 0, WAIT, 'the text')
const read = { tab: tabOn(), heading: heading(), first: areas()[0].value.slice(0, 25), shared: !!text().querySelector('.warn') }

type(areas()[0], 'Missing: Corporal Keeshan (probe)')
await P.frames(1)
const edited = { save: saveLabel(), tab: tabOn() }
button(text(), 'Add a page').click()
await P.frames(1)
const added = { pages: areas().length, heading: heading(), newEntry: text().querySelectorAll('.page-head .dim')[1]?.textContent }
button(actions(), 'Revert').click()
await P.until(() => areas().length === 1 && areas()[0].value.startsWith('Missing: Corporal Keeshan\n') && saveLabel() === 'Saved', WAIT, 'the revert')

// A text an item reads too: the tab names it and offers a copy.
ui.objectEditor = { key: null, entry: treatise.entry, tab: 'text' }
await P.until(() => text()?.querySelector('.warn') && areas().length > 0, WAIT, 'the shared text')
const users = [...text().querySelectorAll('.users li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim())
const sharedHead = text().querySelector('.head .dim').textContent
button(text().querySelector('.warn'), 'Give').click()
await P.until(() => !text().querySelector('.warn') && text().querySelector('.head .dim').textContent !== sharedHead, WAIT, 'the copy')
const copied = { head: text().querySelector('.head .dim').textContent, save: saveLabel(), pages: areas().length }
button(actions(), 'Revert').click()
await P.until(() => text()?.querySelector('.warn') && saveLabel() === 'Saved', WAIT, 'the revert of the copy')

// A generic object has nothing to read until it is made readable.
se.selectSpawn(genericSpawn)
ui.objectEditor = { key: spawnKey(genericSpawn), entry: generic.entry, tab: 'text' }
await P.until(() => button(text(), 'Make it readable'), WAIT, 'the Make it readable button')
const wasType = typeName()
button(text(), 'Make it readable').click()
await P.until(() => /Text$/.test(typeName()) && button(text(), 'Give it text'), WAIT, 'the readable object')
const made = { type: typeName(), save: saveLabel() }
button(actions(), 'Revert').click()
await P.until(() => typeName() === wasType && saveLabel() === 'Saved', WAIT, 'the revert of the type')
ui.objectEditor = null

return {
	ok:
		read.tab.startsWith('Text') &&
		read.heading === 'Pages (1)' &&
		read.first === 'Missing: Corporal Keeshan' &&
		!read.shared &&
		!genericMenu &&
		edited.save === 'Save object (1)' &&
		added.pages === 2 &&
		added.heading === 'Pages (2)' &&
		added.newEntry === 'new' &&
		users.some((u) => u.includes('item')) &&
		copied.head !== sharedHead &&
		copied.save === 'Save object (2)' &&
		/Generic/.test(wasType) &&
		/^Save object \(\d+\)$/.test(made.save),
	read,
	genericMenu,
	edited,
	added,
	users,
	sharedHead,
	copied,
	wasType,
	made,
}
