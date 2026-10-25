// Run with: bun test tests/weather.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectDensity, MAX_SETTLED, MAX_SPLASH, SETTLE_LIFE, settleRate, SPLASH_LIFE, splashRate, stormBlend, streakTilt, WEATHER_GRADE, weatherCounts, WeatherWind } from '../src/lib/wow/weather.ts'

test("a grade's drops start past a quarter, and its storm light is full from a quarter up", () => {
	assert.equal(effectDensity(0.2), 0)
	assert.ok(Math.abs(effectDensity(1) - 1) < 1e-9)
	assert.ok(effectDensity(WEATHER_GRADE.light) > 0)
	assert.equal(stormBlend('clear', 0.9), 0)
	assert.equal(stormBlend('rain', 0.125), 0.5)
	for (const g of Object.values(WEATHER_GRADE)) assert.equal(stormBlend('snow', g), 1)
})

test('the drops thicken with the grade, mist comes only past half density, and a sandstorm is all mist', () => {
	const light = weatherCounts('rain', effectDensity(WEATHER_GRADE.light))
	const heavy = weatherCounts('rain', effectDensity(WEATHER_GRADE.heavy))
	assert.ok(light.drops > 1000 && light.drops < heavy.drops && heavy.drops <= 32768)
	assert.equal(light.mist, 0)
	assert.ok(heavy.mist > 0 && heavy.mist <= 128)
	const snow = weatherCounts('snow', effectDensity(WEATHER_GRADE.heavy))
	assert.ok(snow.drops > heavy.drops && snow.drops <= 65536)
	const sand = weatherCounts('sand', effectDensity(WEATHER_GRADE.light))
	assert.equal(sand.drops, 0)
	assert.ok(sand.mist > 0)
	assert.deepEqual(weatherCounts('clear', 1), { drops: 0, mist: 0 })
})

test("the wind is the viewer's own motion over 149 ms, and a jump is not wind", () => {
	const wind = new WeatherWind()
	const dt = 1 / 60
	for (let i = 0; i < 30; i++) wind.update(8 * dt * i, 0, dt)
	assert.ok(Math.abs(wind.vx - 8) < 0.2 && Math.abs(wind.vz) < 1e-9, `vx ${wind.vx}`)
	// The box leads by 1.75 x the wind, held to 0.3 of its width.
	const out = { x: 0, z: 0 }
	wind.lead(130, out)
	assert.ok(Math.abs(out.x - 1.75 * wind.vx) < 1e-9)
	wind.lead(20, out)
	assert.ok(Math.abs(out.x - 6) < 1e-9)
	// Standing still, the average dies within the window.
	const x = 8 * dt * 29
	for (let i = 0; i < 12; i++) wind.update(x, 0, dt)
	assert.ok(wind.speed < 1e-9)
	// A 500 yd jump in a frame restarts the window rather than blowing at 30000 yd/s.
	wind.update(x + 500, 0, dt)
	assert.equal(wind.speed, 0)
})

test('the streaks tip up to 45 degrees at 30 yd/s, and the splashes fall only with rain', () => {
	assert.equal(streakTilt(0), 0)
	assert.ok(Math.abs(streakTilt(15) - Math.PI / 8) < 1e-9)
	assert.ok(Math.abs(streakTilt(90) - Math.PI / 4) < 1e-9)
	assert.equal(splashRate('snow', 1), 0)
	assert.equal(splashRate('rain', 0), 0)
	// Heavy rain: a few thousand a second, so at 0.25 s each about a thousand live, within the ring.
	const rate = splashRate('rain', effectDensity(WEATHER_GRADE.heavy))
	assert.ok(rate > 1000 && rate * SPLASH_LIFE < MAX_SPLASH, `rate ${rate}`)
})

test('snowflakes settle only with snow, and heavy snow keeps its settled flakes within the ring', () => {
	assert.equal(settleRate('rain', 1), 0)
	assert.equal(settleRate('snow', 0), 0)
	// The field is the box's ground, so every flake that lands settles: the spawn rate itself.
	const rate = settleRate('snow', effectDensity(WEATHER_GRADE.heavy))
	assert.ok(rate > 1000 && rate * SETTLE_LIFE < MAX_SETTLED, `rate ${rate}`)
	assert.ok(settleRate('snow', 1) * SETTLE_LIFE < MAX_SETTLED)
})
