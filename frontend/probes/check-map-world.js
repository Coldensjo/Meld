// File › Check Map's World data group (#951) against the real world database: the Pissed Vendor (1857, a vendor with no npc_vendor rows and no vendor list) and a Food Crate (3701, a chest whose loot 2597 has no gameobject_loot_template rows) are errors under World data, Innkeeper Farley (295, every id set and found) has none of the real report, the real report reads the rows behind the ids (#975: its faults list, empty here) and a fault put into it behind Farley's gossip menu is an error under Rows behind the ids, and the vendor's Edit opens the creature editor on its Vendor list field; nothing saved.
// touches: frontend/src/lib/check/worldData.ts, internal/vmangos/worlddatarows.go, frontend/src/lib/check/run.ts, frontend/src/components/CheckMapWindow.svelte, frontend/src/lib/ui/focusField.ts, frontend/src/components/TemplateFields.svelte, internal/vmangos/worlddata.go, app_spawns.go
const e = P.e
const { ui } = await P.state()
const se = await P.app('/src/lib/world/spawnEdits.ts')
const { loadObjectTemplates } = await P.app('/src/components/SpawnBrowser.svelte')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const templates = await loadObjectTemplates()
const crate = templates.find((t) => t.entry === 3701)
if (!crate) return { ok: false, why: 'the world database lacks object entry 3701' }
const crateSpawn = se.newObjectSpawn(crate, 999_999_951, 100, 0, 100, 0)
// A creature spawn needs no look here: the object spawn's fields, as a creature (as spawn-scripts does).
const vendor = { ...se.newObjectSpawn(crate, 999_999_952, 120, 0, 100, 0), kind: 'monster', entry: 1857, name: 'Pissed Vendor', waypoints: [] }
const farVendor = { ...vendor, guid: 999_999_953, x: 3000, z: 3000 }
const farley = { ...vendor, guid: 999_999_954, entry: 295, name: 'Innkeeper Farley', x: 140 }
const layer = e.activeDocument().spawnLayer
layer.set([crateSpawn, vendor, farVendor, farley])
se.syncSpawnUi(layer, true)
e.controller.target.set(110, 0, 100)

// The real report, with a broken option put behind Farley's gossip menu (the vanilla database has none).
const App = window.go.main.App
const real = App.CheckWorldData
let realFaults = null
let farleyMenu = 0
App.CheckWorldData = async (q) => {
	const r = await real(q)
	realFaults = [...r.faults]
	farleyMenu = r.creatures.find((c) => c.entry === 295)?.values?.gossip_menu_id ?? 0
	if (farleyMenu) r.faults.push({ kind: 'gossip', root: farleyMenu, what: 'option script', in: farleyMenu, option: 7, text: 0, id: 99_999_975 })
	return r
}
let findings
try {
	findings = (await e.checkMap()).findings
} finally {
	App.CheckWorldData = real
}
const world = findings.filter((f) => f.group === 'world')
const vendorRole = world.find((f) => f.check === 'Roles without rows' && f.message.includes('creature 1857'))
const crateLoot = world.find((f) => f.check === 'Ids without a row' && f.message.includes('object 3701') && f.message.includes('2597'))
const farleys = world.filter((f) => f.message.includes('creature 295') && f.check !== 'Rows behind the ids')
const behind = world.find((f) => f.check === 'Rows behind the ids' && f.message.includes('creature 295') && f.message.includes('99999975'))

// The window: World data comes last, and the vendor's Edit opens its editor on vendor_id.
ui.checkMap = true
await P.until(() => [...document.querySelectorAll('aside.check li')].some((li) => li.textContent.includes('creature 1857')), 60_000, 'the window to list the vendor')
const heading = [...document.querySelectorAll('aside.check h3')].map((h) => h.textContent.trim())
const li = [...document.querySelectorAll('aside.check li')].find((l) => l.textContent.includes('creature 1857'))
;[...li.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit')?.click()
await P.until(() => document.querySelector('[data-editor="creature"] [data-col="vendor_id"] .field-flash'), 30_000, 'the editor on the Vendor list field')
const editorOn = { ...ui.creatureEditor }
ui.creatureEditor = null
ui.checkMap = false
await P.frames(2)
return {
	world: world.map((f) => `${f.severity} ${f.check}: ${f.message}`),
	heading,
	editorOn,
	realFaults,
	ok:
		Array.isArray(realFaults) &&
		realFaults.length === 0 &&
		farleyMenu > 0 &&
		behind?.severity === 'error' &&
		behind.target.field === 'gossip_menu_id' &&
		vendorRole?.severity === 'error' &&
		vendorRole.target.kind === 'template' &&
		vendorRole.x === 120 &&
		crateLoot?.severity === 'error' &&
		/opens empty/.test(crateLoot.message) &&
		farleys.length === 0 &&
		heading.includes('World data') &&
		editorOn.entry === 1857 &&
		editorOn.field === 'vendor_id',
}
