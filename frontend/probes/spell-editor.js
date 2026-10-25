// The spell editor (#294): Tools › Spells… finds Fireball (133), whose right-click copies `.cast 133`, shows its tooltip as the game does (rank, cost, range, cast time, the description's tokens filled in), its effects in a line each and its visual's other users; a typed name and base points change the tooltip before saving, the Effect 1 tab names the effect, a cost past an unsigned int is an unsaved edit (Go refuses it, a Go test; Save is never pressed), Change icon… previews a hovered icon and marks a picked one for Save, Take the visual of Frost Nova sets the visual, Revert drops it all, Export… and Import… are there (#357), and New spell offers the six starters and a copy of the open spell, the copy picked; nothing written.
// touches: frontend/src/components/SpellEditor.svelte, frontend/src/lib/world/spellFields.ts, frontend/src/lib/wow/spells.ts, internal/vmangos/spells.go, internal/vmangos/spelltext.go
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Spell editor"]')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const type = (input, value) => {
	input.value = value
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
const openTab = async (name) => {
	button(root().querySelector('nav.tabs'), name).click()
	await P.frames(1)
}
const field = (label) => [...root().querySelectorAll('.grid > label')].find((l) => (l.querySelector('span')?.textContent ?? l.firstChild?.textContent ?? '').split(' · ')[0].trim() === label)?.querySelector('input, select, textarea')
const tooltip = () =>
	[...root().querySelectorAll('.look .tip .line, .look .tip .tip-text')].map((l) => (l.querySelectorAll('span').length ? [...l.querySelectorAll('span')].map((s) => s.textContent.trim()).join(' | ') : l.textContent.trim()))
const effects = () => [...root().querySelectorAll('.effects li')].map((l) => l.textContent.trim())
const actions = () => root().querySelector('header .actions')

ui.spellEditor = { entry: 0 }
await P.until(() => root(), WAIT, 'the editor')
// The Find list can browse every spell, leftovers too (#367). Whether the client holds any leftover test spell is up to its owner, so
// the probe compares the lists instead: "every" holds all of what "all" lists for the same search (#421), whatever the client carries.
const category = root().querySelector('aside select.category')
const found = () => [...root().querySelectorAll('[aria-label="Spells found"] button')]
const pick = (value) => {
	category.value = value
	category.dispatchEvent(new Event('change', { bubbles: true }))
}
const search = root().querySelector('aside input[type=search]')
type(search, 'Fireball')
await P.until(() => found().some((b) => /Fireball.*133/.test(b.textContent)), WAIT, 'the every list')
const everyCount = found().length
pick('all')
await P.until(() => category.value === 'all' && found().some((b) => /Fireball.*133/.test(b.textContent)), WAIT, 'the all list')
const allCount = found().length
pick('every')
await P.until(() => category.value === 'every' && found().length === everyCount, WAIT, 'the every list again')
const leftovers = everyCount - allCount
type(root().querySelector('aside input[type=search]'), 'Fireball')
await P.until(() => [...root().querySelectorAll('[aria-label="Spells found"] button')].some((b) => b.textContent.includes('133')), WAIT, 'the search')
const hit = [...root().querySelectorAll('[aria-label="Spells found"] button')].find((b) => /Fireball.*Rank 1\b.*133/.test(b.textContent))
hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 160 }))
await P.frames(1)
const menu = { items: ui.contextMenu?.items.map((i) => i.label) ?? [] }
;[...document.querySelectorAll('.menu[role=menu] button')].find((b) => b.textContent.startsWith('Copy .cast')).click()
await P.until(() => root().querySelector('.bar.ok, .bar.error'), WAIT, 'the copy')
menu.clipboard = await window.runtime.ClipboardGetText().catch((e) => `(${e})`)
hit.click()
await P.until(() => tooltip().length >= 3 && effects().length > 0, WAIT, 'the tooltip')
const title = root().querySelector('h2').textContent.trim()
const tip = tooltip()
const fx = effects()
await P.until(() => /as /.test(root().querySelector('.visual .dim')?.textContent ?? ''), WAIT, 'the visual users')
const visualText = root().querySelector('.visual .dim').textContent.trim()
const visualBefore = root().querySelector('.visual input').value
// Export… and Import… (#357) open native dialogs, so only their presence is checked.
const scripts = !!button(actions(), 'Export') && !!button(actions(), 'Import')

// Typed values: the tooltip follows before anything is saved.
type(field('Name'), 'Probe Bolt')
await openTab('Effect 1')
const summary = root().querySelector('.summary')?.textContent.trim()
type(field('Base points'), '99')
await P.frames(2)
const edited = tooltip()

// A cost past an unsigned int is an unsaved edit; Go's refusal is a Go test (TestEditorSavesRefuseOutOfRangeValues, #419), so Save is never pressed.
await openTab('Spell')
type(field('Cost'), '99999999999')
await openTab('Effect 2')

// Change icon…: the grid previews the icon under the pointer, a click picks it, Change icon marks it for Save.
button(root().querySelector('.look'), 'Change icon').click()
await P.until(() => root().querySelectorAll('.icon-btn').length > 10, WAIT, 'the icons')
const firstIcon = root().querySelector('.icon-btn').title
const tile = [...root().querySelectorAll('.icon-btn')][3]
tile.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
await P.frames(1)
const hovering = root().querySelector('.change-bar .dim').textContent.trim()
tile.click()
await P.frames(1)
button(root().querySelector('.change-bar'), 'Change icon').click()
await P.frames(1)
const picked = root().querySelector('.icon-text').textContent.trim()

// Take the visual of Frost Nova.
button(root().querySelector('.look'), 'Take the visual of').click()
await P.frames(1)
type(root().querySelector('[aria-label="Take the visual of a spell"]'), 'Frost Nova')
const visualHit = () => [...root().querySelectorAll('[aria-label="Spells to take the visual of"] button:not(:disabled)')].find((b) => b.textContent.includes('Frost Nova'))
await P.until(visualHit, WAIT, 'the visual search')
visualHit().click()
await P.frames(1)
const visualAfter = root().querySelector('.visual input').value
const saveText = button(actions(), 'Save')?.textContent.trim()

button(actions(), 'Revert').click()
await P.frames(2)
const reverted = !!button(actions(), 'Saved') && tooltip()[0] === tip[0] && root().querySelector('.visual input').value === visualBefore

// New spell: the starters (#360) and a copy of the open one, picked.
button(root().querySelector('aside'), 'New spell').click()
await P.until(() => root().querySelectorAll('.new-form label.start').length > 1, WAIT, 'the starters')
const starts = [...root().querySelectorAll('.new-form label.start strong')].map((s) => s.textContent.trim())
const startOn = root().querySelector('.new-form label.start.on strong')?.textContent.trim()
const newName = root().querySelector('.new-form input[type=text]')?.value
ui.spellEditor = null
await P.frames(1)

const ok =
	menu.clipboard === '.cast 133' &&
	title.startsWith('Fireball') &&
	/Rank 1/.test(tip[0]) &&
	tip.some((l) => /Mana/.test(l)) &&
	tip.some((l) => /sec cast/.test(l)) &&
	tip.some((l) => /14 to 22 Fire damage/.test(l) && !l.includes('$')) &&
	/^1 Damage 14 to 22/.test(fx[0]) &&
	/^as /.test(visualText) &&
	/Probe Bolt/.test(edited[0]) &&
	edited.some((l) => /100 to 108 Fire damage/.test(l)) &&
	/^Damage/.test(summary) &&
	/^Now Spell_Fire_FlameBolt\. Showing \w+/.test(hovering) &&
	/Set on Save/.test(picked) &&
	leftovers >= 0 &&
	visualAfter !== visualBefore &&
	/\(\d\)/.test(saveText) &&
	reverted &&
	scripts &&
	starts.length === 7 &&
	starts[0] === 'Bolt' &&
	startOn === 'Copy of Fireball' &&
	newName === 'Fireball'
return { ok, leftovers, scripts, menu, title, tip, fx, visualText, summary, edited, firstIcon, hovering, picked, visualBefore, visualAfter, saveText, reverted, starts, startOn, newName }
