// File › Compile to CMaNGOS Server (#894): the CMaNGOS classic server's map data rebuilt by its own
// extractors. Opens Azeroth 31_50 (1x1) and stands in CmangosPath and UpdateCMaNGOSServer, so no
// extractor runs and nothing is written; the region's answer to "does the client lack its edits"
// (the document's cached RegionPending answer) is set by hand. Checks: with no CMaNGOS folder it says
// to set one and starts nothing; with edits the client lacks it says to compile to the client first;
// otherwise it starts the rebuild for map 0 (from the client's Map.dbc) and says every map is
// extracted, and servermaps:done ends it; the real SetCmangosPath refuses a folder without mangosd.conf
// (so the user's config is not changed).
// touches: frontend/src/lib/io/compile.ts, app_cmangos.go, internal/vmangos/cmangosmaps.go, frontend/src/lib/ui/menus.ts
const { ui, editor } = await P.state()
const regionIo = await P.app('/src/lib/io/region.ts')
const compileIo = await P.app('/src/lib/io/compile.ts')
regionIo.openWowRegion(P.e, 'Azeroth', 31, 50, 1)
await P.until(() => (editor.regionMap === 'Azeroth' && P.e.activeRegion()?.x === 31) || null, 120000, 'the Azeroth 31_50 tab')

const App = window.go.main.App
const real = { CmangosPath: App.CmangosPath, UpdateCMaNGOSServer: App.UpdateCMaNGOSServer }
const d = P.e.activeDocument()
const realState = { compiled: d.compiled, pending: d.pending }
let folder = ''
let started = []
App.CmangosPath = async () => folder
App.UpdateCMaNGOSServer = async (mapId) => {
	started.push(mapId)
}
// The client lacks `files` of the region's files, as RegionPending last answered.
const lacking = (files) => {
	d.compiled = { key: null, changes: -1 }
	d.pending = { key: P.e.regionKey(), changes: d.history.changes, files }
}
const run = async (files) => {
	started = []
	lacking(files)
	await compileIo.compileCmangos(P.e)
	const out = { started: started.join(','), status: ui.status }
	window.runtime.EventsEmit('servermaps:done', '')
	await P.frames(1)
	return out
}

let noFolder, uncompiled, rebuild, done, refused
try {
	noFolder = await run(0)
	folder = 'C:\\probe-cmangos'
	uncompiled = await run(2)
	rebuild = await run(0)
	done = ui.status
	refused = await App.SetCmangosPath('C:\\no-such-meld-probe-folder').then(
		() => 'accepted',
		(e) => String(e),
	)
} finally {
	App.CmangosPath = real.CmangosPath
	App.UpdateCMaNGOSServer = real.UpdateCMaNGOSServer
	d.compiled = realState.compiled
	d.pending = realState.pending
}

const out = { noFolder, uncompiled, rebuild, done, refused }
out.ok =
	noFolder.started === '' &&
	noFolder.status.includes('Set the CMaNGOS server folder') &&
	uncompiled.started === '' &&
	uncompiled.status.includes('Compile to Client first') &&
	rebuild.started === '0' &&
	rebuild.status.includes('every map') &&
	done.includes('rebuilt') &&
	refused.includes('mangosd.conf')
return out
