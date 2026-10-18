// Run with: bun test tests/taxiRoute.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { airPoint, CRUISE_HEIGHT, defaultRoute, flightAt, flightSeconds, FLIGHT_SPEED, routeLines, segmentLengths, splinePoint } from '../src/lib/world/taxiRoute.ts'
import { stopColor, underground } from '../src/lib/world/TaxiLayer.ts'

const line = [
	{ x: 0, y: 0, z: 0 },
	{ x: 100, y: 0, z: 0 },
	{ x: 200, y: 0, z: 0 },
]
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

test('the spline passes through every point and keeps a straight line straight', () => {
	const bent = [
		{ x: 0, y: 0, z: 0 },
		{ x: 50, y: 30, z: 10 },
		{ x: 120, y: 0, z: 40 },
		{ x: 160, y: -20, z: 0 },
	]
	const out = { x: 0, y: 0, z: 0 }
	for (let s = 0; s < bent.length - 1; s++) {
		splinePoint(bent, s, 0, out)
		assert.deepEqual(out, bent[s])
		splinePoint(bent, s, 1, out)
		assert.ok(near(out.x, bent[s + 1].x) && near(out.y, bent[s + 1].y) && near(out.z, bent[s + 1].z))
	}
	splinePoint(line, 0, 0.5, out)
	assert.ok(near(out.y, 0) && near(out.z, 0) && out.x > 0 && out.x < 100)
})

test("a flight's time is its curve's length at 32 yd/s, timed segment by segment", () => {
	const lengths = segmentLengths(line)
	assert.equal(lengths.length, 2)
	assert.ok(near(lengths[0] + lengths[1], 200, 1e-6))
	assert.ok(near(flightSeconds(line), 200 / FLIGHT_SPEED))
	const out = { x: 0, y: 0, z: 0 }
	assert.equal(flightAt(line, lengths, 0, out), true)
	assert.deepEqual(out, line[0])
	assert.equal(flightAt(line, lengths, 100 / FLIGHT_SPEED, out), true)
	assert.ok(near(out.x, 100, 1e-6))
	assert.equal(flightAt(line, lengths, 10, out), false)
	assert.deepEqual(out, line[2])
})

test('a route is drawn in pieces between its points', () => {
	const v = routeLines(line, 8)
	assert.equal(v.length, 2 * 8 * 6)
	assert.deepEqual(v.slice(0, 3), [0, 0, 0])
	assert.deepEqual(v.slice(-3), [200, 0, 0])
	assert.deepEqual(routeLines(line.slice(0, 1), 8), [])
})

test('a new route takes off from its first stop, cruises above and lands on its last', () => {
	const from = { x: 0, y: 0, z: 50 }
	const to = { x: 1000, y: 0, z: 80 }
	const r = defaultRoute(from, to)
	assert.equal(r.length, 4)
	assert.deepEqual(r[0], from)
	assert.deepEqual(r[3], to)
	assert.deepEqual(r[1], { x: 40, y: 0, z: 50 + CRUISE_HEIGHT })
	assert.deepEqual(r[2], { x: 960, y: 0, z: 80 + CRUISE_HEIGHT })
	// Two stops a few yards apart: no room to turn, just from one to the other.
	assert.equal(defaultRoute(from, { x: 0.5, y: 0, z: 50 }).length, 2)
})

test('a click puts a point on the level of the one before, or above the ground it hits first', () => {
	const origin = { x: 0, y: 100, z: 0 }
	const down = new THREE.Vector3(1, -1, 0).normalize()
	const level = airPoint(origin, down, 60, null)
	assert.ok(level && near(level.x, 40) && level.y === 60 && near(level.z, 0))
	// The ground (at y 80) comes before the level at 60: the point goes 10 yd over it.
	assert.deepEqual(airPoint(origin, down, 60, { x: 20, y: 80, z: 0 }), { x: 20, y: 90, z: 0 })
	// Looking up at a lower level never meets it.
	const up = new THREE.Vector3(1, 1, 0).normalize()
	assert.equal(airPoint(origin, up, 60, null), null)
	assert.deepEqual(airPoint(origin, up, 60, { x: 5, y: 105, z: 0 }), { x: 5, y: 115, z: 0 })
})

test('a route turns red where it runs under the ground, and a stop is coloured by its sides', () => {
	const lines = [0, 10, 0, 10, 10, 0, 10, 10, 0, 20, -5, 0]
	const c = underground(lines, () => 0, new THREE.Color(0, 0, 1))
	assert.deepEqual(c.slice(0, 3), [0, 0, 1])
	assert.notDeepEqual(c.slice(6, 9), [0, 0, 1])
	// Off the map (NaN ground) nothing is under it.
	assert.deepEqual(underground(lines, () => NaN, new THREE.Color(0, 0, 1)).slice(6, 9), [0, 0, 1])
	assert.notEqual(stopColor({ hordeMount: 0, allianceMount: 541 }), stopColor({ hordeMount: 2224, allianceMount: 0 }))
	assert.notEqual(stopColor({ hordeMount: 2224, allianceMount: 541 }), stopColor({ hordeMount: 0, allianceMount: 0 }))
})
