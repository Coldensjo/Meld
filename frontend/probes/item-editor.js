// The item editor (#353): Tools › Items… finds the Worn Shortsword (25) and shows its tooltip as the game does (slot, type, damage, speed, damage per second), a character holding it and the sword alone; typed values change the tooltip before saving, a chest piece is not shown on the body, Save refuses a level past 255 and shows the tab it is on, Revert drops the edits, Change look… shows the item large over the client's looks, where the Battleworn Hammer's look previews on hover, is picked by a click and applied by Change look (back to the fields, held), and Change icon… marks an icon to be made on Save, Esc leaving the view; nothing written.
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Item editor"]')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const type = (input, value) => {
	input.value = value
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
const choose = (select, value) => {
	select.value = value
	select.dispatchEvent(new Event('change', { bubbles: true }))
}
const openTab = async (name) => {
	button(root().querySelector('nav.tabs'), name).click()
	await P.frames(1)
}
/** A field's input or select, by its label. */
const field = (label) =>
	[...root().querySelectorAll('.grid > label')].find((l) => (l.querySelector('span')?.textContent ?? l.firstChild?.textContent ?? '').split(' · ')[0].trim() === label)?.querySelector('input, select')
const tooltip = () => [...root().querySelectorAll('.tooltip .line')].map((l) => [...l.querySelectorAll('span')].map((s) => s.textContent.trim()).join(' | '))
const look = () => root().querySelector('.preview-text')?.textContent.trim() ?? ''

ui.itemEditor = { entry: 0 }
await P.until(() => root(), WAIT, 'the editor')
type(root().querySelector('aside input[type=search]'), 'Worn Shortsword')
await P.until(() => button(root().querySelector('[aria-label="Items found"]'), ''), WAIT, 'the search')
const hit = [...root().querySelectorAll('[aria-label="Items found"] button')].find((b) => b.textContent.includes('Worn Shortsword'))
hit.click()
await P.until(() => tooltip().length > 2 && look().startsWith('Held'), WAIT, 'the tooltip and the held sword')
const title = root().querySelector('h2').textContent.trim()
const tip = tooltip()
const held = look()
const canvas = !!root().querySelector('.model canvas')
button(root().querySelector('.seg'), 'Item alone').click()
await P.until(() => look().startsWith('The model alone'), WAIT, 'the sword alone')
const alone = look()
button(root().querySelector('.seg'), 'On a character').click()

// Typed values: the tooltip follows before anything is saved.
type(field('Name'), 'Probe Blade')
choose(field('Quality'), '3')
await openTab('Combat')
type(field('Damage 1 to'), '10')
await P.frames(2)
const edited = tooltip()
const nameColor = root().querySelector('.tooltip .line.title')?.style.color ?? ''

// A chest piece: the character stands in, without the item on its body.
await openTab('Item')
choose(field('Slot'), '5')
await P.until(() => look().startsWith('Armour'), WAIT, 'the chest note')
const chest = look()

// A level past a tinyint's 255: refused before anything is written, on its tab.
await openTab('Requirements')
type(field('Level'), '300')
await openTab('Item')
const saveText = button(root().querySelector('header .actions'), 'Save')?.textContent.trim()
button(root().querySelector('header .actions'), 'Save').click()
await P.until(() => root().querySelector('.bar.error'), WAIT, 'the refusal')
const error = root().querySelector('.bar.error').textContent
const jumped = root().querySelector('nav.tabs button.on')?.textContent.trim()
button(root().querySelector('header .actions'), 'Revert').click()
await P.frames(2)
const reverted = button(root().querySelector('header .actions'), 'Saved') !== undefined && tooltip()[0] === tip[0]

// The look of another item: the Battleworn Hammer's (2361) display, held as a two-hand mace.
await openTab('Item')
choose(field('Slot'), '17')
const changeButton = (name) => button(root().querySelector('.change-buttons'), name)
const change = () => root().querySelector('.change')
const picker = () => change()?.querySelector('.picker')
// Change look… turns the middle into the item large over the client's looks.
changeButton('Change look').click()
await P.until(() => picker(), WAIT, 'the Change look view')
const view = { label: change().getAttribute('aria-label'), fieldsHidden: !root().querySelector('nav.tabs'), bigModel: !!change().querySelector('.stage .model canvas') }
type(picker().querySelector('input[type=search]'), 'Battleworn Hammer')
await P.until(() => picker().querySelector('[aria-label="Looks"] .cell button'), WAIT, 'the looks')
const tiles = picker().querySelectorAll('[aria-label="Looks"] .cell').length
const tile = picker().querySelector('[aria-label="Looks"] .cell button')
const tileTitle = tile.title
// Hovering shows it in the preview without changing the item; a click picks it; Change look applies it and goes back.
tile.dispatchEvent(new PointerEvent('pointerenter'))
await P.until(() => change().querySelector('.change-bar .dim').textContent.includes('Showing display 8690'), WAIT, 'the hovered look')
const hoverKept = root().querySelector('.display input').value
tile.dispatchEvent(new PointerEvent('pointerleave'))
tile.click()
await P.frames(1)
const picked = change().querySelector('.change-bar .dim').textContent
button(change().querySelector('.change-bar'), 'Change look').click()
await P.until(() => !change() && look().startsWith('Held') && root().querySelector('.display input').value === '8690', WAIT, 'the hammer held')
const taken = { view, display: root().querySelector('.display input').value, look: look(), tiles, tileTitle, hoverKept, picked, back: !!root().querySelector('nav.tabs') }
// Change icon…: an icon for the model, unsaved until Save, which would make the display; Esc cancels a second one.
changeButton('Change icon').click()
await P.until(() => picker(), WAIT, 'the Change icon view')
type(picker().querySelector('input[type=search]'), 'INV_Axe_01')
await P.until(() => picker().querySelector('[aria-label="Icons"] .icon-btn'), WAIT, 'the icons')
picker().querySelector('[aria-label="Icons"] .icon-btn').click()
await P.frames(1)
button(change().querySelector('.change-bar'), 'Change icon').click()
await P.frames(2)
const iconPick = { pending: root().querySelector('.look .pending')?.textContent.trim() ?? '', save: button(root().querySelector('header .actions'), 'Save')?.textContent.trim() }
changeButton('Change icon').click()
await P.until(() => picker(), WAIT, 'the Change icon view again')
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
await P.frames(1)
iconPick.escClosed = !change() && !!root()
button(root().querySelector('header .actions'), 'Revert').click()
await P.frames(2)
const stored = await window.go.main.App.ReadItemTemplate(25)
ui.itemEditor = null
await P.frames(1)

const ok =
	title === 'Worn Shortsword' &&
	tip[0] === 'Worn Shortsword' &&
	tip.includes('Main Hand | Sword') &&
	tip.some((l) => /^\d+ - \d+ Damage \| Speed \d\.\d\d$/.test(l)) &&
	tip.some((l) => /^\(\d+\.\d damage per second\)$/.test(l)) &&
	held.startsWith('Held in hand') &&
	canvas &&
	alone.startsWith('The model alone') &&
	edited[0] === 'Probe Blade' &&
	edited.some((l) => / - 10 Damage/.test(l)) &&
	nameColor === 'rgb(0, 112, 221)' &&
	chest.startsWith('Armour') &&
	saveText === 'Save item (5)' &&
	error.includes('required_level must be from 0 to 255') &&
	jumped.startsWith('Requirements') &&
	reverted &&
	stored.values.name === 'Worn Shortsword' &&
	stored.values.required_level === '1' &&
	taken.display === '8690' &&
	taken.look.startsWith('Held in hand') &&
	taken.tiles >= 1 &&
	taken.tileTitle.includes('Battleworn Hammer') &&
	taken.view.label === 'Change look' && taken.view.fieldsHidden && taken.view.bigModel &&
	taken.hoverKept === '1542' &&
	taken.picked.includes('Picked display 8690') &&
	taken.back &&
	iconPick.pending.startsWith('Icon INV_Axe_01') &&
	iconPick.save === 'Save item (3)' &&
	iconPick.escClosed
return { ok, taken, iconPick, title, tip, held, canvas, alone, edited, nameColor, chest, saveText, error, jumped, reverted, stored: { name: stored.values.name, level: stored.values.required_level } }
