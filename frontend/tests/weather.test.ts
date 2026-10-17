// Run with: node --import ./tests/register.mjs --test tests/weather.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectDensity, stormBlend, WEATHER_GRADE, weatherCounts } from '../src/lib/wow/weather.ts'

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
