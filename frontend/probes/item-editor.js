// The item editor (#353): Tools › Items… finds the Worn Shortsword (25), whose right-click copies `.additem 25` or its entry (#681), and shows its tooltip as the game does (slot, type, damage, speed, damage per second), a character holding it and the sword alone; typed values change the tooltip before saving, a chest piece with the sword's look paints nothing and with the Robes of Arcana's is worn on the body (#356), the Stats tab holds one stat a row and adds Healing +22 as an Equip effect, a level past 255 is an unsaved edit (Go refuses it, a Go test; Save is never pressed), a bow on a crossbow-shooting look is flagged with Make it shoot like a bow and Change look lists bow shooters only, New item… offers Weapon › Bow · Ranged (bow) with the usual basics, Revert drops the edits, Change look… shows the item large over the client's looks, where the Battleworn Hammer's look previews on hover, is picked by a click and applied by Change look (back to the fields, held), and Change icon… marks an icon to be made on Save, Esc leaving the view, and a set piece (Blackened Defias Belt) shows its set's name, members and bonuses (#355), and "sword" sorted by item level high to low (#677) lists the levels falling, with the level on the right, then by name again; nothing written.
// touches: frontend/src/components/ItemEditor.svelte, frontend/src/components/ItemTooltip.svelte, frontend/src/components/ItemTooltipBox.svelte, frontend/src/lib/wow/itemTooltip.ts, frontend/src/lib/world/itemFields.ts, internal/vmangos/items.go, frontend/src/components/EditorFrame.svelte, frontend/src/lib/ui/templateEditor.svelte.ts, internal/vmangos/vendor.go, app_items.go
const { ui, prefs } = await P.state()
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
const field = (label) => [...root().querySelectorAll('.grid > label')].find((l) => (l.querySelector('span')?.textContent ?? l.firstChild?.textContent ?? '').split(' · ')[0].trim() === label)?.querySelector('input, select')
const tooltip = () => [...root().querySelectorAll('.tooltip .line')].map((l) => [...l.querySelectorAll('span')].map((s) => s.textContent.trim()).join(' | '))
const look = () => root().querySelector('.preview-text')?.textContent.trim() ?? ''

ui.itemEditor = { entry: 0 }
await P.until(() => root(), WAIT, 'the editor')
type(root().querySelector('aside input[type=search]'), 'Worn Shortsword')
await P.until(() => button(root().querySelector('[aria-label="Items found"]'), ''), WAIT, 'the search')
const hit = [...root().querySelectorAll('[aria-label="Items found"] button')].find((b) => b.textContent.includes('Worn Shortsword'))
// Right-click: the menu over the editor copies the GM command that gives the item.
hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 160 }))
await P.frames(1)
const menu = { title: ui.contextMenu?.title, items: ui.contextMenu?.items.map((i) => i.label) ?? [], shown: !!document.querySelector('.menu[role=menu]') }
;[...document.querySelectorAll('.menu[role=menu] button')].find((b) => b.textContent.startsWith('Copy')).click()
await P.until(() => root().querySelector('.bar.ok, .bar.error'), WAIT, 'the copy')
menu.note = root().querySelector('.bar.ok, .bar.error').textContent.trim()
menu.clipboard = await window.runtime.ClipboardGetText().catch((e) => `(${e})`)
menu.closed = !ui.contextMenu && !!root()
// Copy id (#681): the same menu copies the plain entry.
hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 160 }))
await P.frames(1)
;[...document.querySelectorAll('.menu[role=menu] button')].find((b) => b.textContent.trim() === 'Copy item entry 25').click()
await P.until(() => ui.status.includes('Copied item entry 25'), 10_000, 'the copy')
menu.entryCopied = !ui.contextMenu && (await window.runtime.ClipboardGetText().catch((e) => `(${e})`)) === '25'
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

// A chest piece: the sword's look paints nothing on the body; the Robes of Arcana's (12695) is
// painted onto the character's skin (#356). The sword's look is typed back after.
await openTab('Item')
choose(field('Slot'), '5')
await P.until(() => look().startsWith('Its display has nothing'), WAIT, 'the chest note')
const chest = look()
const displayInput = root().querySelector('.display input')
const swordLook = displayInput.value
type(displayInput, '12695')
await P.until(() => look().startsWith('Worn on the body'), WAIT, 'the robe on the body')
const robe = look()
type(displayInput, swordLook)
await P.until(() => look().startsWith('Its display has nothing'), WAIT, 'the sword look back')

// A level past a tinyint's 255 is an unsaved edit; Go's refusal is a Go test (TestEditorSavesRefuseOutOfRangeValues, #419), so Save is never pressed.
await openTab('Requirements')
type(field('Level'), '300')
await openTab('Item')
const saveText = button(root().querySelector('header .actions'), 'Save')?.textContent.trim()
button(root().querySelector('header .actions'), 'Revert').click()
await P.frames(2)
const reverted = button(root().querySelector('header .actions'), 'Saved') !== undefined && tooltip()[0] === tip[0]

// Stats: one stat a row (its type beside its amount), and an Equip bonus put into a free effect slot.
await openTab('Stats')
const top = (label) => field(label)?.getBoundingClientRect().top ?? -1
const stats = { row1: top('Stat 1') === top('Stat 1 amount'), row2: top('Stat 2') > top('Stat 1 amount') && top('Stat 2') === top('Stat 2 amount') }
const bonuses = () => root().querySelector('.bonuses')
await P.until(() => bonuses()?.querySelector('select[aria-label=Amount] option'), WAIT, 'the equip bonuses')
choose(bonuses().querySelector('select[aria-label=Bonus]'), 'healing')
await P.frames(1)
const amount = [...bonuses().querySelectorAll('select[aria-label=Amount] option')].find((o) => o.textContent === '+22')
choose(bonuses().querySelector('select[aria-label=Amount]'), amount.value)
button(bonuses(), 'Add bonus').click()
await P.until(() => tooltip().some((l) => l.startsWith('Equip: Increases healing')), WAIT, 'the bonus in the tooltip')
stats.tooltip = tooltip().find((l) => l.startsWith('Equip:'))
stats.listed = bonuses().querySelector('[aria-label="Equip effects"] li')?.textContent.replace(/\s+/g, ' ').trim()
stats.save = button(root().querySelector('header .actions'), 'Save')?.textContent.trim()
button(root().querySelector('[aria-label="Equip effects"]'), 'Remove').click()
await P.frames(2)
stats.removed = !tooltip().some((l) => l.startsWith('Equip:'))
button(root().querySelector('header .actions'), 'Revert').click()
await P.frames(2)

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
// Leaving the tile for the gap before the next one keeps it shown; only leaving the grid clears it.
tile.dispatchEvent(new PointerEvent('pointerleave'))
await P.frames(1)
const gapKept = change().querySelector('.change-bar .dim').textContent.includes('Showing display 8690')
picker().querySelector('[aria-label="Looks"]').dispatchEvent(new PointerEvent('pointerleave'))
await P.frames(1)
const gridCleared = !change().querySelector('.change-bar .dim').textContent.includes('Showing display')
tile.click()
await P.frames(1)
const picked = change().querySelector('.change-bar .dim').textContent
button(change().querySelector('.change-bar'), 'Change look').click()
await P.until(() => !change() && look().startsWith('Held') && root().querySelector('.display input').value === '8690', WAIT, 'the hammer held')
const taken = { gapKept, gridCleared, view, display: root().querySelector('.display input').value, look: look(), tiles, tileTitle, hoverKept, picked, back: !!root().querySelector('nav.tabs') }
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

// A bow on display 35578, Blizzard's bow model with the crossbow's shot visual (743): the editor says
// it fires like a crossbow and offers the bow's visual; Change look's Fits it then lists bow shooters only.
await openTab('Item')
choose(field('Slot'), '15')
choose(field('Subclass'), '2')
type(root().querySelector('.display input'), '35578')
await P.until(() => root().querySelector('.shot-warn'), WAIT, 'the shot warning')
const shot = { warn: root().querySelector('.shot-warn span').textContent.trim() }
button(root().querySelector('.shot-warn'), 'Make it shoot like a bow').click()
await P.frames(1)
shot.pending = root().querySelector('.look .pending')?.textContent.trim() ?? ''
shot.save = button(root().querySelector('header .actions'), 'Save')?.textContent.trim()
changeButton('Change look').click()
await P.until(() => picker()?.querySelector('[aria-label="Looks"] .cell button'), WAIT, 'the bow looks')
shot.fits = picker().querySelector('select[aria-label="Which looks"] option').textContent
shot.titles = [...picker().querySelectorAll('[aria-label="Looks"] .cell button')].slice(0, 12).map((b) => b.title)
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
await P.frames(1)
button(root().querySelector('header .actions'), 'Revert').click()
await P.frames(2)
shot.reverted = !root().querySelector('.shot-warn') && !root().querySelector('.look .pending')

// New item… from a kind: Weapon › Bow · Ranged (bow), whose basics come from the database's bows (not made here).
button(root().querySelector('aside'), 'New item').click()
const form = () => root().querySelector('.new-form')
await P.until(() => form()?.querySelector('select[aria-label=Type] option'), WAIT, 'the kinds of item')
choose(form().querySelector('select[aria-label=Class]'), '2')
await P.frames(1)
const bow = [...form().querySelectorAll('select[aria-label=Type] option')].find((o) => o.textContent.startsWith('Bow · Ranged (bow)'))
choose(form().querySelector('select[aria-label=Type]'), bow?.value ?? '')
await P.frames(1)
const kind = {
	bow: bow?.textContent ?? '',
	text: form().querySelector('.start .dim')?.textContent.trim() ?? '',
	start: [...form().querySelectorAll('.start input[type=radio]')].map((r) => r.parentElement.textContent.trim().split(':')[0]),
	disabledWithoutName: button(form(), 'Make item')?.disabled === true,
}
const stored = await window.go.main.App.ReadItemTemplate(25)
ui.itemEditor = null
await P.frames(1)

// A set piece (#355): Blackened Defias Belt (10403), of Defias Leather (161), shows the set's gold
// name with nothing worn, its five members and its bonuses by count.
ui.itemEditor = { entry: 10403 }
await P.until(() => root(), WAIT, 'the editor again')
await P.until(() => tooltip().some((l) => l.startsWith('Defias Leather (')) && tooltip().some((l) => l.startsWith('(2) Set: ')), WAIT, 'the set block')
const setTip = tooltip()
const setBlock = {
	header: setTip.find((l) => l.startsWith('Defias Leather (')),
	// The tooltip helper trims, so the members' two-space indent is read from the lines themselves.
	members: [...root().querySelectorAll('.tooltip .line span')].filter((s) => s.textContent.startsWith('  ')).length,
	bonuses: setTip.filter((l) => /^\(\d\) Set: /.test(l)),
	headerColor: [...root().querySelectorAll('.tooltip .line')].find((l) => l.textContent.startsWith('Defias Leather ('))?.style.color ?? '',
}

// The search's order (#677): "sword" by item level, high to low, then back to the user's order.
const was = { sort: prefs.itemSort, desc: prefs.itemSortDesc }
const results = () => [...root().querySelectorAll('[aria-label="Items found"] button')].map((b) => b.querySelector('.dim')?.textContent.trim() ?? '')
type(root().querySelector('aside input[type=search]'), 'sword')
choose(root().querySelector('[aria-label="Sort items by"]'), 'itemLevel')
if (!prefs.itemSortDesc) root().querySelector('[aria-label="Sort direction"]').click()
await P.until(() => results().length > 10 && results().every((t) => t.startsWith('ilvl ')), WAIT, 'the swords by item level')
const levels = results().map((t) => Number(t.slice(5)))
const sorted = { count: levels.length, first: levels.slice(0, 5), falling: levels.every((l, i) => i === 0 || l <= levels[i - 1]), arrow: root().querySelector('[aria-label="Sort direction"]').textContent.trim() }
choose(root().querySelector('[aria-label="Sort items by"]'), 'name')
await P.until(() => results().length > 10 && !results()[0].startsWith('ilvl '), WAIT, 'the swords by name')
sorted.byName = /^\d+$/.test(results()[0])
prefs.itemSort = was.sort
prefs.itemSortDesc = was.desc
ui.itemEditor = null
await P.frames(1)

const ok =
	/^Bow · Ranged \(bow\) \(\d+\)$/.test(kind.bow) &&
	kind.text.startsWith("It gets what most of the world database's bow · ranged (bow) items have") &&
	kind.start.length === 3 &&
	kind.start[0] === 'A kind of item' &&
	kind.start[2].startsWith('A copy of Worn Shortsword') &&
	kind.disabledWithoutName &&
	shot.warn.startsWith('This look shoots like a crossbow (its shot visual 743), so the game fires a bow on it like one.') &&
	shot.pending.startsWith('Save makes the look shoot like a bow (shot visual 5)') &&
	shot.save === 'Save item (4)' &&
	shot.fits === 'Fits it: shoots like a bow' &&
	shot.titles.length > 0 &&
	shot.titles.every((t) => t.includes('Shoots like a bow')) &&
	shot.reverted &&
	stats.row1 &&
	stats.row2 &&
	stats.tooltip === 'Equip: Increases healing done by spells and effects by up to 22.' &&
	stats.listed.includes('Healing +22') &&
	stats.save === 'Save item (2)' &&
	stats.removed &&
	menu.title === 'Worn Shortsword' &&
	menu.items.slice(0, 2).join('|') === 'Open|Copy .additem 25 to the clipboard' &&
	menu.items.includes('Copy item entry 25') &&
	menu.items.at(-1) === 'Copy name' &&
	menu.entryCopied &&
	menu.shown &&
	menu.closed &&
	menu.note.startsWith('Copied .additem 25: paste it') &&
	menu.clipboard === '.additem 25' &&
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
	chest.startsWith('Its display has nothing') &&
	robe.startsWith('Worn on the body, on a') &&
	saveText === 'Save item (5)' &&
	reverted &&
	stored.values.name === 'Worn Shortsword' &&
	stored.values.required_level === '1' &&
	taken.display === '8690' &&
	taken.look.startsWith('Held in hand') &&
	taken.tiles >= 1 &&
	taken.tileTitle.includes('Battleworn Hammer') &&
	taken.view.label === 'Change look' &&
	taken.view.fieldsHidden &&
	taken.view.bigModel &&
	taken.hoverKept === '1542' &&
	taken.gapKept &&
	taken.gridCleared &&
	taken.picked.includes('Picked display 8690') &&
	taken.back &&
	iconPick.pending.startsWith('Icon INV_Axe_01') &&
	iconPick.save === 'Save item (3)' &&
	iconPick.escClosed &&
	setBlock.header === 'Defias Leather (0/5)' &&
	setBlock.members === 5 &&
	setBlock.bonuses.length >= 2 &&
	setBlock.bonuses[0].startsWith('(2) Set: ') &&
	!setBlock.bonuses.some((l) => l.includes('spell ')) &&
	setBlock.headerColor === 'rgb(255, 210, 0)' &&
	sorted.falling &&
	sorted.first[0] >= 60 &&
	sorted.arrow === '↓' &&
	sorted.byName
return { ok, sorted, setBlock, kind, shot, stats, menu, taken, iconPick, title, tip, held, canvas, alone, edited, nameColor, chest, robe, saveText, reverted, stored: { name: stored.values.name, level: stored.values.required_level } }
