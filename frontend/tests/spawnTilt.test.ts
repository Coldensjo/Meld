// Run with: bun test tests/spawnTilt.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { spawnQuaternion } from '../src/lib/world/spawnTilt.ts'

/** Server axes to the editor's: editor (x, y, z) = server (-y, z, -x). */
const toEditorAxes = (v: THREE.Vector3) => new THREE.Vector3(-v.y, v.z, -v.x)
/** A model's own axes (Z up) to its mesh's (toEditor: (x, z, -y)). */
const modelToMesh = (v: THREE.Vector3) => new THREE.Vector3(v.x, v.z, -v.y)

/** The Hamilton product a*b of quaternions [x, y, z, w]. */
function mul(a: number[], b: number[]): number[] {
	return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]
}
const facing = (o: number) => [0, 0, Math.sin(o / 2), Math.cos(o / 2)]

/** Checks that the editor's rotation of a spawn turns each model axis where the server's quaternion does. */
function assertMatches(orientation: number, tilt: number[] | null, server: number[]) {
	const q = spawnQuaternion({ orientation, tilt }, new THREE.Quaternion())
	const sq = new THREE.Quaternion(server[0], server[1], server[2], server[3]).normalize()
	for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
		const want = toEditorAxes(axis.clone().applyQuaternion(sq))
		const got = modelToMesh(axis).applyQuaternion(q)
		assert.ok(got.distanceTo(want) < 1e-5, `axis ${axis.toArray()}: got ${got.toArray()}, want ${want.toArray()}`)
	}
}

test('an object that only turns is drawn at its facing', () => {
	for (const o of [0, 1, -2.28118, Math.PI]) assertMatches(o, null, facing(o))
})

test('a tilted object is drawn as its quaternion turns it, and turns about the up axis with its facing', () => {
	// The Sunken Chest, guid 42485 (#229), and its tilt relative to its facing as Go reads it.
	const o = -2.28118
	const q = [-0.118706, -0.071149, 0.899253, -0.414959]
	const tilt = mul(facing(-o), q)
	assertMatches(o, tilt, q)
	assertMatches(o + 1, tilt, mul(facing(1), q))
})
