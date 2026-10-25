// The item editor's pickers for its id columns (#701): Armor of the Fang (6473) names its item set (162) and its disenchant loot by its items (Strange Dust…); the Notched Shortsword (727) names its random enchantment by its suffixes ("of the …"); the Ornate Bronze Lockbox (4632) its lock by what opens it; A Letter to Grelin Whitebeard (2188) its page by its first line and its page material; the Gordok Inner Door Key (18268) its map; Tough Jerky (117) its cooldown category by its spells; Marshal's Satin Sandals (17607) its honor rank in the select; Item set's Find lists the sets whole and a pick puts its ID in, marked changed; nothing saved; takes about 15 s.
// touches: frontend/src/components/RefField.svelte, frontend/src/components/TemplateFields.svelte, frontend/src/lib/world/itemFields.ts, frontend/src/lib/wow/refNames.ts, internal/vmangos/itemtables.go, internal/vmangos/objecttables.go, app_editors.go
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Item editor"]')
const tab = (name) => [...(root()?.querySelectorAll('nav.tabs button') ?? [])].find((b) => b.textContent.trim().startsWith(name))
const ref = (label) => [...(root()?.querySelectorAll('.ref') ?? [])].find((r) => r.querySelector('.label')?.textContent === label)
const named = (label) => ref(label)?.querySelector('.name span:not(.dim)')
const text = (label) => ref(label)?.querySelector('.name')?.textContent.replace(/\s+/g, ' ').trim() ?? ''

async function open(entry, tabName) {
	ui.itemEditor = null
	await P.frames(1)
	ui.itemEditor = { entry }
	await P.until(() => tab(tabName) && [...root().querySelectorAll('span.dim')].some((d) => d.textContent.startsWith(`item ${entry} `)), WAIT, `item ${entry}`)
	tab(tabName).click()
	await P.frames(1)
}

const got = {}
await open(6473, 'More')
await P.until(() => named('Item set') && named('Disenchants into'), WAIT, 'the set and disenchant names')
got.set = text('Item set')
got.disenchant = text('Disenchants into')
// Item set's Find lists the sets whole; a pick puts its ID in.
;[...ref('Item set').querySelectorAll('button')].find((b) => b.textContent === 'Find').click()
await P.until(() => ref('Item set').querySelectorAll('li button').length > 20, WAIT, 'the set list')
const setHit = [...ref('Item set').querySelectorAll('li button')].find((b) => !b.textContent.includes('162'))
got.setHit = setHit?.textContent.replace(/\s+/g, ' ').trim() ?? ''
setHit?.click()
await P.frames(1)
got.setPicked = ref('Item set').querySelector('input').value
got.setChanged = ref('Item set').classList.contains('changed')

await open(727, 'More')
await P.until(() => named('Random enchantment'), WAIT, 'the enchantment name')
got.enchantment = text('Random enchantment')

await open(4632, 'More')
await P.until(() => named('Lock'), WAIT, 'the lock name')
got.lock = text('Lock')

await open(2188, 'More')
await P.until(() => named('Page text') && named('Page material'), WAIT, 'the page names')
got.page = text('Page text')
got.material = text('Page material')

await open(18268, 'Requirements')
await P.until(() => named('Only on map'), WAIT, 'the map name')
got.map = text('Only on map')

await open(117, 'Effects')
await P.until(() => named('Cooldown category'), WAIT, 'the category name')
got.category = text('Cooldown category')

await open(17607, 'Requirements')
const rank = [...root().querySelectorAll('label')].find((l) => (l.firstChild?.textContent ?? '').trim().startsWith('Honor rank'))?.querySelector('select')
got.rank = rank ? rank.selectedOptions[0]?.textContent : ''
ui.itemEditor = null
await P.frames(1)

const ok =
	got.set.includes('Embrace of the Viper') &&
	/Strange Dust/.test(got.disenchant) &&
	got.setHit !== '' &&
	got.setPicked !== '162' &&
	got.setHit.includes(got.setPicked) &&
	got.setChanged &&
	/\bof /.test(got.enchantment) &&
	got.lock.length > 3 &&
	!got.lock.startsWith('No ') &&
	got.page.length > 3 &&
	!got.page.startsWith('<') &&
	got.material.length > 2 &&
	got.map.includes('Dire Maul') &&
	got.category.length > 3 &&
	got.rank === 'Marshal / General'
return { ok, ...got }
