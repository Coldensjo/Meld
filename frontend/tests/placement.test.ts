// Run with: bun test tests/placement.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { placementEuler, stepTilt } from '../src/lib/world/placement.ts'

const turn = (rotY: number, tiltX: number, tiltZ: number) => new THREE.Matrix4().makeRotationFromEuler(placementEuler(new THREE.Euler(), rotY, tiltX, tiltZ))
const close = (a: THREE.Matrix4, b: THREE.Matrix4) => a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-9)

test("a placement turns as the client's: the heading, then -tilt about Z, then the roll about X", () => {
	for (const [y, a, c] of [
		[0.4, -0.17, 0.02],
		[-2.2, 0.3, -0.5],
		[3.1, 0, 0.8],
	]) {
		const want = new THREE.Matrix4().makeRotationY(y).multiply(new THREE.Matrix4().makeRotationZ(-a)).multiply(new THREE.Matrix4().makeRotationX(c))
		assert.ok(close(turn(y, a, c), want))
	}
})

test('the first angle leans the model forward or back, the third rolls it about the way it faces', () => {
	// A model faces +X in its own frame.
	const forward = new THREE.Vector3(1, 0, 0)
	const pitched = forward.clone().applyMatrix4(turn(0, 0.3, 0))
	assert.ok(Math.abs(pitched.y + Math.sin(0.3)) < 1e-9)
	const rolled = forward.clone().applyMatrix4(turn(0, 0, 0.3))
	assert.ok(rolled.distanceTo(forward) < 1e-9)
})

test('a hand tilt steps by whole notches, wraps past 180 degrees and lands back on 0 exactly', () => {
	const deg = (r: number) => Math.round((r * 1800) / Math.PI) / 10
	let a = 0
	for (let i = 0; i < 3; i++) a = stepTilt(a, 5)
	assert.equal(deg(a), 15)
	for (let i = 0; i < 3; i++) a = stepTilt(a, -5)
	assert.equal(a, 0)
	assert.equal(deg(stepTilt((175 * Math.PI) / 180, 10)), -175)
	assert.equal(deg(stepTilt((-175 * Math.PI) / 180, -5)), 180)
	// A random tilt off the notches keeps its offset and still steps by 5.
	assert.equal(deg(stepTilt(0.05, 5)), deg(0.05) + 5)
})
