// Run with: bun test tests/groundTilt.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { groundNormal, groundSlopeDeg, tiltToNormal } from '../src/lib/world/groundTilt.ts'
import { placementEuler } from '../src/lib/world/placement.ts'

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

test('flat ground has an upright normal and no tilt', () => {
	const n = groundNormal(() => 5, 10, 10, 2, true, { x: 0, y: 0, z: 0 })
	assert.deepEqual([n.x, n.y, n.z], [-0, 1, -0])
	const t = tiltToNormal(n.x, n.y, n.z, 1.2)
	near(t.tiltX, 0)
	near(t.tiltZ, 0)
})

test('a slope rising toward +x leans the normal toward -x', () => {
	const n = groundNormal((x) => x * 0.5, 10, 10, 2, false, { x: 0, y: 0, z: 0 })
	near(n.x, -0.5 / Math.hypot(0.5, 1))
	near(n.y, 1 / Math.hypot(0.5, 1))
	near(n.z, 0)
})

test('the tilts turn the model up axis onto the normal for any turn', () => {
	const normals = [new THREE.Vector3(0.3, 0.9, -0.2), new THREE.Vector3(-0.5, 0.7, 0.4), new THREE.Vector3(0, 0.8, 0.6)]
	for (const n of normals) {
		n.normalize()
		for (const rotY of [0, 0.7, -2.1, Math.PI]) {
			const { tiltX, tiltZ } = tiltToNormal(n.x, n.y, n.z, rotY)
			const up = new THREE.Vector3(0, 1, 0).applyEuler(placementEuler(new THREE.Euler(), rotY, tiltX, tiltZ))
			near(up.x, n.x, 1e-5)
			near(up.y, n.y, 1e-5)
			near(up.z, n.z, 1e-5)
		}
	}
})

test('a tilt written into a given object is the same, and is that object', () => {
	const out = { tiltX: 0, tiltZ: 0 }
	const n = { x: 0.3, y: 0.9, z: -0.2 }
	const len = Math.hypot(n.x, n.y, n.z)
	const got = tiltToNormal(n.x / len, n.y / len, n.z / len, 0.7, out)
	assert.equal(got, out)
	const want = tiltToNormal(n.x / len, n.y / len, n.z / len, 0.7)
	near(out.tiltX, want.tiltX)
	near(out.tiltZ, want.tiltZ)
})

test('the ground slope in degrees is 0 on the flat and the rise angle on a ramp', () => {
	assert.equal(
		groundSlopeDeg(() => 3, 5, 5, 2),
		0,
	)
	// Rising one unit per unit along x is a 45 degree slope, whichever way it is crossed.
	assert.ok(Math.abs(groundSlopeDeg((x) => x, 5, 5, 2) - 45) < 1e-6)
	assert.ok(Math.abs(groundSlopeDeg((_x, z) => -z, 5, 5, 2) - 45) < 1e-6)
	// A gentle 1 in 10 rise is under 6 degrees; a 3 in 1 wall is over 70.
	assert.ok(groundSlopeDeg((x) => x / 10, 0, 0, 2) < 6)
	assert.ok(groundSlopeDeg((x) => x * 3, 0, 0, 2) > 70)
})
