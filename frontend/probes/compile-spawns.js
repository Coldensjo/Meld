// Compile to Server and Compile All save the region's spawn edits into the world database (#342).
// Opens Azeroth 31_50 (1x1) and replaces the Go bindings the compile calls (VmangosPath, SaveRegion,
// ApplySpawnEdits, UpdateRegionServer) with stand-ins that record the order of the calls, so nothing
// is written to the patch or the database and mangosd is never restarted. Checks: Compile to Server
// writes the spawns before it starts the rebuild and says so; a failed spawn write stops the rebuild
// and says why; Compile All writes the tiles, then the spawns, then rebuilds; Compile to Client never
// writes the spawns; with no spawn edits nothing goes to the database.
// touches: frontend/src/lib/io/region.ts, frontend/src/lib/io/compile.ts, frontend/src/lib/world/spawnEdits.ts, app.go, internal/vmangos/spawnedit.go, frontend/src/lib/engine/SpawnActions.ts
// tier: smoke
const { ui, editor, prefs } = await P.state()
const regionIo = await P.app('/src/lib/io/region.ts')
const compileIo = await P.app('/src/lib/io/compile.ts')
regionIo.openWowRegion(P.e, 'Azeroth', 31, 50, 1)
await P.until(() => (editor.regionMap === 'Azeroth' && P.e.activeRegion()?.x === 31) || null, 120000, 'the Azeroth 31_50 tab')

const App = window.go.main.App
const real = {}
const names = ['VmangosPath', 'SaveRegion', 'ApplySpawnEdits', 'UpdateRegionServer']
for (const n of names) real[n] = App[n]
const realEdits = P.e.spawnEdits
const realCheck = prefs.checkBeforeCompile
let calls = []
let failSpawns = false
let edits = [{ kind: 'creature', guid: 1 }]
App.VmangosPath = async () => 'C:\\probe-server'
App.SaveRegion = async () => {
	calls.push('SaveRegion')
	return { patch: 'patch-3.MPQ', tiles: 1, changed: 1, changedTiles: ['31_50'], mapId: 0, tilesCurrent: true, building: false }
}
App.ApplySpawnEdits = async () => {
	calls.push('ApplySpawnEdits')
	if (failSpawns) throw new Error('probe: database down')
	return { added: 1, changed: 2, deleted: 0, skipped: [], sql: '' }
}
App.UpdateRegionServer = async () => {
	calls.push('UpdateRegionServer')
}
P.e.spawnEdits = () => edits
prefs.checkBeforeCompile = false
// The rebuild runs until Go sends servermaps:done; the stand-in never does, so the probe sends it.
const rebuilt = async () => {
	window.runtime.EventsEmit('servermaps:done', '')
	await P.frames(1)
}
const run = async (target) => {
	calls = []
	await compileIo.compileRegion(P.e, target)
	const out = { calls: calls.join(','), status: ui.status }
	await rebuilt()
	return out
}

let server, serverFail, all, client, noEdits
try {
	server = await run('server')
	failSpawns = true
	serverFail = await run('server')
	failSpawns = false
	all = await run('all')
	client = await run('client')
	edits = []
	noEdits = await run('server')
} finally {
	for (const n of names) App[n] = real[n]
	P.e.spawnEdits = realEdits
	prefs.checkBeforeCompile = realCheck
}

const out = { server, serverFail, all, client, noEdits }
out.ok =
	server.calls === 'ApplySpawnEdits,UpdateRegionServer' &&
	server.status.includes('Saved spawns to the world database: 1 added, 2 changed') &&
	server.status.includes('Rebuilding') &&
	serverFail.calls === 'ApplySpawnEdits' &&
	serverFail.status.includes('not saved') &&
	serverFail.status.includes('probe: database down') &&
	all.calls === 'SaveRegion,ApplySpawnEdits,UpdateRegionServer' &&
	all.status.includes('Saved spawns') &&
	!all.status.includes('Save Spawns to Database') &&
	client.calls === 'SaveRegion' &&
	noEdits.calls === 'UpdateRegionServer' &&
	!noEdits.status.includes('spawn')
return out
