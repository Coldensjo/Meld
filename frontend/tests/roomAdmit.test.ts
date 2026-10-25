// Run with: bun test tests/roomAdmit.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { RoomAdmit } from '../src/lib/world/roomAdmit.ts'
import { cullSpheres, type CullView } from '../src/lib/world/instanceCull.ts'
import type { WmoNav, WmoNavGroup } from '../src/lib/world/wmoRoom.ts'

function group(min: number[], max: number[]): WmoNavGroup {
	return { flags: 0, min: min as [number, number, number], max: max as [number, number, number], refStart: 0, refCount: 0, fogs: [0, 0, 0, 0], name: '' }
}

/** A floor from x0 to x1 (|y| up to 10) at height 0, in WoW axes. */
function floor(x0: number, x1: number): Float32Array {
	return Float32Array.from([x0, -10, 0, x1, -10, 0, x1, 10, 0, x0, -10, 0, x1, 10, 0, x0, 10, 0])
}

/** Two rooms side by side: group 0 from x -10 to 10, group 1 from x 20 to 40. */
const nav: WmoNav = {
	groups: [group([-10, -10, 0], [10, 10, 5]), group([20, -10, 0], [40, 10, 5])],
	portalVerts: [],
	portals: [],
	refs: [],
	fogs: [],
	walk: [floor(-10, 10), floor(20, 40)],
	camera: [new Float32Array(0), new Float32Array(0)],
}

/** A sphere at an editor-space point; WoW (x, y, z) is editor (x, z, -y). */
const at = (x: number, y: number, z: number) => new THREE.Sphere(new THREE.Vector3(x, y, z), 0.5)

test('a sphere in a room the flood reached is admitted, one in another room or outside is not', () => {
	const admit = new RoomAdmit()
	admit.set(nav, new THREE.Matrix4(), Uint8Array.from([1, 0]), () => null)
	assert.equal(admit.admits(at(0, 1, 0)), true, 'in the reached room')
	assert.equal(admit.admits(at(30, 1, 0)), false, 'in a room the flood did not reach')
	assert.equal(admit.admits(at(100, 1, 0)), false, 'outside the building')
	admit.set(nav, new THREE.Matrix4(), Uint8Array.from([1, 1]), () => null)
	assert.equal(admit.admits(at(30, 1, 0)), true, 'the flood reached it this frame')
})

test('the placement moves the rooms, and ground above the floor is outside', () => {
	const admit = new RoomAdmit()
	admit.set(nav, new THREE.Matrix4(), Uint8Array.from([1, 0]), () => null)
	assert.equal(admit.admits(at(100, 1, 0)), false)
	admit.set(nav, new THREE.Matrix4().makeTranslation(100, 0, 0), Uint8Array.from([1, 0]), () => null)
	assert.equal(admit.admits(at(100, 1, 0)), true, 'the cache starts over for a new placement')
	admit.set(nav, new THREE.Matrix4().makeTranslation(200, 0, 0), Uint8Array.from([1, 0]), () => 0.5)
	assert.equal(admit.admits(at(200, 1, 0)), false, 'terrain between the floor and the point')
})

test('the gate keeps what stands in a reached room even with no doorway in view', () => {
	const cam = new THREE.PerspectiveCamera(90, 1, 0.1, 1000)
	cam.updateMatrixWorld()
	const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
	const admit = new RoomAdmit()
	// The building stands in front of the camera, its first room around (0, 0, -50).
	admit.set(nav, new THREE.Matrix4().makeTranslation(0, 0, -50), Uint8Array.from([1, 0]), () => null)
	const view: CullView = { frustums: [f], eye: cam.position.clone(), pxPerUnit: 500, cutoffPx: 0, gate: [], gateAdmits: (s) => admit.admits(s) }
	const s = Float32Array.from([0, 1, -50, 0.5, 30, 1, -50, 0.5])
	const out: number[] = []
	cullSpheres(view, s, 2, out, [])
	assert.deepEqual(out, [0], "the one in the camera's room, not the one in the room beyond the wall")
})
