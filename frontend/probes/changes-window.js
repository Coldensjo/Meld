// File › Review Changes… (#959): what Compile and Save Spawns would write, listed before they write it.
// Opens Azeroth 31_50 (1x1), raises one vertex, stands in a moved spawn for the region's spawn edits,
// and opens the Changes window from the File menu: it lists the region's tile (changed in the region)
// among the client files, and the spawn as a change of its position, whose SQL button shows its UPDATE.
// Go there closes the window. Save Spawns' dialog opens the window with Review changes…, and its Back
// returns to that dialog. Then a client map made with New World lists Publish's files (its tiles,
// WDT, WDL and Map.dbc row) and its map_template row. Nothing is written: RegionPending,
// SpawnEditSQL and PublishPending only build.
// touches: frontend/src/components/ChangesDialog.svelte, frontend/src/lib/io/changes.ts, frontend/src/lib/io/changeList.ts, frontend/src/lib/io/publish.ts, frontend/src/components/AppDialogs.svelte, app_region.go, internal/vmangos/changes.go, internal/vmangos/sql.go
const { ui, editor } = await P.state()
const regionIo = await P.app('/src/lib/io/region.ts')
regionIo.openWowRegion(P.e, 'Azeroth', 31, 50, 1)
await P.until(() => (editor.regionMap === 'Azeroth' && P.e.activeRegion()?.x === 31) || null, 120000, 'the Azeroth 31_50 tab')

const raised = Float32Array.from(P.e.terrain.heights)
raised[Math.floor(raised.length / 2)] += 5
P.e.setHeights(raised, 'Probe raise')

const realEdits = P.e.spawnEdits
const spawn = { kind: 'npc', guid: 990001, entry: 3, name: 'Probe guard', x: 100, y: 50, z: 200, orientation: 1, respawnSecs: 300, respawnMaxSecs: 300, equipment: -1, sheathState: 1 }
P.e.spawnEdits = () => [{ spawn: { ...spawn, x: 120 }, original: spawn, created: false, deleted: false }]

// The Changes window: a Modal whose heading starts "Changes" (it names the write once listed, so P.dialog's exact heading can't find it).
const box = () => [...document.querySelectorAll('[data-ui="Modal"] header h2')].find((h) => h.textContent.trim().startsWith('Changes'))?.closest('.dialog') ?? null
const text = () => box()?.textContent ?? ''
const menuItem = async (menu, label) => {
	const title = [...document.querySelectorAll('.menubar .menu > .title')].find((b) => b.textContent.trim() === menu)
	title.click()
	await P.frames(1)
	const item = [...document.querySelectorAll('.menubar .dropdown .item')].find((i) => i.querySelector('.label')?.textContent.trim() === label)
	item?.click()
	await P.frames(1)
	return !!item
}
const button = (label) => [...(box()?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === label)

let region = {}
let back = {}
let publish = {}
try {
	const inMenu = await menuItem('File', 'Review Changes…')
	await P.until(() => text().includes('World database') || null, 60000, 'the Changes window lists the spawn')
	const t = text()
	button('SQL')?.click()
	await P.frames(2)
	const sql = box()?.querySelector('pre')?.textContent ?? ''
	button('Go there')?.click()
	await P.frames(2)
	region = {
		inMenu,
		title: t.includes('Changes: Compile Azeroth 31_50'),
		tile: t.includes('31_50: changed in the region'),
		spawn: t.includes('Change Probe guard (guid 990001): position'),
		sql: sql.includes('UPDATE `creature` SET') && sql.includes('WHERE `guid` = 990001;'),
		closedByGo: ui.dialog === null,
	}

	// From Save Spawns' own dialog, and Back to it.
	ui.dialog = 'saveSpawns'
	await P.frames(2)
	;[...document.querySelectorAll('[data-ui="Modal"] button')].find((b) => b.textContent.trim() === 'Review changes…')?.click()
	await P.until(() => text().includes('World database') || null, 60000, 'the Changes window from Save Spawns')
	const label = button('Back') ? 'Back' : ''
	button('Back')?.click()
	await P.frames(2)
	back = { label, returned: ui.dialog === 'saveSpawns', cleared: ui.changesBack === null }
	ui.dialog = null
} finally {
	P.e.spawnEdits = realEdits
	ui.dialog = null
}

// A map made for the client: Publish's files and its row.
const doc = P.e.newVmangosDocument(1, 'flat', 0, { dir: 'ProbeChanges', mapId: 1998 })
await P.frames(3)
try {
	ui.dialog = 'changes'
	await P.until(() => text().includes('map_template') || null, 60000, 'the Changes window lists the publish')
	const t = text()
	publish = {
		title: t.includes('Changes: Publish ProbeChanges'),
		tiles: t.includes('Tiles') && t.includes('(1 of 1)'),
		wdt: t.includes('ProbeChanges.wdt'),
		dbc: t.includes('Map.dbc: adds the row of map 1998 (ProbeChanges)'),
		row: t.includes('map_template entry 1998'),
	}
} finally {
	ui.dialog = null
	P.e.closeDocument(doc.id)
}

const all = [region, back, publish].flatMap((o) => Object.values(o))
return { ok: all.length > 0 && all.every((v) => v === true || v === 'Back'), region, back, publish }
