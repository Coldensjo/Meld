// The game object editor's Display tab (#230): the picker lists GameObjectDisplayInfo's displays as tiles, opens on the template's own display (the Small Thorium Vein, 324) marked and in its category, hovering another tile shows it in the preview, a click sets displayId as one unsaved change, and Revert drops it. Nothing is written to the database.
// touches: frontend/src/components/ObjectEditor.svelte, frontend/src/components/DisplayPicker.svelte
const { editor, ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
editor.selectedSpawn = null
const WAIT = 60_000
const root = () => document.querySelector('[aria-label="Game object editor"]')
const tabOn = () => root()?.querySelector('nav.tabs button.on')?.textContent.trim() ?? ''
const tabButton = (text) => [...(root()?.querySelectorAll('nav.tabs button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const grid = () => root()?.querySelector('[aria-label="Object displays"]')
const tiles = () => [...(grid()?.querySelectorAll('button') ?? [])]
const under = () => root()?.querySelector('.under')?.textContent.trim() ?? ''
const saveText = () => [...root().querySelectorAll('header button')].find((b) => b.textContent.includes('Save') || b.textContent.includes('Saved'))?.textContent.trim()

ui.objectEditor = { key: null, entry: 324 }
await P.until(() => tabButton('Display'), WAIT, 'the object opened')
tabButton('Display').click()
await P.until(() => tiles().length > 0, WAIT, 'the display tiles')
await P.until(() => grid().querySelector('button.active'), WAIT, 'the own display marked')
const active = grid().querySelector('button.active')
const own = {
	tab: tabOn(),
	active: active.title.split('\n')[0],
	category: root().querySelector('[aria-label="Object type"]').value,
	inView: active.getBoundingClientRect().top >= grid().getBoundingClientRect().top - 1,
	total: root().querySelector('[aria-label="Object type"] option').textContent,
}
const before = Number(active.title.match(/^Display (\d+)/)[1])
// The tiles in view render their thumbnails, as the creature picker's do.
await P.until(() => grid().querySelectorAll('img').length > 0, WAIT, 'a thumbnail')
const thumbs = { drawn: grid().querySelectorAll('img').length, failed: grid().querySelectorAll('.x').length, tiles: tiles().length }

// Another tile: hover previews it, a click sets the display.
const other = tiles().find((b) => !b.classList.contains('active'))
const otherId = Number(other.title.match(/^Display (\d+)/)[1])
other.dispatchEvent(new PointerEvent('pointerenter'))
await P.until(() => under().includes(`display ${otherId}`), WAIT, 'the hover preview')
const hoverText = under()
other.click()
await P.until(() => grid().querySelector('button.active')?.title.startsWith(`Display ${otherId}:`), WAIT, 'the pick')
const picked = { save: saveText(), note: root().querySelector('.scroll p.dim')?.textContent.replace(/\s+/g, ' ').trim() }
const revert = [...root().querySelectorAll('header button')].find((b) => b.textContent.trim() === 'Revert')
revert.click()
await P.until(() => grid().querySelector('button.active')?.title.startsWith(`Display ${before}:`), WAIT, 'the revert')
const reverted = saveText()
ui.objectEditor = null
await P.frames(1)

const ok =
	own.tab === 'Display' &&
	own.category !== '' &&
	own.category !== 'Unused' &&
	own.inView &&
	before > 0 &&
	otherId !== before &&
	hoverText.includes(`display ${otherId}`) &&
	picked.save === 'Save object (1)' &&
	picked.note.startsWith(`Now display ${otherId}`) &&
	reverted === 'Saved' &&
	thumbs.drawn > 0
return { ok, own, thumbs, before, otherId, hoverText, picked, reverted }
