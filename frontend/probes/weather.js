// Lighting › Weather Preview (#185): rain, snow and a sandstorm draw around the camera with the client's storm light and fog, clear weather draws none and costs nothing; and the Zones dialog shows a zone's game_weather chances (nothing written).
// touches: frontend/src/lib/world/WeatherLayer.ts, frontend/src/lib/wow/weather.ts, frontend/src/components/ZonesDialog.svelte, internal/vmangos/weather.go
const e = P.e
const { prefs, ui } = await P.state()
e.newDocument(256, 'hills', 1, 'Probe')
prefs.clientLighting = true
prefs.fog = true
ui.weather = 'clear'
ui.weatherGrade = 'heavy'
// Low over the ground, so the mist has ground behind it rather than fog of its own colour.
e.controller.distance = 25
e.controller.pitch = 0.35
await P.until(() => e.clientLights && e.scene.fog, 30000, "Azeroth's lights and the fog")
await P.frames(2)
const fog = () => (e.scene.fog ? [Math.round(e.scene.fog.near), Math.round(e.scene.fog.far)] : null)
const clearFog = fog()
const clearShot = await P.shot()
const layer = e.weather
const out = { clearFog, clearHidden: !layer.group.visible }

/** One weather: its parts once their textures load, the fog, and how the picture changed from clear. */
async function look(kind) {
	ui.weather = kind
	const part = kind === 'rain' ? 'rain' : kind === 'snow' ? 'snow' : 'mist'
	await P.until(() => layer[part]?.material.visible, 30000, `the ${kind} texture`)
	await P.frames(2)
	// The frame drawn again as it is, and again without the drops: what the drops add to the storm light.
	const shot = await P.shot(() => {
		e.frame()
		e.renderer.render(e.scene, e.camera)
	})
	const p = layer[part]
	const visible = layer.group.visible && p.visible
	const count = part === 'snow' ? p.geometry.drawRange.count : p.geometry.instanceCount
	const bare = await P.shot(() => {
		e.frame()
		layer.group.visible = false
		e.renderer.render(e.scene, e.camera)
	})
	return { visible, count, fog: fog(), stormLight: P.diff(clearShot, bare, 0.04).off, drops: P.diff(bare, shot, 0.01).off }
}
out.rain = await look('rain')
out.snow = await look('snow')
out.sand = await look('sand')
ui.weatherGrade = 'light'
await P.frames(1)
out.lightSand = layer.mist.geometry.instanceCount
ui.weather = 'clear'
await P.frames(2)
out.clearAgain = { hidden: !layer.group.visible, fog: fog() }
out.glError = P.glError()

// The Zones dialog: Elwynn Forest (12) rains 20% in spring and 15% in summer in the stock database.
ui.dialog = 'zones'
const elwynn = await P.until(() => [...(P.dialog('Zones')?.querySelectorAll('button') ?? [])].find((b) => b.textContent.startsWith('Elwynn Forest')), 30000, 'Elwynn Forest in the zone list')
elwynn.click()
const spring = await P.until(() => document.querySelector('.weather[data-zone="12"] input[aria-label="Rain chance in spring"]'), 30000, "Elwynn's weather sliders")
const summer = document.querySelector('.weather[data-zone="12"] input[aria-label="Rain chance in summer"]')
out.zones = { sliders: document.querySelectorAll('.weather input[type=range]').length, spring: Number(spring.value), summer: Number(summer.value) }
spring.value = '40'
spring.dispatchEvent(new Event('input', { bubbles: true }))
await P.frames(1)
const save = [...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Save'))
out.zones.save = save?.textContent
ui.dialog = null

const drew = (w) => w.visible && w.count > 0 && w.stormLight > 0.1 && w.drops > 0.001
out.ok =
	out.clearHidden &&
	drew(out.rain) &&
	drew(out.snow) &&
	drew(out.sand) &&
	out.snow.count > out.rain.count &&
	out.rain.fog[0] < clearFog[0] &&
	out.lightSand > 0 &&
	out.lightSand < out.sand.count &&
	out.clearAgain.hidden &&
	out.clearAgain.fog[0] === clearFog[0] &&
	!out.glError &&
	out.zones.sliders === 12 &&
	out.zones.spring === 20 &&
	out.zones.summer === 15 &&
	out.zones.save === 'Save (1)'
return out
