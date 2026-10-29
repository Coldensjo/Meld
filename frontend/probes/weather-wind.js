// The weather preview's wind (#244): a camera moving along +X leads the rain's box and tips the streaks' tails that way, and both settle when it stops (read after 0.3 s). The arithmetic (the 149 ms window, the lead's hold, the tilt angle) is unit-tested in tests/weather.test.ts; this checks the layer applies it. Split from weather-wind (#420).
// touches: frontend/src/lib/world/WeatherLayer.ts, frontend/src/lib/wow/weather.ts
await P.scene(P.BENCH)
await P.settle()
const e = P.e
const { prefs, ui } = await P.state()
await P.until(() => [...e.objects.batches.entries()].find(([k, b]) => k.includes('stormwind.wmo') && b.cull), 120_000, 'the Stormwind batch')
prefs.cameraFollowGround = false
ui.weather = 'rain'
ui.weatherGrade = 'heavy'
const layer = e.debug.weather
const out = {}
const ground = e.camera.position.clone().set(182, 0, 353)
ground.y = e.terrain.heightAt(ground.x, ground.z) + 1
e.setSceneView({ target: ground.toArray(), yaw: 0.5, pitch: 0.25, distance: 0.5, hour: 13 })
await P.frames(3)

// The wind: 2 yd a frame along +X, then still.
const lead = () => layer.rain.material.uniforms.lead.value.clone()
const tipX = () => {
	const t = layer.rain.material.uniforms.tilt.value.elements
	// Where the tilt takes straight up: the matrix's second column (elements are column-major); its x.
	return t[3]
}
for (let i = 0; i < 8; i++) {
	ground.x += 2
	e.setSceneView({ target: ground.toArray(), yaw: 0.5, pitch: 0.25, distance: 0.5, hour: 13 })
	await P.frames(1)
}
const moving = { speed: +layer.wind.speed.toFixed(2), lead: +lead().x.toFixed(2), leadZ: +lead().z.toFixed(2), tipX: +tipX().toFixed(3) }
// Still for 4 frames and at least 0.3 s, twice the wind's 149 ms window (#871: 4 of the GPU's frames are well inside it).
const stillFrom = performance.now()
await P.frames(4)
while (performance.now() - stillFrom < 300) await P.frames(1)
const still = { speed: +layer.wind.speed.toFixed(3), lead: +lead().x.toFixed(3), tipX: +tipX().toFixed(3) }
out.wind = { moving, still }

out.glError = P.glError()
ui.weather = 'clear'
await P.frames(1)

out.ok = moving.speed > 1 && moving.lead > 1 && Math.abs(moving.leadZ) < 0.5 && moving.tipX > 0.01 && still.speed < 0.01 && Math.abs(still.lead) < 0.01 && !out.glError
return out
