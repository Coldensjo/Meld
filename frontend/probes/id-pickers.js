// The id boxes outside the template editors get pickers (#705): the Zones dialog shows Stormwind City's flags as a tick list (Capital ticked) and its liquid type as a select of the client's LiquidType.dbc rows; Map Properties' Ghost goes to is a select of the client's maps (Eastern Kingdoms, 0, named), This map first; the creature editor's Spells tab (Scarlet Commander Mograine, 3976) gives a target's creature entry and aura spell a RefField, its select flags a tick list of the 12 SELECT_FLAG_* bits and Not its target a checkbox, and Revert drops the edits; a creature spawn's Display has Choose…, whose display picker sets the spawn's own display as one undo step; World › Flight Paths in Redridge names Lakeshire's Alliance mount creature (541) beside its number. Nothing is saved; takes about 30 s.
// touches: frontend/src/components/MapPropertiesDialog.svelte, frontend/src/components/SpawnFields.svelte, frontend/src/components/ZonesDialog.svelte, frontend/src/components/SpellsTab.svelte, frontend/src/components/FlightPathsWindow.svelte, frontend/src/lib/wow/creatureSpellNames.ts, frontend/src/components/RefField.svelte
const { ui } = await P.state()
const WAIT = 120_000
const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const out = {}

// Zones: Stormwind City's flags and liquid.
P.e.newDocument(256, 'flat', 0, 'Probe')
ui.dialog = 'zones'
const zoneButton = await P.until(() => [...(P.dialog('Zones')?.querySelectorAll('.list button') ?? [])].find((b) => text(b).startsWith('Stormwind City')), 30000, 'Stormwind City in the zone list')
zoneButton.click()
await P.until(() => P.dialog('Zones').querySelectorAll('#zone-liquid option').length > 1, 30000, 'the liquid types')
const dlg = P.dialog('Zones')
const ticks = [...dlg.querySelectorAll('#zone-flags label')].map((l) => ({ name: text(l), on: l.querySelector('input').checked }))
out.zone = {
	ticks: ticks.length,
	on: ticks.filter((t) => t.on).map((t) => t.name),
	liquids: dlg.querySelectorAll('#zone-liquid option').length,
	water: [...dlg.querySelectorAll('#zone-liquid option')].some((o) => /^Water \(1\)$/.test(text(o))),
	numberBoxes: dlg.querySelectorAll('input#zone-flags, input#zone-liquid').length,
}
ui.dialog = null
await P.frames(1)

// Map Properties: a map made for the client sends its ghost to a map picked from the client's.
P.e.doc.meta.vmangos = { dir: 'ProbeMap', mapId: 36, info: { type: 1, name: '', areaId: 0, loadingScreen: 0, maxPlayers: 0, ghostMap: 0, ghostX: 0, ghostY: 0 } }
ui.dialog = 'mapProps'
const ghost = await P.until(
	() => {
		const g = document.querySelector('select[aria-label="Ghost entrance map"]')
		return g && g.options.length > 5 ? g : null
	},
	30000,
	"the client's maps for the ghost",
)
out.ghost = { value: ghost.value, shown: text(ghost.selectedOptions[0]), first: text(ghost.options[0]), self: [...ghost.options].some((o) => o.value === '36') }
ui.dialog = null
await P.frames(1)

// The Spells tab: each target's parameters.
const root = () => document.querySelector('[aria-label="Creature editor"]')
const tab = () => root()?.querySelector('.spells')
const button = (el, t) => [...(el?.querySelectorAll('button') ?? [])].find((b) => text(b).startsWith(t))
ui.creatureEditor = { key: null, entry: 3976 }
await P.frames(1)
await P.until(() => button(root()?.querySelector('nav.tabs'), 'Spells'), WAIT, 'the editor')
button(root().querySelector('nav.tabs'), 'Spells').click()
await P.until(() => tab()?.querySelector('.list > li select'), WAIT, 'the list')
const first = () => tab().querySelector('.list > li')
const target = async (id) => {
	const sel = first().querySelector('.grid select')
	sel.value = String(id)
	sel.dispatchEvent(new Event('change', { bubbles: true }))
	await P.frames(2)
}
const startTarget = first().querySelector('.grid select').value
await target(10)
out.creature = [...first().querySelectorAll('.ref .label')].map(text)
await target(19)
out.aura = [...first().querySelectorAll('.ref .label')].map(text)
await target(2)
out.flags = first().querySelectorAll('.select-flags input[type=checkbox]').length
await target(16)
out.bool = [...first().querySelectorAll('label.check')].map(text)
out.dirty = text(button(tab().querySelector('.head'), 'Save'))
button(tab().querySelector('.head'), 'Revert').click()
await P.until(() => first()?.querySelector('.grid select')?.value === startTarget && !first().querySelector('.ref, .select-flags'), WAIT, 'the revert')
ui.creatureEditor = null
await P.frames(1)

// A spawn's own display: Choose… opens the creature display picker, a tile picked is one undo step.
const se = await P.app('/src/lib/world/spawnEdits.ts')
const { spawnKey } = await P.app('/src/lib/world/SpawnLayer.ts')
const look = { model: '', look: '', anim: 0, displayScale: 1 }
const thug = { entry: 38, name: 'Defias Thug', subname: '', levelMin: 5, levelMax: 5, faction: 14, npcFlags: 0, rank: 0, type: 7, display: 0, scale: 1, equipment: 0, model: '', look: '', displayScale: 1 }
// A guid far above the database's, so nothing here names a real spawn.
const spawn = se.newCreatureSpawn(thug, 9_000_201, 100, 0, 100, 0, look)
const layer = P.e.activeDocument().spawnLayer
layer.set([spawn])
se.syncSpawnUi(layer, true)
const key = spawnKey(spawn)
se.selectSpawn(spawn)
ui.creatureEditor = { key, entry: 38 }
await P.until(() => button(root()?.querySelector('nav.tabs'), 'This spawn'), WAIT, 'the spawn tab')
button(root().querySelector('nav.tabs'), 'This spawn').click()
const choose = await P.until(() => button(root().querySelector('.spawn-fields'), 'Choose'), WAIT, 'Choose…')
choose.click()
const tile = await P.until(() => root().querySelector('.spawn-fields [aria-label="Creature displays"] button'), WAIT, 'the display tiles')
const before = layer.get(key).display
tile.click()
await P.until(() => layer.get(key).display !== before, 10000, 'the picked display')
out.display = { before, after: layer.get(key).display, step: P.e.history.peek()?.label ?? '', box: root().querySelector('.spawn-fields .display input').value }
P.e.undo()
out.display.undone = layer.get(key).display
ui.creatureEditor = null
await P.frames(1)

// Flight paths: Lakeshire's mount creature, named.
await P.scene({
	v: 1,
	map: { region: { mapName: 'Azeroth', x: 36, y: 49, size: 1 } },
	view: { target: [0, 0, 0], yaw: 0, pitch: 0.3, distance: 30, hour: 13 },
	prefs: { cameraFollowGround: false },
	tool: 'select',
	selectedIds: [],
	selected: null,
	area: null,
	viewport: [1000, 600],
})
const L = P.e.taxiLayer
ui.flightPaths = true
try {
	await P.until(() => L.stops.find((s) => s.id === 5) ?? null, 60_000, "Lakeshire's stop")
	const win = () => document.querySelector('aside[aria-label="Flight paths"]')
	const listed = await P.until(() => [...(win()?.querySelectorAll('ul[aria-label="Stops"] button') ?? [])].find((b) => text(b.querySelector('.id')) === '5'), WAIT, 'Lakeshire in the list')
	listed.click()
	await P.until(() => win()?.querySelector('#fp-ally'), 5000, 'a stop picked').catch(() => null)
	out.mount = { picked: !!win()?.querySelector('#fp-ally') }
	if (out.mount.picked) {
		const ref = await P.until(
			() => {
				const r = win().querySelector('#fp-ally')?.closest('.row')?.nextElementSibling
				return r?.classList.contains('ref') && !text(r.querySelector('.name')).startsWith('…') ? r : null
			},
			WAIT,
			'the mount name',
		)
		out.mount.value = ref.querySelector('input').value
		out.mount.name = text(ref.querySelector('.name'))
	}
} finally {
	ui.flightPaths = false
}

out.ok =
	out.zone.ticks === 10 &&
	out.zone.on.includes('Capital') &&
	out.zone.water &&
	out.zone.numberBoxes === 0 &&
	out.creature.includes('Creature entry') &&
	out.aura.includes('Aura spell') &&
	out.flags === 12 &&
	out.bool.includes('Not its target') &&
	out.dirty.includes('Save spells') &&
	out.display.after > 0 &&
	out.display.box === String(out.display.after) &&
	out.display.step.startsWith('Display') &&
	out.display.undone === out.display.before &&
	out.ghost.value === '0' &&
	/\(0\)$/.test(out.ghost.shown) &&
	out.ghost.first === 'This map' &&
	!out.ghost.self &&
	out.mount.picked &&
	out.mount.value === '541' &&
	out.mount.name.length > 0 &&
	!out.mount.name.startsWith('No ')
return out
