// Run with: bun test tests/shadowReach.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
	addShadowReach,
	castsNear,
	clearNearCasters,
	clearShadowReach,
	cullForShadows,
	instancesMeet,
	markShadowMoving,
	materialsNear,
	packedCount,
	POSED_LAYER,
	setFarCascade,
	setNearCascade,
	setNearStill,
	setPacked,
} from '../src/lib/world/shadowReach.ts'

/** An InstancedMesh of unit boxes drawing one instance at each of `at`. */
function batch(...at: Array<[number, number, number]>): THREE.InstancedMesh {
	const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), at.length)
	at.forEach(([x, y, z], i) => m.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, z)))
	return m
}

/** A point light at `pos` reaching `distance`, with its shadow's frustum set to the cube face looking down -z. */
function light(pos: [number, number, number], distance: number): THREE.PointLight {
	const l = new THREE.PointLight(0xffffff, 1, distance)
	l.position.set(...pos)
	const cam = new THREE.PerspectiveCamera(90, 1, 0.5, distance)
	cam.position.set(...pos)
	cam.lookAt(pos[0], pos[1], pos[2] - 1)
	cam.updateMatrixWorld()
	l.shadow.getFrustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
	return l
}

test('a batch joins a shadow face only with an instance in the light reach and the face', () => {
	clearShadowReach()
	const l = light([0, 0, 0], 10)
	addShadowReach(l)
	const f = l.shadow.getFrustum()
	assert.equal(instancesMeet(batch([0, 0, -5]), f), true, 'in reach, in front of the face')
	assert.equal(instancesMeet(batch([0, 0, 5]), f), false, 'in reach, behind the face')
	assert.equal(instancesMeet(batch([0, 0, -30], [200, 0, 0]), f), false, 'beyond the reach')
	assert.equal(instancesMeet(batch([200, 0, 0], [0, 0, -5]), f), true, 'one instance is enough')
	// An instance just outside the reach whose box still meets it counts.
	assert.equal(instancesMeet(batch([0, 0, -10.6]), f), true)
})

test('only the instances drawn count, and any other frustum keeps every batch with one in view', () => {
	clearShadowReach()
	const l = light([0, 0, 0], 10)
	addShadowReach(l)
	const b = batch([200, 0, 0], [0, 0, -5])
	b.count = 1
	assert.equal(instancesMeet(b, l.shadow.getFrustum()), false)
	assert.equal(instancesMeet(b, new THREE.Frustum()), true)
	clearShadowReach()
	assert.equal(instancesMeet(b, l.shadow.getFrustum()), true, 'a light no longer registered culls nothing')
})

test('the scene pass skips a batch with nothing in view, the shadow passes draw what is packed for them (#15)', () => {
	clearShadowReach()
	const l = light([0, 0, 0], 10)
	addShadowReach(l)
	const far = new THREE.Frustum()
	setFarCascade(far)
	// Two instances packed, the one in view first; then none in view, one only a shadow needs.
	const b = batch([200, 0, 0], [0, 0, -5])
	setPacked(b, 2, 1)
	assert.deepEqual([b.count, packedCount(b)], [1, 2])
	assert.equal(instancesMeet(b, l.shadow.getFrustum()), true, "the light's face meets the second, packed for the shadows")
	setPacked(b, 1, 0)
	assert.equal(instancesMeet(b, new THREE.Frustum()), false, 'the scene pass: nothing in view')
	assert.equal(instancesMeet(b, far), true, 'the far cascade keeps it')
	setPacked(b, 0, 0)
	assert.equal(instancesMeet(b, far), false)
	setFarCascade(null)
	clearShadowReach()
})

test('the near cascade draws a batch only with a drawn instance in its box', () => {
	clearShadowReach()
	const cam = new THREE.OrthographicCamera(-50, 50, 50, -50, 0, 200)
	cam.position.set(0, 100, 0)
	cam.lookAt(0, 0, 0)
	cam.updateMatrixWorld()
	const near = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
	assert.equal(instancesMeet(batch([300, 0, 0]), near), true, 'not registered: kept')
	setNearCascade(near)
	assert.equal(instancesMeet(batch([300, 0, 0]), near), false, 'outside the box')
	assert.equal(instancesMeet(batch([300, 0, 0], [10, 0, 10]), near), true, 'one instance is enough')
	assert.equal(instancesMeet(batch([50.4, 0, 0]), near), true, 'a box overlapping the edge counts')
	const b = batch([300, 0, 0], [10, 0, 10])
	b.count = 1
	assert.equal(instancesMeet(b, near), false, 'only the drawn instances count')
	assert.equal(instancesMeet(b, new THREE.Frustum()), true, 'another frustum keeps it')
	setNearCascade(null)
	assert.equal(instancesMeet(b, near), true, 'without shadows nothing is culled')
})

test('a moving batch in the near box is noted, keeps out of the still pass and is on the posed layer', () => {
	clearShadowReach()
	const cam = new THREE.OrthographicCamera(-50, 50, 50, -50, 0, 200)
	cam.position.set(0, 100, 0)
	cam.lookAt(0, 0, 0)
	cam.updateMatrixWorld()
	const near = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
	setNearCascade(near)
	clearNearCasters()
	const skeleton = new THREE.Skeleton([])
	const posed = Object.assign(batch([10, 0, 10]), { skeleton })
	cullForShadows(posed)
	const fading = new THREE.MeshBasicMaterial()
	markShadowMoving(fading)
	const faded = batch([0, 0, 0])
	faded.material = [new THREE.MeshBasicMaterial(), fading]
	cullForShadows(faded)
	const still = batch([0, 0, 0])
	cullForShadows(still)
	const only = new THREE.Layers()
	only.set(POSED_LAYER)
	assert.equal(posed.layers.test(only) && faded.layers.test(only), true, 'moving batches are on the posed layer')
	assert.equal(still.layers.test(only), false, 'a still batch is not')
	assert.equal(posed.layers.test(new THREE.Layers()), true, 'and still on the default one')
	assert.equal(castsNear(skeleton) || materialsNear(), false)
	setNearStill(true)
	assert.equal(posed.intersectsFrustum(near), false, 'the still pass leaves a posed batch out')
	assert.equal(faded.intersectsFrustum(near), false, 'and one with a moving material')
	assert.equal(still.intersectsFrustum(near), true, 'but draws a still one')
	assert.equal(castsNear(skeleton) && materialsNear(), true, 'both are noted all the same')
	setNearStill(false)
	assert.equal(posed.intersectsFrustum(near), true, 'the moving pass draws it')
	clearNearCasters()
	assert.equal(castsNear(skeleton) || materialsNear(), false, 'a redraw forgets them')
	setNearCascade(null)
})
