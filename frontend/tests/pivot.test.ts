// Run with: bun test tests/pivot.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { meanPivot, turnAbout } from '../src/lib/world/pivot.ts'

test('the pivot is the mean of the positions', () => {
	assert.deepEqual(
		meanPivot([
			{ x: 0, z: 0 },
			{ x: 10, z: 4 },
			{ x: 2, z: 8 },
		]),
		{ x: 4, z: 4 },
	)
	assert.deepEqual(meanPivot([]), { x: 0, z: 0 })
})

test('turning about the pivot keeps each model as far from it and matches a yaw turn', () => {
	const p = turnAbout(10, 0, 0, 0, Math.PI / 2)
	assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.z + 10) < 1e-9, `${p.x}, ${p.z}`)
	// The same turn as three.js gives a point for a rotation about +Y, so a model's own yaw and its
	// place in the group turn the same way.
	const v = new THREE.Vector3(3, 0, 7).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.7)
	const q = turnAbout(3 + 5, 7 - 2, 5, -2, 0.7)
	assert.ok(Math.abs(q.x - (v.x + 5)) < 1e-9 && Math.abs(q.z - (v.z - 2)) < 1e-9)
	assert.ok(Math.abs(Math.hypot(q.x - 5, q.z + 2) - Math.hypot(3, 7)) < 1e-9, 'the distance to the pivot is kept')
})
