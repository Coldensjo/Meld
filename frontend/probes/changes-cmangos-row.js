// The Changes window of a new world while Preferences › Compile and export › Spawn SQL for is CMaNGOS
// classic (#1085): a dungeon made for the client lists its map_template row under World database, and
// its CMaNGOS instance_template row (the SQL Compile to CMaNGOS Server leaves in meld-sql) under a
// heading of its own, with the dungeon's player limit and reset delay; Copy all SQL leaves that row out,
// since it is for another database. With the core back on VMaNGOS the row is gone. Nothing is written:
// PublishPending only builds, and the pref is put back.
// touches: frontend/src/components/ChangesDialog.svelte, frontend/src/lib/io/changes.ts, app_region.go, internal/vmangos/cmangospublish.go, internal/vmangos/changes.go
const { ui, prefs } = await P.state()
const out = {}
const realCore = prefs.exportCore
const doc = P.e.newVmangosDocument(1, 'flat', 0, { dir: 'ProbeCmRow', mapId: 1996, info: { type: 1, name: 'Probe Halls', areaId: 0, loadingScreen: 0, maxPlayers: 5, resetDelay: 3, ghostMap: -1, ghostX: 0, ghostY: 0 } })
await P.frames(3)
const box = () => [...document.querySelectorAll('[data-ui="Modal"] header h2')].find((h) => h.textContent.trim().startsWith('Changes'))?.closest('.dialog') ?? null
const clip = navigator.clipboard
let copied = ''
try {
	Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => void (copied = t), readText: async () => copied } })
	prefs.exportCore = 'cmangos-classic'
	ui.dialog = 'changes'
	await P.until(() => box()?.textContent.includes('instance_template') || null, 60000, 'the Changes window lists the CMaNGOS row')
	const heads = [...box().querySelectorAll('h3')].map((h) => h.textContent.trim())
	out.heads = heads
	out.heading = heads.some((h) => h.startsWith('CMaNGOS classic world database')) && heads.some((h) => h.startsWith('World database'))
	const lists = [...box().querySelectorAll('h3')].map((h) => [h.textContent.trim(), h.nextElementSibling?.textContent ?? ''])
	const cm = lists.find(([h]) => h.startsWith('CMaNGOS'))?.[1] ?? ''
	const vm = lists.find(([h]) => h.startsWith('World database'))?.[1] ?? ''
	out.placed = cm.includes('instance_template map 1996') && !cm.includes('map_template') && vm.includes('map_template') && !vm.includes('instance_template')
	out.file = cm.includes('ProbeCmRow_instance_template.sql')
	const cmList = [...box().querySelectorAll('h3')].find((h) => h.textContent.trim().startsWith('CMaNGOS'))?.nextElementSibling
	;[...(cmList?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === 'SQL')?.click()
	await P.frames(2)
	const sql = cmList?.querySelector('pre')?.textContent ?? ''
	out.sql = sql.includes('INSERT INTO `instance_template`') && sql.includes('VALUES (1996, 0, 0, 0, 5, 3, 0, 0, 0,')
	;[...box().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Copy all SQL')?.click()
	await P.until(() => copied || null, 10000, 'Copy all SQL')
	out.copyAll = copied.includes('map_template') && !copied.includes('instance_template')
	ui.dialog = null
	await P.frames(1)

	prefs.exportCore = 'vmangos'
	ui.dialog = 'changes'
	await P.until(() => box()?.textContent.includes('map_template') || null, 60000, 'the Changes window for VMaNGOS')
	out.vmangosOnly = !box().textContent.includes('instance_template')
} finally {
	ui.dialog = null
	prefs.exportCore = realCore
	if (clip) Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clip })
	P.e.closeDocument(doc.id)
}
out.ok = out.heading && out.placed && out.file && out.sql && out.copyAll && out.vmangosOnly
return out
