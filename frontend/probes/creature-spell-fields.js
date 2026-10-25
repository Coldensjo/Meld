// The creature editor's Creature tab names its spell columns (#255): Defias Night Runner (215) has aura 6408, shown with its icon and name under the Auras text; Prismatic Exile (2887) has spawn spell 10389, named beside the number; its Find picks Fire Blast from Mage: Fire, and the aura field's Find adds a spell (#367); nothing saved; takes about 30 s.
// touches: frontend/src/components/CreatureEditor.svelte, frontend/src/components/TemplateFields.svelte, frontend/src/components/AuraField.svelte, frontend/src/lib/world/creatureFields.ts
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Creature editor"]')
const tabButton = () => [...(root()?.querySelectorAll('nav.tabs button') ?? [])].find((b) => b.textContent.trim() === 'Creature')
async function open(entry) {
	ui.creatureEditor = { key: null, entry }
	await P.frames(1)
	await P.until(() => tabButton(), WAIT, 'the editor')
	tabButton().click()
	await P.frames(1)
}
await open(215)
await P.until(() => root().querySelector('.aura li .dim:not(:empty)') && !root().querySelector('.aura li')?.textContent.includes('…'), WAIT, 'the aura names')
const li = root().querySelector('.aura li')
const aura = { text: li.textContent.replace(/\s+/g, ' ').trim(), value: root().querySelector('.aura input').value }
await P.until(() => li.querySelector('img'), WAIT, 'the aura icon')
await open(2887)
const spawnRef = () => [...root().querySelectorAll('.ref')].find((r) => r.querySelector('.label')?.textContent === 'Spawn spell')
await P.until(() => spawnRef()?.querySelector('.name span:not(.dim)'), WAIT, 'the spawn spell')
const spawn = { value: spawnRef().querySelector('input').value, text: spawnRef().querySelector('.name').textContent.replace(/\s+/g, ' ').trim() }
// Find browses the client's spells by category (#367): Mage: Fire's Fire Blast picked puts 2136 in.
;[...spawnRef().querySelectorAll('button')].find((b) => b.textContent === 'Find').click()
await P.until(() => spawnRef().querySelectorAll('select.category optgroup').length > 0, WAIT, 'the categories')
const cat = spawnRef().querySelector('select.category')
cat.value = 'skill:8'
cat.dispatchEvent(new Event('change', { bubbles: true }))
const blast = () => [...spawnRef().querySelectorAll('.results button')].find((b) => /^Fire Blast\b.*\b2136\b/.test(b.textContent.replace(/\s+/g, ' ').trim()))
await P.until(blast, WAIT, 'Fire Blast')
blast().click()
await P.frames(1)
const picked = spawnRef().querySelector('input').value
// The aura field's Find adds the spell clicked to the list.
const auraRef = () => root().querySelector('.aura')
;[...auraRef().querySelectorAll('button')].find((b) => b.textContent === 'Find').click()
const search = () => auraRef().querySelector('input[type=search]')
await P.until(search, WAIT, 'the aura picker')
search().value = '2136'
search().dispatchEvent(new Event('input', { bubbles: true }))
const auraHit = () => [...auraRef().querySelectorAll('.results button')].find((b) => /\b2136\b/.test(b.textContent))
await P.until(auraHit, WAIT, 'the aura search')
auraHit().click()
await P.frames(1)
const auras = auraRef().querySelector('input[type=text]').value
ui.creatureEditor = null
await P.frames(1)
const ok = aura.value.includes('6408') && aura.text.includes('6408') && aura.text.length > 6 && spawn.value === '10389' && spawn.text.length > 0 && !spawn.text.startsWith('No ') && picked === '2136' && /\b2136$/.test(auras.trim())
return { ok, aura, spawn, picked, auras }
