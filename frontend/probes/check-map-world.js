// File › Check Map's World data group (#951) against the real world database: the Pissed Vendor (1857, a vendor with no npc_vendor rows and no vendor list) and a Food Crate (3701, a chest whose loot 2597 has no gameobject_loot_template rows) are errors under World data, Innkeeper Farley (295, every id set and found) has none, and the vendor's Edit opens the creature editor on its Vendor list field; nothing saved.
// touches: frontend/src/lib/check/worldData.ts, frontend/src/lib/check/run.ts, frontend/src/components/CheckMapWindow.svelte, frontend/src/lib/ui/focusField.ts, frontend/src/components/TemplateFields.svelte, internal/vmangos/worlddata.go, app_spawns.go
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

const { findings } = await e.checkMap()
const world = findings.filter((f) => f.group === 'world')
const vendorRole = world.find((f) => f.check === 'Roles without rows' && f.message.includes('creature 1857'))
const crateLoot = world.find((f) => f.check === 'Ids without a row' && f.message.includes('object 3701') && f.message.includes('2597'))
const farleys = world.filter((f) => f.message.includes('creature 295'))

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
	ok:
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
