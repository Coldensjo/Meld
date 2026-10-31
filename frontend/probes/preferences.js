// The Preferences dialog (#752): Ctrl+, and Edit › Preferences… open it, its six pages list their settings, the Folders page shows the client folder, the search finds a setting across the pages, a checkbox and a list write their prefs (and are put back), Game › Game Settings… opens it on the Game page, Esc closes it; no menu still holds a setting that moved into it, the Preferences menu is gone, and every menu is under 720 px tall (a 768 px window).
// touches: frontend/src/components/PreferencesDialog.svelte, frontend/src/components/MenuBar.svelte, frontend/src/components/AppDialogs.svelte, frontend/src/lib/ui/commands.ts, frontend/src/lib/ui/menus.ts
// tier: smoke
const { ui, prefs, wow } = await P.state()
const r = {}
const dlg = () => document.querySelector('[data-ui="Modal"]')
const rows = () => [...(dlg()?.querySelectorAll('[data-pref]') ?? [])].map((el) => el.dataset.pref)
const pageButton = (name) => [...(dlg()?.querySelectorAll('nav .page') ?? [])].find((b) => b.textContent.trim() === name)
const titles = () => [...document.querySelectorAll('.menubar .menu > .title')]
const press = (key, init = {}) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
ui.dialog = null
await P.frames(2)

// Ctrl+, opens it on the page it showed last.
ui.prefsPage = 'general'
press(',', { ctrlKey: true })
await P.frames(3)
r.ctrlComma = ui.dialog === 'preferences' && !!dlg()
r.pages = [...(dlg()?.querySelectorAll('nav .page') ?? [])].map((b) => b.textContent.trim())
r.general = rows()
pageButton('Folders')?.click()
await P.frames(2)
r.folders = rows()
const wowPath = dlg()?.querySelector('[data-pref="wowFolder"] .path')?.textContent.trim()
r.wowPathShown = wowPath === (wow.path || 'Not set')

// The search runs over every page.
const search = dlg()?.querySelector('input[type="search"]')
search.value = 'mmaps'
search.dispatchEvent(new Event('input', { bubbles: true }))
await P.frames(2)
r.search = rows()
r.searchPagesOff = [...dlg().querySelectorAll('nav .page')].filter((b) => b.disabled).length
search.value = ''
search.dispatchEvent(new Event('input', { bubbles: true }))
await P.frames(2)

// A checkbox and a list write their prefs; both are put back.
pageButton('Camera and input')?.click()
await P.frames(2)
const invert0 = prefs.invertY
const box = dlg().querySelector('#pref-invertY')
box.click()
await P.frames(1)
r.checkWrites = prefs.invertY === !invert0
box.click()
await P.frames(1)
r.checkBack = prefs.invertY === invert0
pageButton('General')?.click()
await P.frames(2)
const autosave0 = prefs.autosaveMinutes
const sel = dlg().querySelector('#pref-autosave')
const other = [...sel.options].find((o) => !o.selected && o.value !== '-1')
sel.value = other.value
sel.dispatchEvent(new Event('change', { bubbles: true }))
await P.frames(1)
r.listWrites = prefs.autosaveMinutes !== autosave0
prefs.autosaveMinutes = autosave0
await P.frames(1)

// Esc closes it.
press('Escape')
await P.frames(2)
r.escCloses = ui.dialog === null && !dlg()

// The menus: Edit › Preferences… with its key, Game › Game Settings… on the Game page, no Preferences menu.
const labelsOf = async (title) => {
	title.click()
	await P.frames(1)
	const items = [...document.querySelectorAll('.menubar .dropdown .item')].map((b) => ({ label: b.querySelector('.label')?.textContent.trim(), sc: b.querySelector('.sc')?.textContent.trim() ?? '' }))
	const drop = document.querySelector('.menubar .dropdown')
	const height = Math.round(drop?.scrollHeight ?? 0)
	title.click()
	await P.frames(1)
	return { items, height }
}
r.menus = titles().map((t) => t.textContent.trim())
const all = []
r.heights = {}
for (const t of titles()) {
	const { items, height } = await labelsOf(t)
	r.heights[t.textContent.trim()] = height
	for (const it of items) all.push({ menu: t.textContent.trim(), ...it })
}
const prefsItem = all.find((it) => it.menu === 'Edit' && it.label === 'Preferences…')
r.editItem = prefsItem?.sc ?? null
const MOVED = [
	'Invert camera Y',
	'Anti-aliasing (after a restart)',
	'Clear Thumbnail Cache',
	'VMaNGOS Server Folder…',
	'Benilla Folder…',
	'Minimap Tiles with All Models (trees too)',
	'Q / E Fly Up and Down (instead of turning)',
	'Dark',
	'Every minute',
	'Windowed',
]
r.leftInMenus = all.filter((it) => MOVED.includes(it.label)).map((it) => `${it.menu} › ${it.label}`)
const game = titles().find((t) => t.textContent.trim() === 'Game')
game.click()
await P.frames(1)
;[...document.querySelectorAll('.menubar .dropdown .item')].find((b) => b.querySelector('.label')?.textContent.trim() === 'Game Settings…')?.click()
await P.frames(3)
r.gameSettings = ui.dialog === 'preferences' && ui.prefsPage === 'game' && rows().includes('gameClient')
ui.dialog = null
ui.prefsPage = 'general'
await P.frames(2)

r.ok =
	r.ctrlComma &&
	r.pages.join('|') === 'General|Folders|Camera and input|Graphics|Compile and export|Game' &&
	r.general.includes('theme') &&
	r.general.includes('uiScale') &&
	r.folders.join('|') === 'wowFolder|vmangosFolder|benillaFolder|blenderFolder|otherClients' &&
	r.wowPathShown &&
	r.search.join('|') === 'buildMoveMaps' &&
	r.searchPagesOff === 5 &&
	r.checkWrites &&
	r.checkBack &&
	r.listWrites &&
	prefs.autosaveMinutes === autosave0 &&
	r.escCloses &&
	!r.menus.includes('Preferences') &&
	r.editItem === 'Ctrl+,' &&
	r.leftInMenus.length === 0 &&
	r.gameSettings &&
	Object.values(r.heights).every((h) => h > 0 && h <= 720)
return r
