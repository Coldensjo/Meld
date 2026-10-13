// Run with: node --import ./tests/register.mjs --test tests/instanceCull.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { cullSpheres, instanceSphere, packMatrices, splitLod, type CullView } from '../src/lib/world/instanceCull.ts'

/** A camera at the origin looking down -z with a 90 degree view, and the view it makes. */
function view(cutoffPx = 0): CullView {
  const cam = new THREE.PerspectiveCamera(90, 1, 0.1, 1000)
  cam.updateMatrixWorld()
  const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
  return { frustums: [f], eye: cam.position.clone(), pxPerUnit: 500, cutoffPx }
}

const spheres = (...s: number[][]) => Float32Array.from(s.flat())

test('instances in front of the camera are kept and the ones behind or beside it are not', () => {
  const s = spheres([0, 0, -10, 1], [0, 0, 10, 1], [50, 0, -10, 1], [-9, 0, -10, 2])
  const out: number[] = []
  assert.equal(cullSpheres(view(), s, 4, out, []), true)
  assert.deepEqual(out, [0, 3], 'the one beside the view edge is kept by its radius')
})

test('an unchanged set reports no change, and a changed one is written', () => {
  const s = spheres([0, 0, -10, 1], [0, 0, 10, 1])
  const out: number[] = []
  const scratch: number[] = []
  assert.equal(cullSpheres(view(), s, 2, out, scratch), true)
  assert.deepEqual(out, [0])
  assert.equal(cullSpheres(view(), s, 2, out, scratch), false)
  assert.deepEqual(out, [0])
  s[2] = 10 // the first moves behind the camera
  assert.equal(cullSpheres(view(), s, 2, out, scratch), true)
  assert.deepEqual(out, [])
})

test('a second frustum keeps what the first would drop', () => {
  const v = view()
  const other = new THREE.PerspectiveCamera(90, 1, 0.1, 1000)
  other.rotation.y = Math.PI // looks down +z
  other.updateMatrixWorld()
  v.frustums.push(new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(other.projectionMatrix, other.matrixWorldInverse)))
  const out: number[] = []
  cullSpheres(v, spheres([0, 0, -10, 1], [0, 0, 10, 1], [10, 0, 0, 1]), 3, out, [])
  assert.deepEqual(out, [0, 1])
})

test('a shadowed light keeps the models within its reach, out of view or not', () => {
  const v = view()
  v.spheres = [new THREE.Sphere(new THREE.Vector3(0, 0, 20), 5)]
  const out: number[] = []
  cullSpheres(v, spheres([0, 0, -10, 1], [0, 0, 24, 2], [0, 0, 40, 1]), 3, out, [])
  assert.deepEqual(out, [0, 1])
})

test('the cutoff drops models too small on screen, never one the camera is inside', () => {
  // At 500 px per unit, a radius-1 model 100 units away covers 10 px; at 1000 units, 1 px.
  const s = spheres([0, 0, -100, 1], [0, 0, -1000, 1], [0, 0, 0, 5])
  const out: number[] = []
  cullSpheres(view(2), s, 3, out, [])
  assert.deepEqual(out, [0, 2])
  cullSpheres(view(0), s, 3, out, [])
  assert.deepEqual(out, [0, 1, 2], 'no cutoff keeps them all')
})

test('instance spheres follow the placement, and packing copies the chosen matrices', () => {
  const g = new THREE.SphereGeometry(2)
  const m = new THREE.Matrix4().compose(new THREE.Vector3(10, 0, 0), new THREE.Quaternion(), new THREE.Vector3(3, 1, 1))
  const out = new Float32Array(8)
  instanceSphere(g, m, out, 4)
  assert.deepEqual([...out.subarray(4)], [10, 0, 0, 6])
  const all = new Float32Array(48)
  for (let i = 0; i < 48; i++) all[i] = i
  const into = new Float32Array(48)
  packMatrices(all, [2, 0], into)
  assert.deepEqual([...into.subarray(0, 16)], [...all.subarray(32, 48)])
  assert.deepEqual([...into.subarray(16, 32)], [...all.subarray(0, 16)])
})

test('instances small on screen go to the LOD, and an unchanged split reports no change', () => {
  // At 500 px per unit, a radius-1 sphere covers 100 px at a distance of 10.
  const s = spheres([0, 0, -5, 1], [0, 0, -20, 1], [0, 0, -0.5, 1])
  const v = { ...view(), lodPx: 100 }
  const near: number[] = []
  const far: number[] = []
  assert.equal(splitLod(v, s, [0, 1, 2], near, far, [], []), true)
  assert.deepEqual(near, [0, 2], 'the camera inside a model always draws it in full')
  assert.deepEqual(far, [1])
  assert.equal(splitLod(v, s, [0, 1, 2], near, far, [], []), false)
  v.eye.set(0, 0, -18)
  assert.equal(splitLod(v, s, [0, 1, 2], near, far, [], []), true)
  assert.deepEqual(near, [1])
  assert.deepEqual(far, [0, 2])
  assert.equal(splitLod({ ...v, lodPx: 0 }, s, [0, 1, 2], near, far, [], []), true)
  assert.deepEqual(far, [], 'no LOD without a threshold')
})
