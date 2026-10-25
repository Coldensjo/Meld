// Run with: bun test tests/dayNight.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { celestialSunDir, interpDayNight, lightingSunDir, moonDir, skyWarp, starAlpha, sunDiscScale } from '../src/lib/wow/dayNight.ts'

// These follow Benilla's daynight.rs tests of the client's DayNight tables.
const elev = (d: number[]) => (Math.asin(d[1] / Math.hypot(d[0], d[1], d[2])) * 180) / Math.PI
const heading = (d: number[]) => Math.atan2(d[0], d[2])

test('the table interpolation wraps through midnight', () => {
	const phi: Array<[number, number]> = [
		[0, 2.2165682],
		[0.25, 1.9198623],
		[0.5, 2.2165682],
		[0.75, 1.9198623],
	]
	assert.ok(Math.abs(interpDayNight(phi, 0) - 2.2165682) < 1e-6)
	assert.ok(Math.abs(interpDayNight(phi, 0.125) - 2.0682153) < 1e-4)
	assert.ok(Math.abs(interpDayNight(phi, 0.875) - 2.0682153) < 1e-4, 'between the last key and midnight')
})

test('the lighting sun never sets and keeps its bearing', () => {
	const noon = heading(lightingSunDir(720, [0, 0, 0]))
	for (let m = 0; m < 1440; m += 30) {
		const d = lightingSunDir(m, [0, 0, 0])
		const e = elev(d)
		assert.ok(e > 19 && e < 38, `elevation ${e} at minute ${m}`)
		assert.ok(Math.abs(heading(d) - noon) < 1e-6)
	}
	// It stands in the north-west: toward -z (north) and -x (west) in the editor's frame.
	const d = lightingSunDir(600, [0, 0, 0])
	assert.ok(d[0] < 0 && d[2] < 0)
})

test("the visible sun rises and sets on the lighting sun's bearing, the moon is up at night", () => {
	assert.ok(Math.abs(elev(celestialSunDir(720, [0, 0, 0])) - 85) < 1)
	assert.ok(Math.abs(elev(celestialSunDir(0, [0, 0, 0])) + 10) < 1)
	assert.ok(Math.abs(elev(celestialSunDir(480, [0, 0, 0])) - 27) < 2)
	assert.ok(Math.abs(heading(celestialSunDir(600, [0, 0, 0])) - heading(lightingSunDir(600, [0, 0, 0]))) < 1e-3)
	assert.ok(elev(celestialSunDir(600, [0, 0, 0])) > elev(lightingSunDir(600, [0, 0, 0])) + 15)
	assert.ok(moonDir(0, [0, 0, 0])[1] > 0.5)
	assert.ok(moonDir(720, [0, 0, 0])[1] < 0)
})

test('the dome warps only at dawn and dusk and only where the light says so, stars come out at night', () => {
	assert.equal(skyWarp(720, 1), 0)
	assert.ok(skyWarp(390, 1) > 0.99)
	assert.ok(skyWarp(1290, 1) > 0.99)
	assert.equal(skyWarp(390, 0), 0)
	assert.equal(starAlpha(0), 1)
	assert.equal(starAlpha(720), 0)
	assert.ok(starAlpha(23 * 60 + 15) > 0 && starAlpha(23 * 60 + 15) < 1)
	assert.ok(Math.abs(sunDiscScale(360) - 2) < 1e-3)
	assert.ok(Math.abs(sunDiscScale(720) - 1) < 1e-3)
})
