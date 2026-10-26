// The editors' This spawn tab lists the scripts the world database attaches to a spawn (#137): the lever of Ashcrombe's cell in Shadowfang Keep (18901, guid 34006) runs a gameobject_scripts script when used, the Altar of the Tides (2576) event 364, and the creature 6175 at guid 108 a script at path points 1, 4, 7, 12 and 16; Innkeeper Farley (295) has a Gossip script (342) and a quest giver (197) a Quest start script (54), whose commands open under the row (#736); nothing saved.
// touches: frontend/src/components/ScriptFields.svelte, frontend/src/components/SpawnFields.svelte, internal/vmangos/scripts.go, app_spawns.go
const e = P.e
const { ui } = await P.state()
const se = await P.app('/src/lib/world/spawnEdits.ts')
const { spawnKey } = await P.app('/src/lib/world/SpawnLayer.ts')
const { loadObjectTemplates } = await P.app('/src/components/SpawnBrowser.svelte')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const templates = await loadObjectTemplates()
const door = templates.find((t) => t.entry === 18901)
const altar = templates.find((t) => t.entry === 2576)
if (!door || !altar) return { ok: false, why: 'the world database lacks object entries 18901 and 2576' }
const doorSpawn = se.newObjectSpawn(door, 34006, 100, 50, 100, 0)
const altarSpawn = se.newObjectSpawn(altar, 999_999_901, 110, 50, 100, 0)
// A creature spawn needs no look for the spawn tab: the object spawn's fields, as a creature.
const walker = { ...se.newObjectSpawn(door, 108, 120, 50, 100, 0), kind: 'monster', entry: 6175, name: 'Probe walker', waypoints: [] }
const layer = e.activeDocument().spawnLayer
const innkeeper = { ...walker, guid: 109, entry: 295, name: 'Probe innkeeper' }
const giver = { ...walker, guid: 110, entry: 197, name: 'Probe giver' }
layer.set([doorSpawn, altarSpawn, walker, innkeeper, giver])
se.syncSpawnUi(layer, true)

/** The rows of the Scripts list of the open editor, as text. */
const rows = (label) => [...(document.querySelector(`[aria-label="${label}"]`)?.querySelectorAll('[data-testid="spawn-scripts"] li') ?? [])].map((li) => li.textContent.replace(/\s+/g, ' ').trim())
const settled = (label) => {
	const box = document.querySelector(`[aria-label="${label}"] [data-testid="spawn-scripts"]`)
	return box && !box.textContent.includes('Reading')
}
async function scriptsOf(spawn, editor, label) {
	se.selectSpawn(spawn)
	ui[editor] = { key: spawnKey(spawn), entry: spawn.entry }
	await P.until(() => settled(label), 30_000, `the scripts of ${spawn.name}`)
	const got = rows(label)
	ui[editor] = null
	await P.frames(2)
	return got
}
const doorRows = await scriptsOf(doorSpawn, 'objectEditor', 'Game object editor')
const altarRows = await scriptsOf(altarSpawn, 'objectEditor', 'Game object editor')
const walkerRows = await scriptsOf(walker, 'creatureEditor', 'Creature editor')
const innRows = await scriptsOf(innkeeper, 'creatureEditor', 'Creature editor')
// Open the quest giver's Quest start script: its three commands list under the row.
se.selectSpawn(giver)
ui.creatureEditor = { key: spawnKey(giver), entry: giver.entry }
await P.until(() => settled('Creature editor'), 30_000, 'the quest giver scripts')
const startBtn = [...document.querySelectorAll('[aria-label="Creature editor"] [data-testid="spawn-scripts"] button.open')].find((b) => b.textContent.includes('Quest start'))
startBtn?.click()
await P.until(() => document.querySelectorAll('[aria-label="Creature editor"] [data-testid="script-commands"] li').length > 0, 30_000, 'the commands')
const commandRows = [...document.querySelectorAll('[aria-label="Creature editor"] [data-testid="script-commands"] li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim())
ui.creatureEditor = null
await P.frames(2)
return {
	innRows,
	commandRows,
	ok:
		doorRows.some((t) => t.includes('On use') && t.includes('1 command')) &&
		altarRows.some((t) => t.includes('Event 364') && t.includes('Gazban')) &&
		walkerRows.filter((t) => t.includes('Path point')).length === 5 &&
		innRows.some((t) => t.includes('Gossip') && t.includes('script 342')) &&
		commandRows.length === 3 &&
		commandRows[0].includes('Cast Spell'),
	doorRows,
	altarRows,
	walkerRows,
}
