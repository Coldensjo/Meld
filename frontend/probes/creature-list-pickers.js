// The creature editor's list pickers (#700): Hogger (448) names its loot, pickpocket loot and (on the Looks tab) equipment by what they hold, each marked "this creature's own" (its entry), and its spell list (4480, entry × 10) too; Loot's Find offers its own list before a search, and a search by an item's name lists other loot with how many creatures use each, a pick putting its number in, marked changed; Zaldimar Wefhellt (328) names his trainer list by its spells and the creatures sharing it; Innkeeper Helbrek (1464) his vendor list by its items; the Stormwind City Guard's (68) Messages tab names an option's menu, map point and condition; nothing saved; takes about 20 s.
// touches: frontend/src/components/RefField.svelte, frontend/src/components/TemplateFields.svelte, frontend/src/components/MessagesTab.svelte, frontend/src/components/CreatureEditor.svelte, frontend/src/lib/world/creatureFields.ts, frontend/src/lib/wow/refNames.ts, internal/vmangos/objecttables.go, internal/vmangos/conditions.go, app_editors.go
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Creature editor"]')
const tab = (name) => [...(root()?.querySelectorAll('nav.tabs button') ?? [])].find((b) => b.textContent.trim().startsWith(name))
const ref = (label, within = root()) => [...(within?.querySelectorAll('.ref') ?? [])].find((r) => r.querySelector('.label')?.textContent === label)
const named = (label, within) => ref(label, within)?.querySelector('.name span:not(.dim)')
const text = (label, within) => ref(label, within)?.querySelector('.name')?.textContent.replace(/\s+/g, ' ').trim() ?? ''

async function open(entry, tabName) {
	ui.creatureEditor = null
	await P.frames(1)
	ui.creatureEditor = { key: null, entry }
	await P.frames(1)
	await P.until(() => tab(tabName), WAIT, `creature ${entry}`)
	tab(tabName).click()
	await P.frames(1)
}

const got = {}
await open(448, 'Creature')
await P.until(() => ['Loot', 'Pickpocket loot', 'Spell list'].every((l) => named(l)), WAIT, "Hogger's lists")
got.loot = text('Loot')
got.pickpocket = text('Pickpocket loot')
got.spells = text('Spell list')
// Find offers its own list before a search, then a search by an item's name lists other loot.
;[...ref('Loot').querySelectorAll('button')].find((b) => b.textContent === 'Find').click()
const hits = () => [...ref('Loot').querySelectorAll('li button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim())
await P.until(() => hits().length > 0, WAIT, 'the own loot offered')
got.offered = hits()[0]
const search = ref('Loot').querySelector('input[type=search]')
search.value = 'Linen Cloth'
search.dispatchEvent(new Event('input', { bubbles: true }))
await P.until(() => hits().length > 1, WAIT, 'loot with Linen Cloth')
got.searched = hits().slice(0, 2)
const other = [...ref('Loot').querySelectorAll('li button')].find((b) => !/\b448\b/.test(b.querySelector('.dim').textContent))
got.otherId = other?.querySelector('.dim').textContent.trim() ?? ''
other?.click()
await P.frames(1)
got.picked = ref('Loot').querySelector('input').value
got.changed = ref('Loot').classList.contains('changed')
// The equipment is on the Looks tab.
tab('Looks').click()
await P.until(() => named('Equipment'), WAIT, "Hogger's equipment")
got.equipment = text('Equipment')
await P.until(() => ref('Equipment').querySelector('.name img'), WAIT, "Hogger's equipment icon")
got.equipmentIcons = ref('Equipment').querySelectorAll('.name img').length

await open(328, 'Creature')
await P.until(() => named('Trainer list') && named('Gossip menu'), WAIT, "Zaldimar's lists")
got.trainer = text('Trainer list')
got.gossip = text('Gossip menu')

await open(1464, 'Creature')
await P.until(() => named('Vendor list'), WAIT, "Helbrek's vendor list")
got.vendor = text('Vendor list')

await open(68, 'Messages')
const option = () => [...(root()?.querySelectorAll('.messages .option') ?? [])].find((o) => ref('Map point', o) && ref('Map point', o).querySelector('input').value !== '0' && ref('Condition', o)?.querySelector('input').value !== '0')
await P.until(() => option() && named('Map point', option()) && named('Condition', option()), WAIT, "the guard's option names")
got.poi = text('Map point', option())
got.condition = text('Condition', option())
got.menu = ref('Menu', option()) ? text('Menu', option()) : ''
ui.creatureEditor = null
await P.frames(1)

const own = "(this creature's own)"
const ok =
	/\d+ items?: /.test(got.loot) &&
	got.loot.includes(own) &&
	got.pickpocket.includes(own) &&
	got.equipment.includes(own) &&
	got.equipmentIcons > 0 &&
	got.spells.includes(own) &&
	/448 · this creature's own/.test(got.offered) &&
	got.searched.some((h) => /used by \d+ creature/.test(h)) &&
	got.otherId !== '' &&
	got.picked === got.otherId.split(' ')[0] &&
	got.changed &&
	/\d+ spells: .*used by \d+ creatures/.test(got.trainer) &&
	got.gossip.length > 5 &&
	/\d+ items?: /.test(got.vendor) &&
	got.poi.length > 2 &&
	!got.poi.startsWith('No ') &&
	got.condition.length > 2 &&
	!got.condition.startsWith('No ') &&
	(got.menu === '' || !got.menu.startsWith('No '))
return { ok, ...got }
