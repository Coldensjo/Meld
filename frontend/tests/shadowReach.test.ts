// Run with: bun test tests/shadowReach.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { addShadowReach, clearShadowReach, instancesMeet } from '../src/lib/world/shadowReach.ts'

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

test('only the instances drawn count, and any other frustum keeps every batch', () => {
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
