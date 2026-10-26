// The spell editor's tick lists, selects and pickers (#703): Execute (5308) on the Needs tab ticks Battle and Berserker stance, its target aura state reads "Health under 20%", its item class Weapon with the weapon subclasses as a tick list, and on the Flags tab its attributes tick "Is an ability"; Mongoose Bite (1495) needs the Defense aura state; Smelt Copper (2657) names its spell focus; Fireball (133) names its global cooldown category by its spells; Hearthstone (8690) its cooldown category; Eye of Kilrogg (126) its active icon, whose Find lists the client's icons by name with their pictures and puts a picked one's ID in; the misc value follows the effect: Summon Voidwalker (697) names its creature, Frost Ward (6143) ticks Frost, Arcane Intellect (1459) selects Intellect, Enchant Bracer - Minor Agility (7779) names its enchantment (#709); on Fireball, picking Weapon as the item class turns the subclasses into a tick list and ticking Daggers is a changed value, which Revert drops; nothing saved; takes about 15 s.
// touches: frontend/src/components/RefField.svelte, frontend/src/components/TemplateFields.svelte, frontend/src/components/SpellEditor.svelte, frontend/src/lib/world/spellFields.ts, frontend/src/lib/wow/refNames.ts, internal/vmangos/spelltables.go, internal/vmangos/itemtables.go
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Spell editor"]')
const tab = (name) => [...(root()?.querySelectorAll('nav.tabs button') ?? [])].find((b) => b.textContent.trim().startsWith(name))
const ref = (label) => [...(root()?.querySelectorAll('.ref') ?? [])].find((r) => r.querySelector('.label')?.textContent === label)
const named = (label) => ref(label)?.querySelector('.name span:not(.dim)')
const text = (label) => ref(label)?.querySelector('.name')?.textContent.replace(/\s+/g, ' ').trim() ?? ''
const select = (label) => [...root().querySelectorAll('.grid > label')].find((l) => (l.firstChild?.textContent ?? '').trim() === label)?.querySelector('select')
const chosen = (label) => select(label)?.selectedOptions[0]?.textContent ?? ''
const ticks = (legend) => {
	const set = [...root().querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent === legend)
	return set ? [...set.querySelectorAll('label.check')].filter((l) => l.querySelector('input').checked).map((l) => l.textContent.trim()) : null
}

async function open(entry, tabName) {
	ui.spellEditor = { entry }
	await P.until(() => tab(tabName) && root().querySelector('header .title .dim')?.textContent.startsWith(`spell ${entry} · build`), WAIT, `spell ${entry}`)
	tab(tabName).click()
	await P.frames(2)
}

const got = {}
await open(5308, 'Needs')
got.stances = ticks('Only in these forms')
got.targetState = chosen('Target aura state')
got.itemClass = chosen('Item class')
got.subclasses = ticks('Subclasses')
tab('Flags').click()
await P.frames(1)
got.attributes = ticks('Attributes')

await open(1495, 'Needs')
got.casterState = chosen('Caster aura state')

await open(2657, 'Needs')
await P.until(() => named('Near a spell focus'), WAIT, 'the spell focus name')
got.focus = text('Near a spell focus')

await open(8690, 'Spell')
await P.until(() => named('Cooldown category'), WAIT, 'the category name')
got.category = text('Cooldown category')

await open(126, 'Flags')
await P.until(() => named('Active icon'), WAIT, 'the active icon')
got.icon = text('Active icon')
got.iconPicture = !!ref('Active icon').querySelector('.name img, .name .icon')
// Its Find lists the client's icons by name, each with its picture; a pick puts its ID in.
;[...ref('Active icon').querySelectorAll('button')].find((b) => b.textContent === 'Find').click()
await P.frames(1)
const iconSearch = ref('Active icon').querySelector('input[type=search]')
iconSearch.value = 'Frost'
iconSearch.dispatchEvent(new Event('input', { bubbles: true }))
await P.until(() => ref('Active icon').querySelectorAll('li button').length > 3 && /Frost/i.test(ref('Active icon').querySelector('li button').textContent), WAIT, 'the icon list')
const iconHit = ref('Active icon').querySelector('li button')
got.iconHit = iconHit.textContent.replace(/\s+/g, ' ').trim()
got.iconHitPicture = !!iconHit.querySelector('.icon')
iconHit.click()
await P.frames(1)
got.iconPicked = ref('Active icon').querySelector('input').value
;[...root().querySelectorAll('header button')].find((b) => b.textContent.trim().startsWith('Revert'))?.click()
await P.frames(1)

await open(697, 'Effect 1')
await P.until(() => named('Creature'), WAIT, 'the summoned creature')
got.summon = text('Creature')

await open(6143, 'Effect 1')
got.schools = ticks('Schools')

await open(1459, 'Effect 1')
got.stat = chosen('Stat')

await open(7779, 'Effect 1')
await P.until(() => named('Enchantment'), WAIT, 'the enchantment name')
got.enchant = text('Enchantment')

await open(133, 'Spell')
await P.until(() => named('Global cooldown category'), WAIT, 'the global cooldown category')
got.global = text('Global cooldown category')
// Picking an item class makes the subclasses a tick list; a tick is a changed value.
tab('Needs').click()
await P.frames(1)
got.noClassSubclasses = ticks('Subclasses')
const cls = select('Item class')
cls.value = '2'
cls.dispatchEvent(new Event('change', { bubbles: true }))
await P.frames(2)
const dagger = [...[...root().querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent === 'Subclasses').querySelectorAll('label.check')].find((l) => l.textContent.trim() === 'Dagger')
got.dagger = !!dagger
// The mask was -1 (every subclass); clearing Daggers leaves the rest.
dagger?.querySelector('input').click()
await P.frames(2)
const daggerSet = [...root().querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent === 'Subclasses')
got.subclassChanged = daggerSet?.classList.contains('changed') ?? false
const revert = [...root().querySelectorAll('header button')].find((b) => b.textContent.trim().startsWith('Revert'))
revert?.click()
await P.frames(2)
got.reverted = chosen('Item class') !== 'Weapon'
ui.spellEditor = null
await P.frames(1)

const ok =
	JSON.stringify(got.stances) === JSON.stringify(['Battle stance', 'Berserker stance']) &&
	got.targetState === 'Health under 20%' &&
	got.itemClass === 'Weapon' &&
	Array.isArray(got.subclasses) &&
	got.subclasses.length > 3 &&
	got.attributes?.includes('Is an ability (not a spell)') &&
	got.casterState.startsWith('Defense') &&
	/forge|anvil/i.test(got.focus) &&
	/Hearthstone/.test(got.category) &&
	got.icon.length > 2 &&
	!got.icon.startsWith('No ') &&
	got.iconPicture &&
	/Frost/i.test(got.iconHit) &&
	got.iconHitPicture &&
	got.iconHit.includes(got.iconPicked) &&
	got.iconPicked !== '135' &&
	/Voidwalker/.test(got.summon) &&
	JSON.stringify(got.schools) === JSON.stringify(['Frost']) &&
	got.stat === 'Intellect' &&
	/Agility/.test(got.enchant) &&
	got.global.length > 3 &&
	!got.global.startsWith('No ') &&
	got.noClassSubclasses === null &&
	got.dagger &&
	got.subclassChanged &&
	got.reverted
return { ok, ...got }
