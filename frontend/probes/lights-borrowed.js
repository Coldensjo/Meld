// World › Lights on a map that borrows Azeroth's global light (#946): with a stand-in MapLights that answers Azeroth's global light marked borrowed (as Go reads it for a map with no global light of its own), a change to its fog distance and Save must hand SaveLights a global light under a new light ID with copies of its params under new IDs, never Azeroth's light or params rows. SaveLights is stubbed, so nothing is written. The fork itself is tested in tests/lightsFile.test.ts (forkBorrowed).
// touches: frontend/src/components/LightsDialog.svelte, frontend/src/lib/io/lightsFile.ts, internal/vmangos/lights.go
const App = window.go.main.App
if (!(await App.WowStatus()).loaded) return { ok: true, skipped: 'no WoW client is loaded' }
const { ui } = await P.state()
const WAIT = 60_000
const realMapLights = App.MapLights
const realSave = App.SaveLights
let edit = null
const button = (dlg, text) => [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
try {
	const az = await realMapLights(0)
	const g = az.lights.find((l) => l.global)
	if (!g) return { ok: false, error: 'Azeroth has no global light' }
	const own = new Set(g.params.filter(Boolean))
	const params = Object.fromEntries(Object.entries(az.params).filter(([k]) => own.has(Number(k))))
	App.MapLights = async (mapId) => ({ mapId, lights: [{ ...g, borrowed: true }], params })
	App.SaveLights = async (e) => ((edit = JSON.parse(JSON.stringify(e))), '')
	ui.dialog = 'lights'
	const dlg = await P.until(() => P.dialog('Lights'), WAIT, 'the Lights dialog')
	await P.until(() => dlg.querySelector('input[title="Set for the whole day"]'), WAIT, 'the global light picked')
	// The first edit forks the light once the next free IDs are read (at init); retry until it lands.
	await P.until(
		() => {
			const fog = dlg.querySelector('input[title="Set for the whole day"]')
			fog.value = String(Number(fog.value) + 50)
			fog.dispatchEvent(new Event('change', { bubbles: true }))
			return !button(dlg, 'Save').disabled
		},
		WAIT,
		'Save enabled after the edit',
	)
	button(dlg, 'Save').click()
	await P.until(() => edit, WAIT, 'the save')
	const lights = edit.lights ?? []
	const ids = (edit.params ?? []).map((p) => p.id)
	const forked = lights.length === 1 && lights[0].global && lights[0].id !== g.id && !lights[0].borrowed
	const newParams = ids.length > 0 && ids.every((id) => !own.has(id)) && lights[0]?.params[0] === ids[0]
	const ok = forked && newParams
	return { ok, azeroth: { light: g.id, params: [...own] }, saved: { mapId: edit.mapId, lights: lights.map((l) => ({ id: l.id, global: l.global, params: l.params })), params: ids } }
} finally {
	App.MapLights = realMapLights
	App.SaveLights = realSave
	ui.dialog = null
}
