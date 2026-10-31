// The Flight Paths window's Export stop…, Export map… and Import… (#944): in Redridge (Azeroth 36_49) with Lakeshire (stop 5) picked, Export stop… hands the binding map 0, [5] and its name, and notes where it wrote with its routes counted; Import… of a script the probe writes (stop 5's taxi_nodes row and its first route as the client has them, a new stop 250 with a new route from it to 5, and a statement of another table) shows the real plan's bar (5 and its route unchanged, the new stop and route, the statement left out) and Cancel drops it; a confirmed import (a stand-in, since the throwaway client refuses the server's tables) notes what it wrote and reads the network again. Nothing is written (the SQL itself is Go's: TestTaxiScriptRoundTrip, TestImportTaxiWritesAsSave).
// touches: frontend/src/components/FlightPathsWindow.svelte, internal/vmangos/taxiscripts.go, internal/vmangos/meldlines.go, internal/vmangos/sqlparse.go
const { ui } = await P.state()
const App = window.go.main.App
await P.sandboxClient()
const WAIT = 60_000
const text = (el) => el?.textContent.replace(/\s+/g, ' ').trim() ?? ''
const win = () => document.querySelector('[data-ui="FlightPathsWindow"]')
const button = (label) => [...(win()?.querySelectorAll('button') ?? [])].find((b) => text(b).startsWith(label))
const planBar = () => win()?.querySelector('.plan')
const note = () => text(win()?.querySelector('.note'))

const names = ['ExportTaxi', 'OpenTaxiDialog', 'ImportTaxi', 'TaxiNetwork']
const real = Object.fromEntries(names.map((n) => [n, App[n]]))
const calls = { exported: [], imported: null, reads: 0 }
const out = {}
try {
	await P.scene({
		v: 1,
		map: { region: { mapName: 'Azeroth', x: 36, y: 49, size: 1 } },
		view: { target: [0, 0, 0], yaw: 0, pitch: 0.3, distance: 30, hour: 13 },
		prefs: { cameraFollowGround: false },
		tool: 'select',
		selectedIds: [],
		selected: null,
		area: null,
		viewport: [1000, 600],
	})
	ui.flightPaths = true
	const entry = await P.until(() => [...(win()?.querySelectorAll('.list[aria-label="Stops"] button') ?? [])].find((b) => text(b.querySelector('.id')) === '5'), WAIT, 'Lakeshire in the list')
	entry.click()
	await P.until(() => button('Export stop'), WAIT, 'Lakeshire picked')
	const net = await real.TaxiNetwork(0)
	const s5 = net.nodes.find((s) => s.id === 5)
	const own = net.routes.filter((r) => r.from === 5 || r.to === 5)

	App.ExportTaxi = async (mapId, ids, suggested) => {
		calls.exported.push({ mapId, ids, suggested })
		return `C:/Meld-probe/${suggested}.sql`
	}
	button('Export stop').click()
	await P.until(() => /Exported/.test(note()), WAIT, 'the export note')
	out.exportNote = note()
	button('Export map').click()
	await P.until(() => calls.exported.length === 2, WAIT, 'the map export')

	// The script: stop 5 and its first route as this client has them, a new stop 250 and a new route
	// from it to 5, and an UPDATE of another table.
	const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
	const row = (n) =>
		`REPLACE INTO \`taxi_nodes\` (\`id\`, \`build\`, \`map_id\`, \`x\`, \`y\`, \`z\`, \`name\`, \`mount_creature_id1\`, \`mount_creature_id2\`) VALUES (${[n.id, 5875, n.mapId, n.x, n.y, n.z, q(n.name), n.hordeMount, n.allianceMount].join(', ')});`
	const route = (r) => [`-- meld route ${r.id} ${r.from} ${r.to} ${r.cost}`, ...r.points.map((p) => `-- meld point ${r.id} ${p.mapId} ${p.x} ${p.y} ${p.z} ${p.flags} ${p.delay}`)]
	const r5 = own[0]
	const fresh = { id: 250, mapId: 0, x: s5.x + 100, y: s5.y, z: s5.z, name: 'Probe Rest', hordeMount: 2224, allianceMount: 541 }
	const newRoute = {
		id: 9001,
		from: 250,
		to: 5,
		cost: 10,
		points: [
			{ mapId: 0, x: fresh.x, y: fresh.y, z: fresh.z + 20, flags: 0, delay: 0 },
			{ mapId: 0, x: s5.x, y: s5.y, z: s5.z + 20, flags: 2, delay: 0 },
		],
	}
	const script = ['-- Flight paths exported by Meld (the flight-scripts probe).', ...route(r5), ...route(newRoute), row(s5), row(fresh), "UPDATE creature_template SET name = 'x' WHERE entry = 1;", ''].join('\n')
	const path = await P.sandboxFile('flight-scripts.sql', new TextEncoder().encode(script))
	App.OpenTaxiDialog = async () => path
	button('Import').click()
	await P.until(() => planBar(), WAIT, 'the plan bar')
	out.bar = text(planBar())
	out.refused = !!planBar().querySelector('.refused')
	;[...planBar().querySelectorAll('button')].find((b) => text(b) === 'Cancel').click()
	await P.frames(2)
	out.cancelled = !planBar()

	// A confirmed import: the network is read again and the note says what was written.
	App.ImportTaxi = async (p) => {
		calls.imported = p
		return { patch: 'patch-3.MPQ', server: true, waiting: false, restart: true, stops: 2, routes: 1, removed: 0, maps: [0] }
	}
	App.TaxiNetwork = async (mapId) => {
		calls.reads++
		return real.TaxiNetwork(mapId)
	}
	button('Import').click()
	await P.until(() => planBar(), WAIT, 'the plan bar again')
	;[...planBar().querySelectorAll('button')].find((b) => text(b) === 'Import').click()
	await P.until(() => /Imported 2 stops/.test(note()), WAIT, 'the import note')
	out.importNote = note()

	ui.flightPaths = false
	await P.frames(1)
	out.ended = await P.endSandbox()
	const exp = calls.exported
	const routeName = (r) => `${net.nodes.find((s) => s.id === r.from)?.name ?? `stop ${r.from}`} to ${net.nodes.find((s) => s.id === r.to)?.name ?? `stop ${r.to}`}`
	out.ok =
		out.ended.realUnchanged &&
		exp[0]?.mapId === 0 &&
		exp[0].ids.length === 1 &&
		exp[0].ids[0] === 5 &&
		exp[0].suggested === s5.name.replace(/[^\w\- ]+/g, '').trim() &&
		exp[1]?.ids.length === 0 &&
		out.exportNote.includes(`(1 stop, ${own.length} routes)`) &&
		out.bar.includes('Import 2 stops and 2 routes into the client') &&
		out.bar.includes(`${s5.name} (5, unchanged)`) &&
		out.bar.includes('Probe Rest (250, new)') &&
		out.bar.includes(`${routeName(r5)} (${r5.id}, ${r5.points.length} points, unchanged)`) &&
		out.bar.includes(`Probe Rest to ${s5.name} (9001, 2 points, new)`) &&
		out.bar.includes('1 of the routes is this client') &&
		out.bar.includes('1 other statement is left out') &&
		!out.refused &&
		out.cancelled &&
		calls.imported === path &&
		calls.reads > 0 &&
		out.importNote.includes('Imported 2 stops and 1 changed route into the client and the server') &&
		out.importNote.includes('Restart the world server')
	return { ...out, calls }
} finally {
	for (const n of names) App[n] = real[n]
	ui.flightPaths = false
}
