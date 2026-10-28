// Run with: bun test tests/screenBox.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { nearScreenBox } from '../src/lib/world/screenBox.ts'

/** A camera 20 yd back on +Z looking at the origin, over a 1000 by 600 view. */
function view() {
	const camera = new THREE.PerspectiveCamera(60, 1000 / 600, 0.1, 1000)
	camera.position.set(0, 0, 20)
	camera.lookAt(0, 0, 0)
	camera.updateMatrixWorld()
	return camera
}
const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))

test('a click on the box, or within the margin of it, is near; one farther out is not', () => {
	const camera = view()
	assert.ok(nearScreenBox(box, camera, 1000, 600, 500, 300, 24), 'the centre')
	// The box spans about 50 px either side of the centre at this distance.
	const edge = new THREE.Vector3(1, 0, 1).project(camera)
	const right = ((edge.x + 1) / 2) * 1000
	assert.ok(nearScreenBox(box, camera, 1000, 600, right + 20, 300, 24), 'just outside, within the margin')
	assert.ok(!nearScreenBox(box, camera, 1000, 600, right + 30, 300, 24), 'beyond the margin')
})

test('a box behind the camera is never near', () => {
	const camera = view()
	const behind = box.clone().translate(new THREE.Vector3(0, 0, 40))
	assert.ok(!nearScreenBox(behind, camera, 1000, 600, 500, 300, 24))
})
