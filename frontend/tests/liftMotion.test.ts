// Run with: bun test tests/liftMotion.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { isNear } from './support/near.ts'
import { defaultLiftFrames, liftOffset, liftPeriod, liftPoint, liftProblem, liftStops, type LiftFrame } from '../src/lib/world/liftMotion.ts'

const f = (time: number, z: number, x = 0): LiftFrame => ({ time, x, y: 0, z, seq: 0 })
// Benilla's elevators.rs test loop: waits 5 s, drops 10 yd in 5 s, comes back up in 20 s.
const loop = [f(0, 0), f(5000, 0), f(10000, -10), f(30000, 0)]

test('the offset waits, moves evenly between frames and wraps round the loop, as the client works it out', () => {
	const at = { x: 0, y: 0, z: 0 }
	assert.equal(liftPeriod(loop), 30000)
	assert.equal(liftOffset(loop, 2500, at).z, 0)
	assert.equal(liftOffset(loop, 7500, at).z, -5)
	assert.equal(liftOffset(loop, 10000, at).z, -10)
	assert.ok(isNear(liftOffset(loop, 20000, at).z, -5, 1e-9))
	assert.equal(liftOffset(loop, 37500, at).z, -5)
	assert.equal(liftOffset(loop, 30000, at).z, 0)
	assert.ok(isNear(liftOffset(loop, 29999, at).z, -0.0005, 1e-9))
})

test("an offset is turned by the spawn's facing into the editor's axes", () => {
	const out = new THREE.Vector3()
	// Facing 0: the server's +x is the editor's -z, +z is up.
	liftPoint({ x: 10, y: 5, z: 20, orientation: 0 }, { x: 3, y: 0, z: 7 }, out)
	assert.ok(isNear(out.x, 10, 1e-9) && isNear(out.y, 12, 1e-9) && isNear(out.z, 17, 1e-9), `${out.toArray()}`)
	// A quarter turn: the server's +x becomes its +y, the editor's -x.
	liftPoint({ x: 0, y: 0, z: 0, orientation: Math.PI / 2 }, { x: 3, y: 0, z: 0 }, out)
	assert.ok(isNear(out.x, -3, 1e-9) && isNear(out.y, 0, 1e-9) && isNear(out.z, 0, 1e-9), `${out.toArray()}`)
})

test('the stops are the runs of frames at one offset, with their waits', () => {
	const stops = liftStops(defaultLiftFrames(20))
	assert.deepEqual(
		stops.map((s) => [s.frame, s.wait, s.at.z]),
		[
			[0, 5000, 0],
			[2, 5000, 20],
		],
	)
	// Two waits in a row at one place make one stop.
	assert.deepEqual(
		liftStops([f(0, 0), f(1000, 0), f(3000, 0), f(4000, 5)]).map((s) => [s.frame, s.wait]),
		[[0, 3000]],
	)
})

test('a loop the client could not play is refused', () => {
	assert.equal(liftProblem(loop), '')
	assert.equal(liftProblem(defaultLiftFrames()), '')
	assert.notEqual(liftProblem([f(0, 0)]), '')
	assert.notEqual(liftProblem([f(10, 0), f(20, 1)]), '')
	assert.notEqual(liftProblem([f(0, 0), f(1000, 1), f(1000, 2)]), '')
	assert.notEqual(liftProblem([f(0, 0), f(1000, Number.NaN)]), '')
})
