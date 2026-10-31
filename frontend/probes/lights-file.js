// World › Lights' Export and Import (#945): against stand-ins for the ExportLights and ImportLights bindings (no file dialog on the page, nothing written), Export hands over the map's lights with the params they name, and importing that file back as if from another map, one colour changed, loads it as unsaved changes: the local lights come in with new IDs at the same places, the global light keeps the map's own (or gets one of its own when the map borrows Azeroth's), Save lights up, and nothing reaches the client until Save. The merge rules are tested in tests/lightsFile.test.ts, the file in Go (internal/vmangos/lights_file_test.go).
// touches: frontend/src/components/LightsDialog.svelte, frontend/src/lib/io/lightsFile.ts, app_client_tables.go, internal/vmangos/lights_file.go
const App = window.go.main.App
if (!(await App.WowStatus()).loaded) return { ok: true, skipped: 'no WoW client is loaded' }
const { ui } = await P.state()
const WAIT = 60_000
const realExport = App.ExportLights
const realImport = App.ImportLights
const realSave = App.SaveLights
let exported = null
let saved = 0
const button = (dlg, text) => [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
try {
	App.ExportLights = async (edit, name) => ((exported = JSON.parse(JSON.stringify(edit))), `C:\\probe\\${name}.json`)
	App.SaveLights = async () => (saved++, '')
	ui.dialog = 'lights'
	const dlg = await P.until(() => P.dialog('Lights'), WAIT, 'the Lights dialog')
	await P.until(() => dlg.querySelectorAll('.list li button').length > 0, WAIT, 'the lights listed')
	const listed = dlg.querySelectorAll('.list li button').length
	button(dlg, 'Export…').click()
	await P.until(() => exported, WAIT, 'the export')
	const named = new Set(exported.lights.flatMap((l) => l.params).filter(Boolean))
	const paramsNamed = exported.params.length > 0 && exported.params.every((p) => named.has(p.id) && p.colors.length === 18 && p.floats.length === 6)
	const saveBefore = button(dlg, 'Save').disabled

	const file = JSON.parse(JSON.stringify(exported))
	file.mapId = exported.mapId === 0 ? 1 : 0
	file.params[0].colors[7] = [{ t: 0, v: 0x123456 }]
	App.ImportLights = async () => file
	button(dlg, 'Import…').click()
	await P.until(() => !button(dlg, 'Save').disabled, WAIT, 'Save enabled after the import')
	const locals = exported.lights.filter((l) => !l.global).length
	await P.until(() => dlg.querySelectorAll('.list li button').length === listed + locals, WAIT, 'the imported lights listed')
	const marked = [...dlg.querySelectorAll('.list li button')].filter((b) => b.textContent.includes('•')).length
	const status = document.querySelector('[data-ui="StatusBar"]')?.textContent ?? ''
	const ok = exported.lights.length === listed && paramsNamed && saveBefore && marked >= locals && saved === 0
	return { ok, listed, exported: exported.lights.length, params: exported.params.length, paramsNamed, saveBefore, locals, marked, saved, status: status.slice(0, 160) }
} finally {
	App.ExportLights = realExport
	App.ImportLights = realImport
	App.SaveLights = realSave
	ui.dialog = null
}
