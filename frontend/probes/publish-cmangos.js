// File › Compile to CMaNGOS Server on a map made for the client (#1037): it publishes that map to the CMaNGOS
// classic server instead of rebuilding a region. Makes a 1-tile flat dungeon (map 1996) and stands in
// CmangosPath and PublishCMaNGOSMap, so nothing is written. Checks: with no CMaNGOS folder it says to set one
// and starts nothing; with one it sends the map's spec (its folder, ID, tile and dungeon info), says every map
// is extracted, and publish:done ends it with the instance_template SQL file to import and the `.go` line; a
// world map's done line names no SQL.
// touches: frontend/src/lib/io/publish.ts, frontend/src/lib/io/compile.ts, app_cmangos.go, internal/vmangos/cmangospublish.go
const { ui } = await P.state()
const compileIo = await P.app('/src/lib/io/compile.ts')
const info = { type: 1, name: 'Probe Halls', areaId: 0, loadingScreen: 0, maxPlayers: 5, resetDelay: 3, ghostMap: -1, ghostX: 0, ghostY: 0 }
const doc = P.e.newVmangosDocument(1, 'flat', 0, { dir: 'ProbeCmangos', mapId: 1996, info })
await P.frames(3)

const App = window.go.main.App
const real = { CmangosPath: App.CmangosPath, PublishCMaNGOSMap: App.PublishCMaNGOSMap }
let folder = ''
let sent = []
App.CmangosPath = async () => folder
App.PublishCMaNGOSMap = async (spec) => {
	sent.push(spec)
	return spec.Info?.type ? 'C:\\probe-cmangos\\meld-sql\\ProbeCmangos_instance_template.sql' : ''
}
const run = async () => {
	sent = []
	await compileIo.compileCmangos(P.e)
	const out = { sent: sent.map((s) => ({ dir: s.Dir, id: s.MapID, tiles: s.Tiles.length, type: s.Info?.type, players: s.Info?.maxPlayers })), status: ui.status }
	window.runtime.EventsEmit('publish:done', '')
	await P.until(() => !ui.busy || null, 5000, 'the publish to end')
	out.done = ui.status
	return out
}

let noFolder, dungeon, world
try {
	noFolder = await run()
	folder = 'C:\\probe-cmangos'
	dungeon = await run()
	P.e.setMapInfo({ ...info, type: 0 })
	await P.frames(1)
	world = await run()
} finally {
	App.CmangosPath = real.CmangosPath
	App.PublishCMaNGOSMap = real.PublishCMaNGOSMap
	P.e.closeDocument(doc.id)
}

const out = { noFolder, dungeon, world }
const d = dungeon.sent[0]
out.ok =
	noFolder.sent.length === 0 &&
	noFolder.status.includes('Set the CMaNGOS server folder') &&
	dungeon.sent.length === 1 &&
	d.dir === 'ProbeCmangos' &&
	d.id === 1996 &&
	d.tiles === 1 &&
	d.type === 1 &&
	d.players === 5 &&
	dungeon.status.includes('every map') &&
	dungeon.done.includes('Map published') &&
	dungeon.done.includes('ProbeCmangos_instance_template.sql') &&
	dungeon.done.includes('.go') &&
	world.sent.length === 1 &&
	world.sent[0].type === 0 &&
	world.done.includes('Start the CMaNGOS world server') &&
	!world.done.includes('instance_template')
return out
