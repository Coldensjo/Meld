// Run with: bun test tests/transportRoute.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { isNear } from './support/near.ts'
import { DOCK, previewTime, TransportMotion, type LegShape } from '../src/lib/world/transportRoute.ts'

// Two legs along x: map 0 from 0 to 2000 with a dock at 1000 (60 s), then a jump to map 1 from 5000
// to 7000 with a dock at 6000 (30 s). At 30 yd/s and 1 yd/s² a run speeds up over 450 yd.
const pt = (x: number, delay = 0) => ({ x, y: 0, z: 0, flags: delay ? DOCK : 0, delay })
const legs: LegShape[] = [
	{ mapId: 0, points: [pt(0), pt(1000, 60), pt(2000)] },
	{ mapId: 1, points: [pt(5000), pt(6000, 30), pt(7000)] },
]
const run = 2000 / 30 + 30

test('a run from dock to dock speeds up, cruises and slows down as the server times it', () => {
	const m = new TransportMotion(legs, 30, 1)
	assert.ok(isNear(m.length, 4000, 1e-6))
	assert.ok(isNear(m.runSeconds(2000), run, 1e-9))
	// Too short to reach full speed: up half way, down the rest.
	assert.ok(isNear(m.runSeconds(400), 2 * Math.sqrt(400), 1e-9))
	assert.ok(isNear(m.cycle, 60 + run + 30 + run, 1e-9))
	assert.ok(isNear(new TransportMotion(legs, 30, 0).cycle, 90 + 4000 / 30, 1e-9), 'no acceleration: full speed all the way')
})

test('the transport waits at a dock, jumps between legs and comes round again', () => {
	const m = new TransportMotion(legs, 30, 1)
	const at = { x: 0, y: 0, z: 0 }
	let w = m.at(0, at)
	assert.deepEqual([w.leg, w.docked, at.x], [0, true, 1000])
	w = m.at(59, at)
	assert.deepEqual([w.leg, w.docked, at.x], [0, true, 1000])
	// Half way through the run it is at the jump, and goes on from the next leg's start.
	w = m.at(60 + run / 2, at)
	assert.equal(w.leg, 1)
	assert.ok(isNear(at.x, 5000, 1e-3), `at the jump: ${at.x}`)
	// 15 s after leaving it has gone 0.5 * 1 * 15² yards (within a segment the curve's parameter runs evenly, as the server's does, so near).
	m.at(75, at)
	assert.ok(isNear(at.x, 1000 + 112.5, 10), `speeding up: ${at.x}`)
	w = m.at(60 + run + 10, at)
	assert.deepEqual([w.leg, w.docked], [1, true])
	assert.ok(isNear(at.x, 6000, 1e-6))
	m.at(m.cycle + 1, at)
	assert.equal(at.x, 1000, 'round again')
	assert.ok(isNear(m.heading(80), 0, 1e-6), 'heading along +x')
	assert.deepEqual(
		m.docks().map((d) => [d.leg, d.index, d.point.delay]),
		[
			[0, 1, 60],
			[1, 1, 30],
		],
	)
})

test("a map's stretches of the round trip, and the preview that plays only them", () => {
	const m = new TransportMotion(legs, 30, 1)
	// Map 1: from the jump (half way through the first run) to half way through the second.
	const on1 = m.windows(1)
	assert.equal(on1.length, 1)
	assert.ok(isNear(on1[0][0], 60 + run / 2, 1e-6) && isNear(on1[0][1], 60 + run + 30 + run / 2, 1e-6), JSON.stringify(on1))
	// Map 0's leg runs over the trip's start: its end is past the cycle.
	const [[a, b]] = m.windows(0)
	assert.ok(isNear(a, 60 + run + 30 + run / 2, 1e-6) && isNear(b, m.cycle + 60 + run / 2, 1e-6), `${a} ${b}`)
	assert.ok(isNear(previewTime([[a, b]], 0), a, 1e-9))
	assert.ok(isNear(previewTime([[a, b]], b - a + 10), a + 10, 1e-9), 'round again')
	assert.ok(isNear(previewTime(on1.concat([[400, 410]]), on1[0][1] - on1[0][0] + 5), 405, 1e-9), 'the next stretch')
	assert.ok(Number.isNaN(previewTime([], 3)))
	assert.deepEqual(m.windows(5), [])
	const at = { x: 0, y: 0, z: 0 }
	assert.equal(m.at(previewTime(m.windows(0), 1), at).leg, 0)
	// The stretch starts where the leg does, though the trip's distance there comes out a hair past the route's length.
	m.at(a, at)
	assert.ok(isNear(at.x, 0, 1e-3), `at the leg's start: ${at.x}`)
})
