// The item editor (#353): Tools › Items… finds the Worn Shortsword (25) and shows its tooltip as the game does (slot, type, damage, speed, damage per second), a character holding it and the sword alone; typed values change the tooltip before saving, a chest piece is not shown on the body, Save refuses a level past 255 and shows the tab it is on, Revert drops the edits, the Looks picker finds the Battleworn Hammer's display, previews it on hover and gives it, held, and the Icons picker marks an icon to be made on Save; nothing written.
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
const look = () => root().querySelector('.look > p.dim')?.textContent.trim() ?? ''

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
const picker = () => root().querySelector('.look .picker')
type(picker().querySelector('input[type=search]'), 'Battleworn Hammer')
await P.until(() => picker().querySelector('[aria-label="Looks"] .tile'), WAIT, 'the looks')
const tiles = picker().querySelectorAll('[aria-label="Looks"] .tile').length
const tile = picker().querySelector('[aria-label="Looks"] .tile')
const tileTitle = tile.title
// Hovering previews it, a click picks it.
tile.dispatchEvent(new MouseEvent('mouseenter'))
await P.until(() => look().startsWith('Held'), WAIT, 'the hovered look')
tile.click()
await P.until(() => look().startsWith('Held') && root().querySelector('.display input').value !== '1542', WAIT, 'the hammer held')
const taken = { display: root().querySelector('.display input').value, look: look(), tiles, tileTitle }
// An icon for the model: unsaved until Save, which would make the display.
button(picker().querySelector('.seg'), 'Icons').click()
await P.frames(1)
type(picker().querySelector('input[type=search]'), 'INV_Axe_01')
await P.until(() => picker().querySelector('[aria-label="Icons"] .tile'), WAIT, 'the icons')
picker().querySelector('[aria-label="Icons"] .tile').click()
await P.frames(2)
const iconPick = { pending: root().querySelector('.display .pending')?.textContent.trim() ?? '', save: button(root().querySelector('header .actions'), 'Save')?.textContent.trim() }
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
	iconPick.pending === 'icon INV_Axe_01, made on Save' &&
	iconPick.save === 'Save item (3)'
return { ok, taken, iconPick, title, tip, held, canvas, alone, edited, nameColor, chest, saveText, error, jumped, reverted, stored: { name: stored.values.name, level: stored.values.required_level } }
