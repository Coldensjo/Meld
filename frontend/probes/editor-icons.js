// Icons beside item, spell and class names in the editors (#682): the item editor's title (Worn Shortsword, 25) and the spell editor's (Fireball, 133) show the item's and the spell's icon, the item editor's Requirements tab ticks each of the nine classes beside its class icon (cut from the client's class atlas), the spell editor's Spell tab names its reagents and tools with item pickers, and the creature editor's Trainer class (Llane Beshere, 911, a warrior trainer) is a select of classes with Warrior's icon beside it; nothing written.
// touches: frontend/src/components/ClassIcon.svelte, frontend/src/components/RefIcon.svelte, frontend/src/components/TemplateFields.svelte, frontend/src/lib/wow/classes.ts, frontend/src/lib/wow/classIcons.ts, frontend/src/components/ItemEditor.svelte, frontend/src/components/SpellEditor.svelte, frontend/src/lib/world/spellFields.ts, frontend/src/lib/world/creatureFields.ts
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const loaded = (el) => !!el && [...el.querySelectorAll('img')].length > 0 && [...el.querySelectorAll('img')].every((i) => i.complete && i.naturalWidth > 0)
const tab = (root, name) => [...(root?.querySelectorAll('nav.tabs button') ?? [])].find((b) => b.textContent.trim().startsWith(name))

// The item editor: the title's icon, and the class ticks' icons.
const item = () => document.querySelector('[aria-label="Item editor"]')
ui.itemEditor = { entry: 25 }
await P.until(() => item()?.querySelector('h2')?.textContent.includes('Worn Shortsword') && tab(item(), 'Requirements'), WAIT, 'the item')
await P.until(() => loaded(item().querySelector('h2')), WAIT, 'the item title icon')
tab(item(), 'Requirements').click()
await P.frames(1)
const classSet = () => [...item().querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent === 'Classes')
await P.until(() => classSet() && classSet().querySelectorAll('label.check img').length === 9 && loaded(classSet()), WAIT, 'the class icons')
const classes = [...classSet().querySelectorAll('label.check')].map((l) => ({ name: l.textContent.trim(), icon: !!l.querySelector('img') }))
// Two different classes get two different cells of the atlas.
const urls = new Set([...classSet().querySelectorAll('img')].map((i) => i.src))
ui.itemEditor = null
await P.frames(1)

// The spell editor: the title's icon, and the reagents as item pickers.
const spell = () => document.querySelector('[aria-label="Spell editor"]')
ui.spellEditor = { entry: 133 }
await P.until(() => spell()?.querySelector('h2')?.textContent.includes('Fireball') && tab(spell(), 'Spell'), WAIT, 'the spell')
await P.until(() => loaded(spell().querySelector('h2')), WAIT, 'the spell title icon')
tab(spell(), 'Spell').click()
await P.frames(1)
const refLabels = [...spell().querySelectorAll('.ref .label')].map((l) => l.textContent.trim())
ui.spellEditor = null
await P.frames(1)

// The creature editor: Trainer class with its icon.
const creature = () => document.querySelector('[aria-label="Creature editor"]')
ui.creatureEditor = { key: null, entry: 911 }
await P.until(() => tab(creature(), 'Creature'), WAIT, 'the creature')
tab(creature(), 'Creature').click()
await P.frames(1)
const trainer = () => [...creature().querySelectorAll('.grid > label')].find((l) => l.firstChild?.textContent.trim() === 'Trainer class')
await P.until(() => trainer()?.querySelector('select')?.value === '1' && loaded(trainer()), WAIT, 'the trainer class icon')
const trainerText = trainer().querySelector('select').selectedOptions[0]?.textContent
ui.creatureEditor = null
await P.frames(1)

const ok =
	classes.length === 9 && classes.every((c) => c.icon) && classes[0].name === 'Warrior' && urls.size === 9 && refLabels.includes('Reagent 1') && refLabels.includes('Tool 1') && refLabels.includes('Next spell') && trainerText === 'Warrior'
return { ok, classes, urls: urls.size, refLabels, trainerText }
