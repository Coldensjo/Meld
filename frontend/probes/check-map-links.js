// File › Check Map's world links (#953) against the real client and world database: on a flat map standing in for Kalimdor (map 1), Vesprystus (creature 3838) on the Rut'theran Village stop has no finding (the Horde's far stop isn't his side's), Dungar Longdrink (352) at the map's far corner gets a finding for each side under Flight masters without flights (its nearest stops are far, or have no route), the report reads Kalimdor's stops, and two teleports put into the real report (CheckWorldData stood in around the real one) give a warning for a target 50 yd over the flat ground, pointing at it, and an error for a map the client lacks; nothing saved.
// touches: frontend/src/lib/check/links.ts, frontend/src/lib/check/run.ts, internal/vmangos/linkcheck.go, internal/vmangos/worlddata.go
const e = P.e
const App = window.go.main.App
const se = await P.app('/src/lib/world/spawnEdits.ts')
const { loadObjectTemplates } = await P.app('/src/components/SpawnBrowser.svelte')
const { fromServer, toServer } = await P.app('/src/lib/wow/format.ts')
const net = await App.TaxiNetwork(1).catch((err) => String(err))
if (typeof net === 'string') return { ok: false, why: `Kalimdor's flight stops can't be read: ${net}` }
const rut = net.nodes.find((n) => /Rut'theran/.test(n.name))
if (!rut) return { ok: false, why: 'no Rut’theran Village stop in TaxiNodes.dbc' }
const templates = await loadObjectTemplates()
if (!templates.length) return { ok: false, why: 'no object templates: the world database is not reachable' }

e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const doc = e.activeDocument()
doc.meta.vmangos = { dir: 'Kalimdor', mapId: 1 }
// A creature spawn needs no look here: an object spawn's fields, as a creature (as check-map-world does).
const base = se.newObjectSpawn(templates[0], 999_999_971, 100, 0, 100, 0)
const at = fromServer(rut.x, rut.y, 0, 0)
const vesprystus = { ...base, kind: 'monster', entry: 3838, name: 'Vesprystus', x: at.x, y: rut.z, z: at.z, waypoints: [] }
const dungar = { ...base, kind: 'monster', guid: 999_999_972, entry: 352, name: 'Dungar Longdrink', waypoints: [] }
doc.spawnLayer.set([vesprystus, dungar])
se.syncSpawnUi(doc.spawnLayer, true)
e.controller.target.set(110, 0, 100)

const air = toServer(120, 130, 0, 0)
const real = App.CheckWorldData
let asked = null
App.CheckWorldData = async (q) => {
	asked = q
	const r = await real(q)
	const link = (over) => ({ kind: 'into', label: 'Probe portal', trigger: 0, entry: 0, guid: 0, at: [0, 0, 0], mapKnown: true, mapName: 'Kalimdor', ground: null, inBuilding: false, outsideBuilding: false, ...over })
	r.links.portals.push(
		link({ dest: { map: 1, x: air.x, y: air.y, z: 50, o: 0, level: 0, message: '' } }),
		link({ label: 'Probe lost portal', mapKnown: false, mapName: '', dest: { map: 4242, x: 0, y: 0, z: 0, o: 0, level: 0, message: '' } }),
	)
	return r
}
let findings
try {
	findings = (await e.checkMap()).findings
} finally {
	App.CheckWorldData = real
}
const world = findings.filter((f) => f.group === 'world')
const masters = world.filter((f) => f.check === 'Flight masters without flights')
const failed = world.find((f) => /flight stops and portals (weren't|wasn't) checked/.test(f.message))
const ves = masters.filter((f) => f.message.includes('creature 3838'))
const dungarSides = masters.filter((f) => f.message.includes('creature 352'))
const portals = world.filter((f) => f.check === 'Portal destinations')
const high = portals.find((f) => f.message.startsWith('Probe portal lands 50 yd above the ground'))
const lost = portals.find((f) => f.message.startsWith('Probe lost portal sends the player to map 4242'))
return {
	world: world.filter((f) => f.check.startsWith('Flight') || f.check === 'Portal destinations' || f.check === 'World data').map((f) => `${f.severity} ${f.check}: ${f.message}`),
	asked: asked?.links ? { mapId: asked.links.mapId, spawns: asked.links.spawns.length } : null,
	ok:
		!failed &&
		asked?.links?.mapId === 1 &&
		asked.links.spawns.length === 2 &&
		ves.length === 0 &&
		dungarSides.length === 2 &&
		high?.severity === 'warning' &&
		Math.abs(high.x - 120) < 0.5 &&
		Math.abs(high.z - 130) < 0.5 &&
		lost?.severity === 'error',
}
