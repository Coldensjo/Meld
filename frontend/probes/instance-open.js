// Opening an instance from the Start dialog's "Part of Azeroth" (#222, #271): with no project open it asks for one (#48); the Deadmines (an instance with ADT tiles) gets a block picked on its tiles and Open enabled, Molten Core (one WMO, no tiles) says it is a single building with Open enabled, opening 2x2 tiles of the Deadmines reads its ground into a tab (it replaces the page's untouched start map), and opening the Stockade (a single building) shows the building as the tab's one model, drawn from outside, with the ground hidden, the camera on it and its creatures inside its box.
// touches: frontend/src/components/NewMapDialog.svelte, frontend/src/components/MapPicker.svelte, frontend/src/lib/io/region.ts, internal/vmangos/region.go, internal/vmangos/mapentries.go
const { ui, editor } = await P.state()
// Without a project the page asks for one (#48, the owner's limit: editing the client's maps needs a
// project folder and a client folder); the probe then lends the page a project of its own in the
// state only, so the owner's config keeps theirs.
// The page's startup read of the config's projects (App.svelte's onMount, refreshProjects) answers after the page is up and would set ui.project back, so wait for it first: an open project is always in the recent list. With no project in the config the wait times out and the state is already what the probe wants.
await P.until(() => ui.recentProjects.length > 0 || null, 5000, 'the startup read of the projects').catch(() => null)
const hadProject = ui.project
ui.project = null
ui.newMapMode = 'open'
ui.showNewDialog = true
const asksProject = !!(await P.until(() => [...document.querySelectorAll('.needproject button')].find((b) => b.textContent.includes('Choose a Project')) || null, 10000, 'the ask for a project'))
ui.project = hadProject ?? { name: 'probe', path: '', clientPath: '' }
const openButton = () => [...document.querySelectorAll('.dialog footer button')].find((b) => b.textContent.trim() === 'Open')
const pick = async (dir) => {
	const row = await P.until(() => [...document.querySelectorAll('.mapname')].find((b) => (b.getAttribute('title') || '').startsWith(`${dir} (`)), 30000, `${dir} in the map list`)
	row.click()
}
await pick('DeadminesInstance')
const deadmines = await P.until(
	() => {
		const t = document.querySelector('.wrap .dim')?.textContent ?? ''
		return /^\s*Tiles/.test(t) && !openButton().disabled ? t.trim().replace(/\s+/g, ' ') : null
	},
	30000,
	"the Deadmines' block picked and Open enabled",
)
const img = await P.until(
	() => {
		const i = document.querySelector('.wrap img')
		return i && i.complete && i.naturalWidth ? i : null
	},
	60000,
	"the Deadmines' overview",
)
await pick('MoltenCore')
const moltenNote = await P.until(
	() => {
		const n = [...document.querySelectorAll('.wrap .note')].map((x) => x.textContent.trim()).find((t) => t.includes('no terrain tiles'))
		return n ?? null
	},
	30000,
	"Molten Core's no-tiles note",
)
const moltenEnabled = !openButton().disabled
await pick('DeadminesInstance')
await P.until(() => !openButton().disabled || null, 30000, 'Open enabled again')
// Escape closes the dialog (#582), as it does every Modal.
document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
const escapeCloses = await P.until(() => !ui.showNewDialog || null, 3000, 'Escape closing the Start dialog')
ui.showNewDialog = true
// The picked block is 6x6 tiles, which SwiftShader takes minutes to draw; open 2x2 of it the way Open does.
ui.showNewDialog = false
const { openWowRegion } = await P.app('/src/lib/io/region.ts')
openWowRegion(P.e, 'DeadminesInstance', 32, 32, 2)
await P.until(() => editor.regionMap === 'DeadminesInstance' || null, 60000, "the Deadmines' tab")
const t = P.e.terrain
let lo = Infinity,
	hi = -Infinity
for (const h of t.heights) {
	lo = Math.min(lo, h)
	hi = Math.max(hi, h)
}
const relief = +(hi - lo).toFixed(1)
// The Stockade, not Molten Core: a small building, which SwiftShader draws in seconds.
const { openWowBuilding } = await P.app('/src/lib/io/region.ts')
openWowBuilding(P.e, 'StormwindJail')
await P.until(() => editor.regionMap === 'StormwindJail' || null, 60000, "the Stockade's tab")
const region = P.e.activeRegion()
const objects = [...P.e.objects.objects.values()].map((o) => o.type)
const target = P.e.controller.target
const stockade = {
	block: `${region.x},${region.y} ${region.size}`,
	wmoOnly: !!region.wmoOnly,
	objects,
	groundShown: P.e.terrain.group.visible,
	// The building's middle is about 533 yards in (tile 32's corner) and 95 north of it.
	camera: [Math.round(target.x), Math.round(target.z)],
}
// The building draws from outside, though a dungeon's groups are all interior (no exterior to
// flood from): the view differs from the same view with the objects hidden.
await P.settle()
const withBuilding = await P.shot()
P.e.objects.group.visible = false
const without = await P.shot()
P.e.objects.group.visible = true
stockade.drawn = +P.diff(withBuilding, without).off.toFixed(3)
// Its creatures, when the world database runs: they stand inside the building's box (the WDT's
// building sits at the world's origin, the map's middle; wmoonly.go).
await P.until(() => editor.spawns.length > 0 || editor.spawnsError || null, 30000, "the Stockade's spawns").catch(() => null)
const inside = editor.spawns.filter((s) => s.x > 370 && s.x < 690 && s.z > 330 && s.z < 545).length
stockade.spawns = `${inside} of ${editor.spawns.length} inside${editor.spawnsError ? ` (${editor.spawnsError})` : ''}`
ui.project = hadProject
const out = { asksProject, escapeCloses, deadmines, overview: img.naturalWidth, moltenNote: moltenNote.slice(0, 60), moltenEnabled, relief, stockade }
out.ok =
	escapeCloses &&
	asksProject &&
	out.overview > 0 &&
	moltenEnabled &&
	relief > 1 &&
	stockade.wmoOnly &&
	objects.length === 1 &&
	/stormwindjail\.wmo$/i.test(objects[0]) &&
	!stockade.groundShown &&
	stockade.drawn > 0.02 &&
	inside === editor.spawns.length &&
	Math.abs(target.x - 533) < 400 &&
	Math.abs(target.z - 440) < 400
return out
