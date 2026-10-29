// The creature editor's Spells tab (#243): Scarlet Commander Mograine (3976) shows list 39760's two spells with names, icons and text from the client, the Add spells list shows the creature abilities without typing, the Mage: Fire category lists Fire Blast, the Frost school empties it, a search in it finds Fireball, adding it is an unsaved edit that Save counts and Revert undoes. Then Copy this creature asks for a name (#260), the New creature tab closes the editor and opens the creature guide, and the guide's "How it looks" step keeps the display picker, the weapon picker and the preview inside the page, the preview in view and not covered (#221). Nothing is written to the database.
// touches: frontend/src/components/CreatureEditor.svelte, frontend/src/components/SpellsTab.svelte, frontend/src/components/SpellPicker.svelte, internal/vmangos/creaturespells.go, internal/vmangos/spelllist.go, frontend/src/components/CreaturesWorkspace.svelte, frontend/src/lib/engine/SpawnActions.ts, frontend/src/components/DisplayPicker.svelte, frontend/src/components/WeaponPicker.svelte, frontend/src/components/CreaturePreview.svelte
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
// The waits give room for a slow database; the whole probe takes about 35 s.
const WAIT = 120_000
const root = () => document.querySelector('[data-editor="creature"]')
const tab = () => root()?.querySelector('.spells')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const names = () => [...(tab()?.querySelectorAll('.list > li .name') ?? [])].map((n) => n.textContent.replace(/\s+/g, ' ').trim())
ui.creatureEditor = { key: null, entry: 3976 }
await P.frames(1)
await P.until(() => button(root()?.querySelector('nav.tabs'), 'Spells'), WAIT, 'the editor')
button(root().querySelector('nav.tabs'), 'Spells').click()
await P.frames(1)
await P.until(() => names().length === 2 && names().every((n) => !n.startsWith('…')), WAIT, 'the list')
const listed = names()
await P.until(() => tab().querySelectorAll('.list > li .title img').length === 2, WAIT, 'the icons')
const texts = [...tab().querySelectorAll('.list > li .text')].map((t) => t.textContent)
const listLine = tab().querySelector('.head + p')?.textContent ?? ''
const rows = () => [...(tab()?.querySelectorAll('.results li') ?? [])].map((li) => li.textContent.replace(/\s+/g, ' ').trim())
const pick = (sel, value) => {
	const el = tab().querySelector(sel)
	el.value = String(value)
	el.dispatchEvent(new Event('change', { bubbles: true }))
}
await P.until(() => tab().querySelectorAll('select.category optgroup').length > 0, WAIT, 'the categories')
pick('select.category', 'npc')
pick('select.school', -1)
await P.until(() => rows().length > 0 && /of \d+/.test(tab().querySelector('.count')?.textContent ?? ''), WAIT, 'the creature abilities')
const npcCount = tab().querySelector('.count').textContent.replace(/\s+/g, ' ').trim()
const npcRows = rows().length
pick('select.category', 'skill:8')
await P.until(() => rows().some((r) => r.startsWith('Fire Blast')), WAIT, 'the Fire list')
const fireRows = rows().length
pick('select.school', 4)
await P.until(() => tab().querySelector('.results') === null, WAIT, 'the Frost school')
pick('select.school', -1)
await P.until(() => rows().length === fireRows, WAIT, 'any school again')
const search = tab().querySelector('input[type=search]')
search.value = 'fireball'
search.dispatchEvent(new Event('input', { bubbles: true }))
await P.until(() => rows().length > 0 && rows().length < fireRows && rows()[0].startsWith('Fireball'), WAIT, 'the search')
const first = tab().querySelector('.results li button')
const found = first.textContent.replace(/\s+/g, ' ').trim()
first.click()
await P.frames(2)
const afterAdd = names()
const saveText = button(tab().querySelector('.head'), 'Save')?.textContent.trim()
const close = root().querySelector('header .actions button:last-child')
close.click()
await P.frames(2)
const warned = root()?.querySelector('.bar.warn')?.textContent ?? ''
button(tab().querySelector('.head'), 'Revert').click()
await P.until(() => names().length === 2, WAIT, 'the revert')
await P.frames(2)
const reverted = button(tab().querySelector('.head'), 'Saved') !== undefined

// Copy this creature asks for a name; Cancel leaves (#260).
const hasCopy = !!button(root().querySelector('header .actions'), 'Copy this creature')
button(root().querySelector('header .actions'), 'Copy this creature').click()
await P.frames(2)
const copyBar = root().querySelector('.bar input[placeholder="Name of the copy"]') !== null
button(root().querySelector('.bar'), 'Cancel').click()
await P.frames(2)
const barGone = root().querySelector('.bar input[placeholder="Name of the copy"]') === null
// The New creature tab closes the editor and opens the guide on step 1.
button(root().querySelector('nav.tabs'), 'New creature').click()
await P.frames(2)
const newCreature = { hasCopy, copyBar, barGone, editorClosed: root() === null, guide: ui.creatures === true, editorCleared: ui.creatureEditor === null }

// The guide's "How it looks" step (#221): the pickers and the preview stay inside the page, the preview in view.
await P.frames(3)
const q = (s) => document.querySelector(s)
const type = async (el, v) => {
	el.value = v
	el.dispatchEvent(new Event('input', { bubbles: true }))
	await P.frames(2)
}
const next = async () => {
	const b = [...document.querySelectorAll('footer button')].find((x) => x.textContent.trim() === 'Next')
	b.click()
	await P.frames(3)
}
await P.until(() => q('input[placeholder="Gregor the Smith"]'), WAIT, 'the guide')
await type(q('input[placeholder="Gregor the Smith"]'), 'Probe')
await next()
await P.until(() => q('input[name="faction"]'), WAIT, 'factions')
q('input[name="faction"]').click()
await P.frames(3)
await next()
await P.until(() => q('.looks'), WAIT, 'looks')
await P.frames(20)
const looksBox = q('.looks').getBoundingClientRect()
const pickBox = q('.looks .pick').getBoundingClientRect()
const showBox = q('.looks .show').getBoundingClientRect()
const page = q('.page')
page.scrollTop = page.scrollHeight
await P.frames(3)
const botShow = q('.looks .show').getBoundingClientRect()
const botPage = page.getBoundingClientRect()
const looks = {
	inside: botShow.top >= botPage.top - 1 && botShow.bottom <= botPage.bottom + 1,
	contained: looksBox.bottom >= pickBox.bottom - 1,
	noOverlap: showBox.left >= pickBox.right - 1,
	looks: [looksBox.top, looksBox.bottom],
	pick: [pickBox.top, pickBox.bottom, pickBox.right],
	show: [showBox.left, showBox.top, showBox.bottom],
	botShow: [botShow.top, botShow.bottom],
}
ui.creatures = false
ui.creatureEditor = null
await P.frames(1)
const ok =
	Object.values(newCreature).every((v) => v) &&
	looks.inside &&
	looks.contained &&
	looks.noOverlap &&
	listed[0].startsWith('Crusader Strike') &&
	listed[1].startsWith('Hammer of Justice') &&
	texts.length === 2 &&
	texts.every((t) => t && !t.includes('$')) &&
	listLine.includes('39760') &&
	npcRows === 200 &&
	npcCount.startsWith('Showing 200 of') &&
	fireRows > 50 &&
	found.startsWith('Fireball') &&
	afterAdd.length === 3 &&
	afterAdd[2].startsWith('Fireball') &&
	saveText === 'Save spells' &&
	warned.includes('unsaved changes to the spells') &&
	reverted
return { ok, npcRows, npcCount, fireRows, listed, texts, listLine, found, afterAdd, saveText, warned, reverted, newCreature, looks }
