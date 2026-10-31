// The Characters and Accounts tool (#855): Tools › Characters and Accounts… lists the realm's accounts, an account's page lists its characters, and a character's page shows its fields; a new level is an unsaved edit (Save character (1)), Revert drops it, a value Go refuses outlines its field (SaveCharacter stood in, so nothing is written), its Equipment and bags tab (#874) shows the items ReadInventory gives, moves one by a drag (from the square, not its icon's image, and kept from the document's drag listener, #930), outlines a place Go refuses (SaveInventory stood in), adds an item found by its entry as new and reverts, shows the bank, the bank bags (those not bought marked, the count bought an edit, #886) and the keyring and gives an item added to the bank a random property from its choices (#879), draws the character wearing its equipment between the equipment's columns (#880), the Character tab's look (#875) offers the client's choices and its picture redraws as the look changes and its home shows the character_homebind row, the Skills, Spells and Reputation tabs (#875) list what ReadCharacterSkills, ReadCharacterSpells and ReadCharacterReputation give, take an edit (a skill out, the starting spells in, a new rank), outline what Go refuses (the Save bindings stood in) and revert, the Quests, Explored and Flight paths tabs (#881) list what ReadCharacterQuests, ReadCharacterExploration and ReadCharacterTaxi give, take an edit (a quest found by its entry added, a zone and a stop marked), outline what Go refuses and revert, every tab fits the page without its scroll bar (#931), Delete character… asks, and its Delete sends the guid and goes back to the account (DeleteCharacter stood in, #876), Delete account… is offered with characters, and the New account form asks for a name and password. Nothing is saved or deleted: Go's rules (the SRP6 verifier, online and rename refusals) are tests in internal/vmangos/accounts_test.go, the delete's SQL in chardelete_test.go, the inventory's in inventory_test.go and tests/inventory.test.ts, the look's, skills', spells' and reputation's in charsheet_test.go and tests/characterSheet.test.ts, and the quests', explored areas' and flight paths' in charquests_test.go.
// touches: frontend/src/components/CharacterEditor.svelte, frontend/src/components/CharacterInventory.svelte, frontend/src/components/CharacterModelView.svelte, internal/vmangos/charmodel.go, frontend/src/components/CharacterSkills.svelte, frontend/src/components/CharacterSpells.svelte, frontend/src/components/CharacterReputation.svelte, frontend/src/components/CharacterQuests.svelte, frontend/src/components/CharacterExploration.svelte, frontend/src/components/CharacterTaxi.svelte, frontend/src/lib/wow/inventory.ts, frontend/src/lib/wow/characterSheet.ts, internal/vmangos/inventory.go, internal/vmangos/itemtables.go, internal/vmangos/accounts.go, internal/vmangos/chardelete.go, internal/vmangos/charsheet.go, internal/vmangos/charquests.go, app_characters.go, frontend/src/components/TemplateFields.svelte, frontend/src/components/EditorFrame.svelte, frontend/src/lib/ui/templateEditor.svelte.ts
const { ui } = await P.state()
const App = window.go.main.App
const accounts = await App.ListAccounts().catch((err) => String(err))
if (typeof accounts === 'string') return { ok: true, skipped: `the server's databases can't be read: ${accounts}` }
const withChars = (accounts ?? []).find((a) => a.characters > 0)
if (!withChars) return { ok: true, skipped: 'no account on the server has a character' }

const WAIT = 60_000
const root = () => document.querySelector('[data-editor="character"]')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const label = (text) => [...root().querySelectorAll('.grid > .cell > label, .grid > label, .grid > .field')].find((l) => l.textContent.trim().startsWith(text))
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
// Delete account… is offered with characters too (#876: it takes them along).
const deleteOn = !button(root(), 'Delete account').disabled

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
	const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })
	// The document's own listener (the Wails runtime's, which refuses drags with files) must not see it (#930).
	let reached = false
	const seen = () => (reached = true)
	document.documentElement.addEventListener('dragover', seen)
	to.dispatchEvent(over)
	document.documentElement.removeEventListener('dragover', seen)
	items.overAllowed = over.defaultPrevented
	items.overKept = !reached
	to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
	from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
}
const from = [...inventory().querySelectorAll('.sq[draggable="true"]')].find((s) => !/^0:(19|20|21|22)$/.test(s.dataset.place))
const to = [...inventory().querySelectorAll('[aria-label="Backpack"] .sq')].find((s) => s.getAttribute('draggable') !== 'true')
if (from && to) {
	const fromPlace = from.dataset.place
	// The icon's image is not draggable: an image drag carries a file, which the desktop window refuses (#930).
	items.iconFixed = [...from.querySelectorAll('img')].every((i) => !i.draggable)
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
// The bank, the bank's bag slots (those not bought marked) and the keyring (#879); an item with a
// random property (727, Notched Shortsword, rolls "of the Bear" and the like) added into a picked
// bank square rolls one and offers the template's choices.
items.bank = inventory().querySelectorAll('[aria-label="Bank"] .sq').length === 24
items.keyring = inventory().querySelectorAll('[aria-label="Keyring"] .sq').length >= 4
items.locked = inventory().querySelectorAll('[aria-label="Bank bag slots"] .sq.locked').length === 6 - inv.bankBagSlots
// The count bought (#886) is an edit saved with the items: one more unlocks a slot, the Save sends it,
// and a refused count is outlined (SaveInventory stood in).
const bought = inventory().querySelector('input[aria-label="Bank bag slots bought"]')
if (bought && inv.bankBagSlots < 6) {
	bought.value = String(inv.bankBagSlots + 1)
	bought.dispatchEvent(new Event('change', { bubbles: true }))
	await P.frames(1)
	items.bought = { unlocked: inventory().querySelectorAll('[aria-label="Bank bag slots"] .sq.locked').length === 5 - inv.bankBagSlots, save: !button(head(), 'Save')?.disabled }
	const realSave = App.SaveInventory
	App.SaveInventory = async (g, list, n) => {
		items.bought.sent = n
		return { sql: '', refused: { column: 'bankBagSlots', message: 'Probe: refused' } }
	}
	try {
		button(head(), 'Save').click()
		await P.until(() => inventory().querySelector('.error'), WAIT, 'the refusal')
	} finally {
		App.SaveInventory = realSave
	}
	items.bought.outlined = bought.classList.contains('refused')
	button(head(), 'Revert').click()
	await P.until(() => button(head(), 'Saved'), WAIT, 'the revert')
	items.bought.reverted = Number(bought.value) === inv.bankBagSlots
	items.bought.ok = items.bought.unlocked && items.bought.save && items.bought.sent === inv.bankBagSlots + 1 && items.bought.outlined && items.bought.reverted
} else items.bought = bought ? { ok: true, skipped: 'all six bought' } : { ok: false }
const rolls = await App.InventoryItemTemplate(727).catch(() => null)
const bankFree = [...inventory().querySelectorAll('[aria-label="Bank"] .sq')].find((s) => s.getAttribute('draggable') !== 'true')
if (rolls?.randomChoices?.length && bankFree) {
	const place = bankFree.dataset.place
	bankFree.click()
	const search = inventory().querySelector('input.search')
	search.value = '727'
	search.dispatchEvent(new Event('input', { bubbles: true }))
	await P.until(() => [...inventory().querySelectorAll('.results button')].find((b) => b.textContent.includes('727')), WAIT, 'the search for 727')
	;[...inventory().querySelectorAll('.results button')].find((b) => b.textContent.includes('727')).click()
	await P.until(() => inventory().querySelector(`[data-place="${place}"].new`), WAIT, 'the sword in the bank')
	const select = inventory().querySelector('.details label.random select')
	items.random =
		!!select &&
		select.options.length === rolls.randomChoices.length + 1 &&
		Number(select.value) > 0 &&
		inventory()
			.querySelector('.details strong')
			.textContent.includes(select.selectedOptions[0].textContent.replace(/ \(.*\)$/, ''))
	button(head(), 'Revert').click()
	await P.until(() => button(head(), 'Saved'), WAIT, 'the revert')
} else items.random = 'skipped: no item 727 with random properties, or no free bank square'
// The character's picture (#880): between the equipment's columns, its model in its look wearing what
// its equipment slots hold (CharacterModelLook, given the slots' displays).
const figure = (el) => el?.querySelector('[aria-label="The character"]')
await P.until(() => figure(inventory())?.querySelector('canvas') || figure(inventory())?.querySelector('.empty')?.textContent.includes('no model'), WAIT, 'the character picture')
const equipped = inv.items.filter((i) => i.container === 0 && i.slot < 19).map((i) => ({ slot: i.slot, display: i.template.displayId, invType: i.template.invType }))
const charRace = Number((await App.ReadCharacter(guid)).values.race)
const drawn = await App.CharacterModelLook({ race: charRace, gender: 0, skin: 0, face: 0, hairStyle: 0, hairColor: 0, facialHair: 0 }, equipped)
items.figure = { canvas: !!figure(inventory()).querySelector('canvas'), model: drawn.model }
// The picture holds its size (#889): its canvas sat in a cell of no fixed height, and under an
// Interface size above 1 (the canvas's pixel ratio times the zoom, set as it mounts) each frame's
// buffer grew the cell a pixel, so the model looked to zoom in without end. Reopened at 1.25.
const { prefs } = await P.state()
const scaleBefore = prefs.uiScale
const figSize = () => {
	const c = figure(inventory())?.querySelector('canvas')
	return c ? c.clientHeight : 0
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
try {
	prefs.uiScale = 1.25
	button(root().querySelector('nav.tabs'), 'Character').click()
	await P.frames(2)
	button(root().querySelector('nav.tabs'), 'Equipment and bags').click()
	await P.until(() => figure(inventory())?.querySelector('canvas'), WAIT, 'the character picture again')
	await pause(500)
	const before = figSize()
	await pause(1000)
	items.figure.size = { before, after: figSize() }
} finally {
	prefs.uiScale = scaleBefore
}
items.figure.steady = items.figure.size.before > 0 && items.figure.size.before === items.figure.size.after
button(root().querySelector('nav.tabs'), 'Character').click()
await P.frames(1)

// The look (#875): each part offers the client's choices for the race and gender, and the home is the
// character_homebind row.
const record = await App.ReadCharacter(guid)
const lookLabel = label('Skin color')
await P.until(() => lookLabel?.querySelectorAll('option').length > 1, WAIT, 'the look choices')
const sheet = {
	skins: lookLabel.querySelectorAll('option').length,
	skinShown: Number(lookLabel.querySelector('select').value) === Number(record.values.skin),
	home: label('Zone')?.querySelector('input')?.value === record.values.home_zone,
	honor: !!label('Rank points') && !!label('Highest rank'),
}
// The Look section's picture (#880) redraws as a part of the look changes, before Save, and wears the
// Equipment and bags tab's items.
{
	const realLook = App.CharacterModelLook
	let call = null
	App.CharacterModelLook = async (l, w) => {
		call = { l, w }
		return realLook(l, w)
	}
	try {
		const sel = lookLabel.querySelector('select')
		const other = [...sel.options].find((o) => o.value !== sel.value)
		if (other) {
			sel.value = other.value
			sel.dispatchEvent(new Event('change', { bubbles: true }))
			await P.until(() => call && call.l.skin === Number(other.value), WAIT, 'the redrawn picture')
		}
		sheet.figure = { shown: !!figure(root()), redrawn: !other || call?.l.skin === Number(other.value), wears: !call || call.w.length === equipped.length }
	} finally {
		App.CharacterModelLook = realLook
	}
	button(root().querySelector('header .actions'), 'Revert').click()
	await P.frames(1)
}
const listTab = async (name, sel, wait) => {
	button(root().querySelector('nav.tabs'), name).click()
	await P.until(() => root().querySelector(sel) && !root().querySelector(sel).textContent.includes('Reading'), WAIT, wait)
	return root().querySelector(sel)
}
const stand = async (binding, column, run) => {
	const real = App[binding]
	App[binding] = async () => ({ sql: '', refused: { column, message: 'Probe: refused' } })
	try {
		await run()
	} finally {
		App[binding] = real
	}
}

// Skills: the rows ReadCharacterSkills gives; one taken out is an edit, a refusal outlines the row, Revert brings it back.
const skillsRead = await App.ReadCharacterSkills(guid)
const skillsEl = await listTab('Skills', '.sheet', 'the skills')
await P.until(() => skillsEl.querySelectorAll('li[data-skill]').length === skillsRead.skills.length, WAIT, 'the skill rows')
sheet.skills = skillsEl.querySelectorAll('li[data-skill]').length
if (sheet.skills) {
	const id = skillsEl.querySelector('li[data-skill]').dataset.skill
	const other = [...skillsEl.querySelectorAll('li[data-skill]')].find((l) => l.dataset.skill !== id)?.dataset.skill
	skillsEl.querySelector(`li[data-skill="${id}"] .x`).click()
	await P.frames(1)
	sheet.skillOut = !skillsEl.querySelector(`li[data-skill="${id}"]`) && button(skillsEl.querySelector('.head'), 'Save skills') !== undefined
	if (other) {
		await stand('SaveCharacterSkills', other, async () => {
			button(skillsEl.querySelector('.head'), 'Save').click()
			await P.until(() => skillsEl.querySelector('.error'), WAIT, 'the skill refusal')
		})
		sheet.skillOutlined = skillsEl.querySelector(`li[data-skill="${other}"]`).classList.contains('refused')
	}
	button(skillsEl.querySelector('.head'), 'Revert').click()
	await P.until(() => skillsEl.querySelectorAll('li[data-skill]').length === skillsRead.skills.length && button(skillsEl.querySelector('.head'), 'Saved'), WAIT, 'the skills revert')
}

// Spells: the known spells; Add starting spells adds what the character lacks of playercreateinfo_spell.
const spellsRead = (await App.ReadCharacterSpells(guid)) ?? []
const starting = (await App.StartingSpells(Number(record.values.race), Number(record.values.class))) ?? []
const spellsEl = await listTab('Spells', '[aria-label="Known spells"]', 'the spells')
const spellRows = () => spellsEl.querySelectorAll('li[data-spell]').length
await P.until(() => spellRows() === spellsRead.length, WAIT, 'the spell rows')
sheet.spells = spellRows()
const spellsHead = spellsEl.closest('.sheet').querySelector('.head')
const missing = starting.filter((id) => !spellsRead.some((s) => s.spell === id)).length
button(spellsEl.closest('.sheet'), 'Add starting spells').click()
await P.until(() => spellRows() === spellsRead.length + missing, WAIT, 'the starting spells')
sheet.startingAdded = missing
sheet.spellsDirty = missing === 0 || !!button(spellsHead, 'Save spells')
if (missing) {
	const id = starting.find((x) => !spellsRead.some((s) => s.spell === x))
	await stand('SaveCharacterSpells', String(id), async () => {
		button(spellsHead, 'Save').click()
		await P.until(() => spellsEl.closest('.sheet').querySelector('.error'), WAIT, 'the spell refusal')
	})
	sheet.spellOutlined = spellsEl.querySelector(`li[data-spell="${id}"]`)?.classList.contains('refused')
	button(spellsHead, 'Revert').click()
	await P.until(() => spellRows() === spellsRead.length && button(spellsHead, 'Saved'), WAIT, 'the spells revert')
}

// Reputation: every faction ReadCharacterReputation gives, once the list shows them all; a new rank is an edit.
const repsRead = (await App.ReadCharacterReputation(guid)) ?? []
const repEl = await listTab('Reputation', '.sheet:has([aria-label="Find a faction"])', 'the reputation')
const listedOnly = repEl.querySelector('label input[type="checkbox"]')
listedOnly.click()
const repRows = () => repEl.querySelectorAll('li[data-faction]').length
await P.until(() => repRows() === repsRead.length, WAIT, 'the factions')
sheet.factions = repRows()
if (repsRead.length) {
	const f = repsRead[0].faction
	const sel = repEl.querySelector(`li[data-faction="${f}"] select`)
	sel.value = sel.value === '7' ? '6' : '7'
	sel.dispatchEvent(new Event('change', { bubbles: true }))
	await P.frames(1)
	const head = repEl.querySelector('.head')
	sheet.repDirty = !!button(head, 'Save reputation') && button(root().querySelector('nav.tabs'), 'Reputation').textContent.includes('•')
	await stand('SaveCharacterReputation', String(f), async () => {
		button(head, 'Save').click()
		await P.until(() => repEl.querySelector('.error'), WAIT, 'the reputation refusal')
	})
	sheet.repOutlined = repEl.querySelector(`li[data-faction="${f}"]`).classList.contains('refused')
	button(head, 'Revert').click()
	await P.until(() => button(head, 'Saved'), WAIT, 'the reputation revert')
}
// Quests, Explored and Flight paths (#881): each lists what its Read binding gives, takes an edit,
// outlines what a stood-in Save refuses and reverts.
const questsRead = (await App.ReadCharacterQuests(guid)) ?? []
const questEl = await listTab('Quests', '.sheet:has([aria-label="Find a quest to add"])', 'the quests')
const questRows = () => questEl.querySelectorAll('li[data-quest]').length
await P.until(() => questRows() === questsRead.length, WAIT, 'the quest rows')
sheet.quests = questRows()
const found = ((await App.SearchQuests('the')) ?? []).find((r) => !questsRead.some((q) => q.quest === r.quest))
if (found) {
	type(questEl.querySelector('[aria-label="Find a quest to add"]'), String(found.quest))
	await P.until(() => questEl.querySelector(`li[data-add="${found.quest}"] button`), WAIT, 'the quest search')
	button(questEl.querySelector(`li[data-add="${found.quest}"]`), 'Take').click()
	await P.frames(1)
	const head = questEl.querySelector('.head')
	sheet.questAdded = !!questEl.querySelector(`li[data-quest="${found.quest}"]`) && !!button(head, 'Save quests') && button(root().querySelector('nav.tabs'), 'Quests').textContent.includes('•')
	await stand('SaveCharacterQuests', String(found.quest), async () => {
		button(head, 'Save').click()
		await P.until(() => questEl.querySelector('.error'), WAIT, 'the quest refusal')
	})
	sheet.questOutlined = questEl.querySelector(`li[data-quest="${found.quest}"]`)?.classList.contains('refused')
	button(head, 'Revert').click()
	await P.until(() => questRows() === questsRead.length && button(head, 'Saved'), WAIT, 'the quests revert')
	sheet.questReverted = true
} else {
	sheet.questAdded = sheet.questOutlined = sheet.questReverted = 'no quest to add'
}

const exploreRead = await App.ReadCharacterExploration(guid)
const exploreEl = await listTab('Explored', '.sheet:has([aria-label="Find a zone"])', 'the explored areas')
await P.until(() => exploreEl.querySelectorAll('li[data-zone]').length === exploreRead.zones.length, WAIT, 'the zones')
sheet.zones = exploreEl.querySelectorAll('li[data-zone]').length
{
	const head = exploreEl.querySelector('.head')
	const box = exploreEl.querySelector('li[data-zone] input[type="checkbox"]')
	box.click()
	await P.frames(1)
	sheet.zoneMarked = !!button(head, 'Save explored areas')
	button(head, 'Revert').click()
	await P.until(() => button(head, 'Saved'), WAIT, 'the explored revert')
	sheet.exploreReverted = true
}

const taxiRead = await App.ReadCharacterTaxi(guid)
const taxiEl = await listTab('Flight paths', '.sheet:has([aria-label="Find a stop"])', 'the flight paths')
taxiEl.querySelector('.row label input[type="checkbox"]').click()
await P.until(() => taxiEl.querySelectorAll('li[data-stop]').length === taxiRead.stops.length, WAIT, 'the stops')
sheet.stops = taxiEl.querySelectorAll('li[data-stop]').length
if (sheet.stops) {
	const head = taxiEl.querySelector('.head')
	const stop = taxiEl.querySelector('li[data-stop]').dataset.stop
	taxiEl.querySelector(`li[data-stop="${stop}"] input`).click()
	await P.frames(1)
	sheet.stopMarked = !!button(head, 'Save flight paths')
	await stand('SaveCharacterTaxi', stop, async () => {
		button(head, 'Save').click()
		await P.until(() => taxiEl.querySelector('.error'), WAIT, 'the stop refusal')
	})
	sheet.stopOutlined = taxiEl.querySelector(`li[data-stop="${stop}"]`).classList.contains('refused')
	button(head, 'Revert').click()
	await P.until(() => button(head, 'Saved'), WAIT, 'the flight paths revert')
	sheet.taxiReverted = true
} else {
	sheet.stopMarked = sheet.stopOutlined = sheet.taxiReverted = 'no stops'
}
// Every tab fits the page without its scroll bar at the runner's window (#931): long lists scroll in place.
const overflowing = []
for (const b of root().querySelectorAll('nav.tabs > button:not(.back)')) {
	b.click()
	await P.frames(2)
	const page = root().querySelector('.scroll.page')
	if (page.scrollHeight > page.clientHeight + 1 || page.scrollWidth > page.clientWidth + 1) overflowing.push(`${b.textContent.trim()} ${page.scrollWidth}x${page.scrollHeight} in ${page.clientWidth}x${page.clientHeight}`)
}
sheet.overflowing = overflowing
button(root().querySelector('nav.tabs'), 'Character').click()
await P.frames(1)
const sheetOk =
	!overflowing.length &&
	sheet.skins > 1 &&
	sheet.figure.shown &&
	sheet.figure.redrawn &&
	sheet.figure.wears &&
	sheet.skinShown &&
	sheet.home &&
	sheet.honor &&
	sheet.skills === skillsRead.skills.length &&
	(!sheet.skills || (sheet.skillOut && sheet.skillOutlined !== false)) &&
	sheet.spells === spellsRead.length &&
	sheet.spellsDirty &&
	sheet.spellOutlined !== false &&
	sheet.factions === repsRead.length &&
	(!repsRead.length || (sheet.repDirty && sheet.repOutlined)) &&
	sheet.quests === questsRead.length &&
	sheet.questAdded &&
	sheet.questOutlined &&
	sheet.questReverted &&
	sheet.zones === exploreRead.zones.length &&
	sheet.zoneMarked &&
	sheet.exploreReverted &&
	sheet.stops === taxiRead.stops.length &&
	sheet.stopMarked &&
	sheet.stopOutlined &&
	sheet.taxiReverted

const itemsOk =
	items.shown === items.read &&
	items.figure.canvas &&
	items.figure.steady &&
	/^Character\\/i.test(items.figure.model) &&
	(!from || !to || (items.moved && items.overAllowed && items.overKept && items.iconFixed && items.saveText === 'Save equipment' && items.tabMarked && items.sent > 0 && items.outlined && items.added && items.reverted)) &&
	items.bank &&
	items.keyring &&
	items.locked &&
	items.bought.ok &&
	items.random !== false

// Delete character… (#876) asks first, Keep it backs out, and Delete character sends the guid and goes
// back to the account's page (DeleteCharacter stood in, so nothing is deleted).
const del = {}
const actions = () => root().querySelector('header .actions')
button(actions(), 'Delete character').click()
await P.until(() => button(root().querySelector('.bar.warn'), 'Keep it'), WAIT, 'the delete question')
del.asked = root().querySelector('.bar.warn').textContent.includes(name)
button(root().querySelector('.bar.warn'), 'Keep it').click()
await P.frames(1)
del.kept = !root().querySelector('.bar.warn') && ui.characterEditor.guid === guid
const realDelete = App.DeleteCharacter
App.DeleteCharacter = async (g) => {
	del.sent = g
	return name
}
try {
	button(actions(), 'Delete character').click()
	await P.until(() => button(root().querySelector('.bar.warn'), 'Delete character'), WAIT, 'the delete question')
	button(root().querySelector('.bar.warn'), 'Delete character').click()
	await P.until(() => ui.characterEditor.guid === 0 && root().querySelector('[aria-label="Characters"] button') && root().querySelector('.bar.ok'), WAIT, 'the account page')
} finally {
	App.DeleteCharacter = realDelete
}
del.back = ui.characterEditor.account === withChars.id && root().querySelector('.bar.ok').textContent.includes(`Deleted ${name}.`)
del.note = root().querySelector('.bar.ok').textContent.trim()
const delOk = del.asked && del.kept && del.sent === guid && del.back

button(root().querySelector('aside'), 'New account').click()
await P.until(() => button(root(), 'Make account'), WAIT, 'the new account form')
const makeOff = button(root(), 'Make account').disabled

button(root().querySelector('header .actions'), 'Close').click()
await P.frames(1)
const closed = !root() && ui.characterEditor === null

const ok =
	listed > 0 && chars === withChars.characters && deleteOn && !!name && saveText === 'Save character (1)' && marked && sent?.level !== undefined && refusedShown && outlined && reverted && itemsOk && sheetOk && delOk && makeOff && closed
return { ok, listed, account: withChars.name, chars, deleteOn, name, level, saveText, marked, sent, refusedShown, outlined, reverted, items, sheet, del, makeOff, closed }
