// The Portals and area triggers dialog's Export trigger…, Export map… and Import… (#943): on Azeroth with the Deadmines entrance (trigger 78) picked, Export trigger… hands the binding map 0, [78] and its name, and notes where it wrote; Import… of a script the probe writes (78's row as the client has it with no server rows, a new trigger with its areatrigger_template row and a teleport to a map no client has, and a statement of another table) shows the real plan's bar (78 replaced, the new trigger and its missing target map, the statement left out) and Cancel drops it; a confirmed import (a stand-in, since the throwaway client refuses the server's tables) notes what it wrote and reads the triggers again. Nothing is written (the SQL itself is Go's: TestTriggerScriptRoundTrip, TestImportAreaTriggersWritesAsSave).
// touches: frontend/src/components/PortalsDialog.svelte, internal/vmangos/triggerscripts.go, internal/vmangos/meldlines.go, internal/vmangos/sqlparse.go
const { ui } = await P.state()
const App = window.go.main.App
await P.sandboxClient()
const WAIT = 60_000
const TITLE = 'Portals and area triggers'
const text = (el) => el?.textContent.replace(/\s+/g, ' ').trim() ?? ''
const dlg = () => P.dialog(TITLE)
const button = (label) => [...(dlg()?.querySelectorAll('button') ?? [])].find((b) => text(b).startsWith(label))
const planBar = () => dlg()?.querySelector('.plan')

const names = ['ExportAreaTriggers', 'OpenAreaTriggersDialog', 'ImportAreaTriggers', 'AreaTriggers']
const real = Object.fromEntries(names.map((n) => [n, App[n]]))
const calls = { exported: [], imported: null, reads: 0 }
const out = {}
try {
	await P.scene({
		v: 1,
		map: { region: { mapName: 'Azeroth', x: 28, y: 53, size: 1 } },
		view: { target: [0, 0, 0], yaw: 0, pitch: 0.3, distance: 30, hour: 13 },
		prefs: { cameraFollowGround: false },
		tool: 'select',
		selectedIds: [],
		selected: null,
		area: null,
		viewport: [1000, 600],
	})
	ui.dialog = 'portals'
	const entry = await P.until(() => [...(dlg()?.querySelectorAll('.list button') ?? [])].find((b) => /\b78\b/.test(text(b.querySelector('.id')))), WAIT, 'trigger 78 in the list')
	entry.click()
	await P.until(() => dlg()?.querySelector('.form'), WAIT, 'trigger 78 picked')
	const name78 = dlg().querySelector('#at-name').value

	App.ExportAreaTriggers = async (mapId, ids, suggested) => {
		calls.exported.push({ mapId, ids, suggested })
		return `C:/Meld-probe/${suggested}.sql`
	}
	button('Export trigger').click()
	await P.until(() => /Exported/.test(text(dlg()?.querySelector('.note'))), WAIT, 'the export note')
	out.exportNote = text(dlg()?.querySelector('.note'))
	button('Export map').click()
	await P.until(() => calls.exported.length === 2, WAIT, 'the map export')

	// The script: 78's row as this client has it (no server rows: its name and teleport are kept), and
	// a new trigger with a teleport to a map no client has.
	const t78 = (await real.AreaTriggers(0)).triggers.find((x) => x.id === 78)
	const line = (a) => `-- meld trigger ${[a.id, a.mapId, a.x, a.y, a.z, a.radius, a.boxX, a.boxY, a.boxZ, a.boxYaw].join(' ')}`
	const script = [
		'-- Area triggers exported by Meld (the portal-scripts probe).',
		line(t78),
		line({ id: 60001, mapId: 0, x: 1, y: 2, z: 3, radius: 4, boxX: 0, boxY: 0, boxZ: 0, boxYaw: 0 }),
		"REPLACE INTO `areatrigger_template` (`id`, `build`, `name`, `map_id`, `x`, `y`, `z`, `radius`) VALUES (60001, 5875, 'Probe Gate', 0, 1, 2, 3, 4);",
		'DELETE FROM `areatrigger_teleport` WHERE `id` = 60001;',
		"INSERT INTO `areatrigger_teleport` (`id`, `patch`, `name`, `message`, `required_level`, `target_map`, `target_position_x`, `target_position_y`, `target_position_z`, `target_orientation`) VALUES (60001, 0, 'Probe Gate', '', 0, 9999, 1, 2, 3, 0);",
		"UPDATE creature_template SET name = 'x' WHERE entry = 1;",
		'',
	].join('\n')
	const path = await P.sandboxFile('portal-scripts.sql', new TextEncoder().encode(script))
	App.OpenAreaTriggersDialog = async () => path
	button('Import').click()
	await P.until(() => planBar(), WAIT, 'the plan bar')
	out.bar = text(planBar())
	out.refused = !!planBar().querySelector('.refused')
	;[...planBar().querySelectorAll('button')].find((b) => text(b) === 'Cancel').click()
	await P.frames(2)
	out.cancelled = !planBar()

	// A confirmed import: the triggers are read again and the note says what was written.
	App.ImportAreaTriggers = async (p) => {
		calls.imported = p
		return { patch: 'patch-3.MPQ', server: true, waiting: false, restart: true, triggers: 2, teleports: 2, maps: [0] }
	}
	App.AreaTriggers = async (mapId) => {
		calls.reads++
		return real.AreaTriggers(mapId)
	}
	button('Import').click()
	await P.until(() => planBar(), WAIT, 'the plan bar again')
	;[...planBar().querySelectorAll('button')].find((b) => text(b) === 'Import').click()
	await P.until(() => /Imported 2 triggers/.test(text(dlg()?.querySelector('.note'))), WAIT, 'the import note')
	out.importNote = text(dlg()?.querySelector('.note'))

	ui.dialog = null
	await P.frames(1)
	out.ended = await P.endSandbox()
	const exp = calls.exported
	out.ok =
		out.ended.realUnchanged &&
		exp[0]?.mapId === 0 &&
		exp[0].ids.length === 1 &&
		exp[0].ids[0] === 78 &&
		exp[0].suggested === (name78 || 'Trigger 78') &&
		exp[1]?.ids.length === 0 &&
		/Exported .+ \(1 trigger\)/.test(out.exportNote) &&
		out.bar.includes('Import 2 triggers into the client') &&
		out.bar.includes('(78, replaces it') &&
		out.bar.includes('Probe Gate (60001, new, to map 9999)') &&
		out.bar.includes('refuses those teleports: map 9999') &&
		out.bar.includes('1 other statement is left out') &&
		!out.refused &&
		out.cancelled &&
		calls.imported === path &&
		calls.reads > 0 &&
		out.importNote.includes('Imported 2 triggers, 2 with a teleport, into the client and the server') &&
		out.importNote.includes('Restart the world server')
	return { ...out, calls }
} finally {
	for (const n of names) App[n] = real[n]
	ui.dialog = null
}
