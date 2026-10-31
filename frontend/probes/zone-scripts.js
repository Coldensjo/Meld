// The Zones dialog's Export zone…, Export map… and Import… (#942): on Elwynn Forest (12), Export zone… hands the binding map 0, Elwynn and its subzones and its name, and notes where it wrote; Import… of a script the probe writes (Elwynn's row as the client has it, a new zone on Elwynn's exploration bit with weather, and a statement of another table) shows the real plan's bar (Elwynn replaced, the new zone given the next free bit, the weather, the statement left out) and Cancel drops it; a confirmed import (a stand-in, since the throwaway client refuses the server's tables) notes what it wrote and reads the zones again. Nothing is written (the SQL itself is Go's: TestAreaScriptRoundTrip, TestImportAreasWritesAsSave).
// touches: frontend/src/components/ZonesDialog.svelte, internal/vmangos/areascripts.go, internal/vmangos/meldlines.go, internal/vmangos/sqlparse.go
const { ui } = await P.state()
const App = window.go.main.App
await P.sandboxClient()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 60_000
const text = (el) => el?.textContent.replace(/\s+/g, ' ').trim() ?? ''
const dlg = () => P.dialog('Zones')
const button = (label) => [...(dlg()?.querySelectorAll('button') ?? [])].find((b) => text(b).startsWith(label))
const planBar = () => dlg()?.querySelector('.plan')

const names = ['ExportAreas', 'OpenAreasDialog', 'ImportAreas', 'AreaRows']
const real = Object.fromEntries(names.map((n) => [n, App[n]]))
const calls = { exported: [], imported: null, areaReads: 0 }
const out = {}
try {
	ui.dialog = 'zones'
	const elwynn = await P.until(() => [...(dlg()?.querySelectorAll('.list button') ?? [])].find((b) => text(b).startsWith('Elwynn Forest')), WAIT, 'Elwynn Forest in the zone list')
	elwynn.click()
	await P.until(() => dlg()?.querySelector('#zone-name')?.value === 'Elwynn Forest', WAIT, 'Elwynn picked')

	App.ExportAreas = async (mapId, ids, suggested) => {
		calls.exported.push({ mapId, ids, suggested })
		return `C:/Meld-probe/${suggested}.sql`
	}
	button('Export zone').click()
	await P.until(() => /Exported Elwynn Forest/.test(text(dlg())), WAIT, 'the export note')
	out.exportNote = text(dlg()?.querySelector('.note'))
	button('Export map').click()
	await P.until(() => calls.exported.length === 2, WAIT, 'the map export')

	// The script: Elwynn's row as this client has it, and a new zone on Elwynn's exploration bit.
	const rows = await real.AreaRows(0)
	const e = rows.find((r) => r.id === 12)
	const line = (a) =>
		`-- meld area ${[a.id, a.mapId, a.parent, a.areaBit, a.flags, a.soundPref, a.soundSwim, a.ambience, a.music, a.introMusic, a.level, a.faction, a.liquid, a.minElevation, a.ambientMul, a.light].join(' ')} ${JSON.stringify(a.name)}`
	const fresh = { ...e, id: 60001, parent: 0, name: 'Probe Vale' }
	const script = [
		'-- Zones exported by Meld (the zone-scripts probe).',
		line(e),
		line(fresh),
		"REPLACE INTO area_template (entry, map_id, zone_id, explore_flag, flags, area_level, name, team, liquid_type) VALUES (60001, 0, 0, 1, 64, 1, 'Probe Vale', 0, 0);",
		'REPLACE INTO game_weather (zone, spring_rain_chance) VALUES (60001, 30);',
		"UPDATE creature_template SET name = 'x' WHERE entry = 1;",
		'',
	].join('\n')
	const path = await P.sandboxFile('zone-scripts.sql', new TextEncoder().encode(script))
	App.OpenAreasDialog = async () => path
	button('Import').click()
	await P.until(() => planBar(), WAIT, 'the plan bar')
	out.bar = text(planBar())
	out.refused = !!planBar().querySelector('.refused')
	;[...planBar().querySelectorAll('button')].find((b) => text(b) === 'Cancel').click()
	await P.frames(2)
	out.cancelled = !planBar()

	// A confirmed import: the zones are read again and the note says what was written.
	App.ImportAreas = async (p) => {
		calls.imported = p
		return { patch: 'patch-3.MPQ', server: true, waiting: false, restart: true, areas: 2, maps: [0], weather: 1 }
	}
	App.AreaRows = async (mapId) => {
		calls.areaReads++
		return real.AreaRows(mapId)
	}
	button('Import').click()
	await P.until(() => planBar(), WAIT, 'the plan bar again')
	;[...planBar().querySelectorAll('button')].find((b) => text(b) === 'Import').click()
	await P.until(() => /Imported 2 areas/.test(text(dlg())), WAIT, 'the import note')
	out.importNote = text(dlg()?.querySelector('.note'))

	ui.dialog = null
	await P.frames(1)
	out.ended = await P.endSandbox()
	const exp = calls.exported
	out.ok =
		out.ended.realUnchanged &&
		exp[0]?.mapId === 0 &&
		exp[0].ids[0] === 12 &&
		exp[0].ids.length > 1 &&
		exp[0].suggested === 'Elwynn Forest' &&
		exp[1]?.ids.length === 0 &&
		/Exported Elwynn Forest \(\d+ areas/.test(out.exportNote) &&
		out.bar.includes('Import 2 areas into the client') &&
		out.bar.includes('Elwynn Forest (12, replaces it)') &&
		new RegExp(`Probe Vale \\(60001, new, exploration bit \\d+, as ${e.areaBit} is another area's\\)`).test(out.bar) &&
		(out.bar.includes("Weather: sets 1 zone's") || out.bar.includes('The weather is left out')) &&
		out.bar.includes('1 other statement is left out') &&
		!out.refused &&
		out.cancelled &&
		calls.imported === path &&
		calls.areaReads > 0 &&
		out.importNote.includes('Imported 2 areas, with the weather of 1 zone, into the client and the server') &&
		out.importNote.includes('Restart the world server')
	return { ...out, calls }
} finally {
	for (const n of names) App[n] = real[n]
	ui.dialog = null
}
