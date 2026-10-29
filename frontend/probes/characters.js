// The Characters and Accounts tool (#855): Tools › Characters and Accounts… lists the realm's accounts, an account's page lists its characters, and a character's page shows its fields; a new level is an unsaved edit (Save character (1)), Revert drops it, a value Go refuses outlines its field (SaveCharacter stood in, so nothing is written), its Equipment and bags tab (#874) shows the items ReadInventory gives, moves one by a drag, outlines a place Go refuses (SaveInventory stood in), adds an item found by its entry as new and reverts, and the New account form asks for a name and password. Nothing is saved: Go's rules (the SRP6 verifier, online and rename refusals) are tests in internal/vmangos/accounts_test.go, and the inventory's in inventory_test.go and tests/inventory.test.ts.
// touches: frontend/src/components/CharacterEditor.svelte, frontend/src/components/CharacterInventory.svelte, frontend/src/lib/wow/inventory.ts, internal/vmangos/inventory.go, internal/vmangos/accounts.go, app_characters.go, frontend/src/components/EditorFrame.svelte, frontend/src/lib/ui/templateEditor.svelte.ts
const { ui } = await P.state()
const App = window.go.main.App
const accounts = await App.ListAccounts().catch((err) => String(err))
if (typeof accounts === 'string') return { ok: true, skipped: `the server's databases can't be read: ${accounts}` }
const withChars = (accounts ?? []).find((a) => a.characters > 0)
if (!withChars) return { ok: true, skipped: 'no account on the server has a character' }

const WAIT = 60_000
const root = () => document.querySelector('[aria-label="Characters and accounts"]')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const label = (text) => [...root().querySelectorAll('.grid > label, .grid > .field')].find((l) => l.textContent.trim().startsWith(text))
const type = (input, value) => {
	input.value = value
	input.dispatchEvent(new Event('input', { bubbles: true }))
}

ui.characterEditor = { account: 0, guid: 0 }
await P.until(() => root()?.querySelector('[aria-label="Accounts"] button'), WAIT, 'the accounts')
const listed = root().querySelectorAll('[aria-label="Accounts"] button').length

button(root().querySelector('[aria-label="Accounts"]'), withChars.name).click()
await P.until(() => root().querySelector('[aria-label="Characters"] button'), WAIT, 'the characters')
const chars = root().querySelectorAll('[aria-label="Characters"] button').length
const deleteOff = button(root(), 'Delete account').disabled

root().querySelector('[aria-label="Characters"] button').click()
await P.until(() => label('Level')?.querySelector('input')?.value, WAIT, 'the character')
const name = label('Name').querySelector('input').value
const level = Number(label('Level').querySelector('input').value)
type(label('Level').querySelector('input'), String(level === 60 ? 59 : level + 1))
await P.frames(1)
const saveText = button(root().querySelector('header .actions'), 'Save')?.textContent.trim()
const marked = label('Level').classList.contains('changed')

// A refused value outlines its field; the stand-in keeps the database untouched.
const real = App.SaveCharacter
let sent = null
App.SaveCharacter = async (guid, values) => {
	sent = values
	return { sql: '', refused: { column: 'level', message: 'Probe: refused' } }
}
try {
	button(root().querySelector('header .actions'), 'Save').click()
	await P.until(() => root().querySelector('.bar.error'), WAIT, 'the refusal')
} finally {
	App.SaveCharacter = real
}
const refusedShown = root().querySelector('.bar.error').textContent.includes('Probe: refused')
const outlined = label('Level').classList.contains('refused')

button(root().querySelector('header .actions'), 'Revert').click()
await P.frames(1)
const reverted = Number(label('Level').querySelector('input').value) === level && button(root().querySelector('header .actions'), 'Saved')?.disabled === true

// Equipment and bags (#874): the squares hold the items ReadInventory gives, a drag moves one (an
// unsaved edit), a refused place is outlined (SaveInventory stood in), an item found by its entry is
// added as new, and the tab's Revert drops it all.
const guid = ui.characterEditor.guid
const inv = await App.ReadInventory(guid)
button(root().querySelector('nav.tabs'), 'Equipment and bags').click()
const inventory = () => root().querySelector('.inv')
const head = () => inventory().querySelector('.head')
await P.until(() => inventory()?.querySelectorAll('[aria-label="Backpack"] .sq').length === 16 && !inventory().textContent.includes('Reading the items'), WAIT, 'the equipment')
const filled = () => inventory().querySelectorAll('.sq[draggable="true"]').length
const shownItems = filled()
const items = { shown: shownItems, read: inv.items.length, elsewhere: inv.elsewhere }
const drag = (from, to) => {
	const dt = new DataTransfer()
	from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
	to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
	to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
	from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
}
const from = [...inventory().querySelectorAll('.sq[draggable="true"]')].find((s) => !/^0:(19|20|21|22)$/.test(s.dataset.place))
const to = [...inventory().querySelectorAll('[aria-label="Backpack"] .sq')].find((s) => s.getAttribute('draggable') !== 'true')
if (from && to) {
	const fromPlace = from.dataset.place
	const toPlace = to.dataset.place
	drag(from, to)
	await P.frames(1)
	items.moved = inventory().querySelector(`[data-place="${toPlace}"]`).getAttribute('draggable') === 'true' && inventory().querySelector(`[data-place="${fromPlace}"]`).getAttribute('draggable') !== 'true'
	items.saveText = button(head(), 'Save')?.textContent.trim()
	items.tabMarked = button(root().querySelector('nav.tabs'), 'Equipment and bags').textContent.includes('•')
	const realSave = App.SaveInventory
	App.SaveInventory = async (g, list) => {
		items.sent = list.find((i) => `${i.container}:${i.slot}` === toPlace)?.entry
		return { sql: '', refused: { column: toPlace, message: 'Probe: refused' } }
	}
	try {
		button(head(), 'Save').click()
		await P.until(() => inventory().querySelector('.error'), WAIT, 'the refusal')
	} finally {
		App.SaveInventory = realSave
	}
	items.outlined = inventory().querySelector(`[data-place="${toPlace}"]`).classList.contains('refused')
	// Add the moved item's entry again, found by its number: it goes in as new.
	const entry = inv.items.find((i) => `${i.container}:${i.slot}` === fromPlace)?.entry
	const search = inventory().querySelector('input.search')
	search.value = String(entry)
	search.dispatchEvent(new Event('input', { bubbles: true }))
	await P.until(() => inventory().querySelector('.results button'), WAIT, 'the search')
	inventory().querySelector('.results button').click()
	await P.until(() => inventory().querySelector('.sq.new'), WAIT, 'the added item')
	items.added = filled() === shownItems + 1
	button(head(), 'Revert').click()
	await P.until(() => button(head(), 'Saved'), WAIT, 'the revert')
	items.reverted = filled() === shownItems && !inventory().querySelector('.sq.new')
}
button(root().querySelector('nav.tabs'), 'Character').click()
await P.frames(1)
const itemsOk = items.shown === items.read && (!from || !to || (items.moved && items.saveText === 'Save equipment' && items.tabMarked && items.sent > 0 && items.outlined && items.added && items.reverted))

button(root().querySelector('aside'), 'New account').click()
await P.until(() => button(root(), 'Make account'), WAIT, 'the new account form')
const makeOff = button(root(), 'Make account').disabled

button(root().querySelector('header .actions'), 'Close').click()
await P.frames(1)
const closed = !root() && ui.characterEditor === null

const ok = listed > 0 && chars === withChars.characters && deleteOff && !!name && saveText === 'Save character (1)' && marked && sent?.level !== undefined && refusedShown && outlined && reverted && itemsOk && makeOff && closed
return { ok, listed, account: withChars.name, chars, deleteOff, name, level, saveText, marked, sent, refusedShown, outlined, reverted, items, makeOff, closed }
