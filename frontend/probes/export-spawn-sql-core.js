// File › Export Spawn SQL… writes for the core of Preferences › Compile and export › Spawn SQL for (#894).
// Opens Azeroth 31_50 (1x1), stands in the region's spawn edits (one creature added, with a changed
// pose and display), the save dialog and the file write, and runs the export through the real
// SpawnEditSQL binding twice: for CMaNGOS classic (the pref, which the export passes to Go) and for
// VMaNGOS. Checks: the CMaNGOS file has CMaNGOS's columns (spawndist, MovementType, emote) and none of
// VMaNGOS's, names map 0 from the client's Map.dbc, and lists the display it left out; the VMaNGOS file
// is VMaNGOS's; the status names the core. Nothing is written to disk or the database, and the pref is
// put back.
// touches: frontend/src/lib/io/compile.ts, app_spawns.go, internal/vmangos/sql.go, internal/vmangos/cmangos.go, internal/vmangos/core.go, internal/vmangos/spawnedit.go
const { ui, editor, prefs } = await P.state()
const regionIo = await P.app('/src/lib/io/region.ts')
const compileIo = await P.app('/src/lib/io/compile.ts')
regionIo.openWowRegion(P.e, 'Azeroth', 31, 50, 1)
await P.until(() => (editor.regionMap === 'Azeroth' && P.e.activeRegion()?.x === 31) || null, 120000, 'the Azeroth 31_50 tab')

const App = window.go.main.App
const real = { SaveSQLDialog: App.SaveSQLDialog, WriteTextFile: App.WriteTextFile }
const realEdits = P.e.spawnEdits
const realCore = prefs.exportCore
const spawn = { kind: 'npc', guid: 990001, entry: 3, name: 'Probe guard', x: 100, y: 50, z: 200, orientation: 1, respawnSecs: 300, respawnMaxSecs: 300, equipment: -1, sheathState: 1 }
const posed = { ...spawn, standState: 1, emoteState: 10, display: 3167 }
P.e.spawnEdits = () => [{ spawn: posed, original: spawn, created: true, deleted: false }]
let file = null
let named = ''
App.SaveSQLDialog = async (name) => {
	named = name
	return 'C:\\probe\\spawns.sql'
}
App.WriteTextFile = async (_path, text) => {
	file = text
}
const run = async (core) => {
	file = null
	prefs.exportCore = core
	await compileIo.exportSpawnSql(P.e)
	return { name: named, sql: file ?? '', status: ui.status }
}

let cm, vm
try {
	cm = await run('cmangos-classic')
	vm = await run('vmangos')
} finally {
	App.SaveSQLDialog = real.SaveSQLDialog
	App.WriteTextFile = real.WriteTextFile
	P.e.spawnEdits = realEdits
	prefs.exportCore = realCore
}

const out = { cmName: cm.name, cmStatus: cm.status, vmName: vm.name, vmStatus: vm.status, cmHead: cm.sql.split('\n').slice(0, 9), vmHead: vm.sql.split('\n').slice(0, 2) }
out.ok =
	cm.name === 'Azeroth-spawns-cmangos' &&
	cm.sql.includes('CMaNGOS classic world database') &&
	cm.sql.includes('`spawndist`, `MovementType`) VALUES (990001, 3, 0, 1,') &&
	cm.sql.includes('`emote`) VALUES (990001, 1, 1, 10)') &&
	cm.sql.includes('its display; CMaNGOS') &&
	!/wander_distance|movement_type|emote_state|display_id|`patch/.test(cm.sql) &&
	cm.status.includes('for CMaNGOS classic') &&
	cm.status.includes('could not be written') &&
	vm.name === 'Azeroth-spawns' &&
	vm.sql.includes('VMaNGOS world database') &&
	vm.sql.includes('`wander_distance`') &&
	vm.status.includes('for VMaNGOS')
return out
