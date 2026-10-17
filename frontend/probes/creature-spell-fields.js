// The creature editor's Creature tab names its spell columns (#255): Defias Night Runner (215) has aura 6408, shown with its icon and name under the Auras text; Prismatic Exile (2887) has spawn spell 10389, named beside the number. Read-only; takes about 30 s.
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 300_000
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
ui.creatureEditor = null
await P.frames(1)
const ok = aura.value.includes('6408') && aura.text.includes('6408') && aura.text.length > 6 && spawn.value === '10389' && spawn.text.length > 0 && !spawn.text.startsWith('No ')
return { ok, aura, spawn }
