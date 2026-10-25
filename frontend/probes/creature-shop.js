// The creature editor's Shop tab (#145, #577): Brother Danil (152) lists his npc_vendor rows, a row moved down or removed is an unsaved edit that enables Save shop and counts in the editor's unsaved changes, Revert puts the rows back as read, and Discard them closes the editor with the shop unchanged when it opens again; nothing is written to the database.
// touches: frontend/src/components/CreatureEditor.svelte, frontend/src/components/ShopTab.svelte, frontend/src/lib/ui/rowList.svelte.ts, internal/vmangos/vendor.go, frontend/src/components/EditorFrame.svelte, frontend/src/lib/ui/templateEditor.svelte.ts
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Creature editor"]')
const tab = () => root()?.querySelector('.shop')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const items = () => [...(tab()?.querySelectorAll('tbody tr .item') ?? [])].map((n) => n.textContent.replace(/\s+/g, ' ').trim())
const saveText = () => button(tab()?.querySelector('.head'), 'Sav')?.textContent.trim() ?? ''
async function open() {
	ui.creatureEditor = { key: null, entry: 152 }
	await P.frames(1)
	await P.until(() => button(root()?.querySelector('nav.tabs'), 'Shop'), WAIT, 'the editor')
	button(root().querySelector('nav.tabs'), 'Shop').click()
	await P.frames(1)
	await P.until(() => items().length > 1, WAIT, 'the shop')
}
await open()
const read = items()
const savedBefore = saveText()
// Move the first row down: an edit.
tab().querySelector('tbody tr .row-actions button[title="Move down"]').click()
await P.frames(2)
const moved = items()
const saveMoved = saveText()
button(tab().querySelector('.head'), 'Revert').click()
await P.until(() => saveText() === 'Saved', WAIT, 'the revert')
const reverted = JSON.stringify(items()) === JSON.stringify(read)
// Remove a row, then close and discard it.
tab().querySelector('tbody tr .row-actions button[title="Remove"]').click()
await P.frames(2)
const afterRemove = items().length
root().querySelector('header .actions button:last-child').click()
await P.frames(2)
const warned = root()?.querySelector('.bar.warn')?.textContent ?? ''
button(root().querySelector('.bar.warn'), 'Discard').click()
await P.frames(2)
const closed = root() === null
await open()
const reopened = JSON.stringify(items()) === JSON.stringify(read)
ui.creatureEditor = null
await P.frames(1)
const ok = savedBefore === 'Saved' && moved[0] === read[1] && moved[1] === read[0] && saveMoved === 'Save shop' && reverted && afterRemove === read.length - 1 && warned.includes('unsaved changes to the shop') && closed && reopened
return { ok, rows: read.length, first: read[0], savedBefore, saveMoved, reverted, afterRemove, warned, closed, reopened }
