// Run with: bun test tests/instanceCull.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { cullSpheres, doodadReach, instanceSphere, packMatrices, splitLod, type CullView } from '../src/lib/world/instanceCull.ts'

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

test('with a split, the instances in the camera view lead and the ones only a shadow needs follow (#15)', () => {
	const v = view()
	const other = new THREE.PerspectiveCamera(90, 1, 0.1, 1000)
	other.rotation.y = Math.PI // a shadow box behind the camera
	other.updateMatrixWorld()
	v.frustums.push(new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(other.projectionMatrix, other.matrixWorldInverse)))
	v.spheres = [new THREE.Sphere(new THREE.Vector3(100, 0, 0), 5)]
	const s = spheres([0, 0, 10, 1], [0, 0, -10, 1], [100, 0, 0, 1], [0, 0, -20, 1], [0, 0, 20, 1])
	const out: number[] = []
	const split = { view: 0 }
	assert.equal(cullSpheres(v, s, 5, out, [], -1, false, split), true)
	assert.deepEqual(out, [1, 3, 0, 2, 4])
	assert.equal(split.view, 2)
	assert.equal(cullSpheres(v, s, 5, out, [], -1, false, split), false, 'the same split is no change')
	// The camera turns to face the shadow box: the same rows, split the other way.
	const turned = { ...v, frustums: [v.frustums[1], v.frustums[0]] }
	assert.equal(cullSpheres(turned, s, 5, out, [], -1, false, split), true)
	assert.deepEqual(out, [0, 4, 1, 2, 3])
	assert.equal(split.view, 2)
	// Rows in the same order, only the split moved, is a change too.
	const twoAhead = spheres([0, 0, -10, 1], [0, 0, 10, 1])
	const o2: number[] = []
	const sp2 = { view: 0 }
	cullSpheres({ ...v, spheres: [] }, twoAhead, 2, o2, [], -1, false, sp2)
	assert.deepEqual([o2, sp2.view], [[0, 1], 1])
	const both = { ...v, spheres: [], frustums: [v.frustums[0], v.frustums[1]] }
	twoAhead[2] = -12
	twoAhead[6] = -11 // both now in view
	assert.equal(cullSpheres(both, twoAhead, 2, o2, [], -1, false, sp2), true)
	assert.deepEqual([o2, sp2.view], [[0, 1], 2])
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

test('the LOD split keeps the instances in view in the lead of each list and counts them', () => {
	// Rows 0 and 1 in view (0 near, 1 far), then 2 (near) and 3 (far) only for a shadow.
	const s = spheres([0, 0, -5, 1], [0, 0, -20, 1], [0, 0, 5, 1], [0, 0, 30, 1])
	const v = { ...view(), lodPx: 100 }
	const near: number[] = []
	const far: number[] = []
	const split = { near: 0, far: 0 }
	assert.equal(splitLod(v, s, [0, 1, 2, 3], near, far, [], [], 2, split), true)
	assert.deepEqual([near, far, split], [[0, 2], [1, 3], { near: 1, far: 1 }])
	assert.equal(splitLod(v, s, [0, 1, 2, 3], near, far, [], [], 2, split), false)
	assert.equal(splitLod(v, s, [0, 1, 2, 3], near, far, [], [], 1, split), true, 'the same lists with another split')
	assert.deepEqual(split, { near: 1, far: 0 })
})

test('in a WMO room only what a doorway shows is kept, the building itself always', () => {
	// A doorway straight ahead: the view narrowed to the middle tenth of the screen.
	const cam = new THREE.PerspectiveCamera(90, 1, 0.1, 1000)
	cam.updateMatrixWorld()
	const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
	const x0 = -0.1,
		x1 = 0.1,
		y0 = -0.1,
		y1 = 0.1
	const narrow = new THREE.Matrix4().set(2 / (x1 - x0), 0, 0, -(x0 + x1) / (x1 - x0), 0, 2 / (y1 - y0), 0, -(y0 + y1) / (y1 - y0), 0, 0, 1, 0, 0, 0, 0, 1).multiply(vp)
	const door = new THREE.Frustum().setFromProjectionMatrix(narrow)
	const s = spheres([0, 0, -50, 1], [30, 0, -50, 1], [-30, 0, -50, 1])
	const out: number[] = []
	cullSpheres({ ...view(), gate: [door] }, s, 3, out, [])
	assert.deepEqual(out, [0], 'only the one through the doorway')
	cullSpheres({ ...view(), gate: [door] }, s, 3, out, [], 2)
	assert.deepEqual(out, [0, 2], 'the exempt building stays')
	cullSpheres({ ...view(), gate: [] }, s, 3, out, [])
	assert.deepEqual(out, [], 'a sealed room shows none of the world')
	cullSpheres({ ...view(), gate: null }, s, 3, out, [])
	assert.deepEqual(out, [0, 1, 2], 'outside, no gate')
})

test("doodads are cut past the client's draw distance for their size, across the ground, only where the view asks", () => {
	assert.equal(doodadReach(0.3), 50)
	assert.equal(doodadReach(2), 125)
	assert.equal(doodadReach(5), 200)
	assert.equal(doodadReach(8), Infinity)
	// In front of the camera (down -z), each a little inside or past its reach plus its radius; the
	// tree has none. The first candle stands 30 yards up, which the cut ignores as the client does.
	const s = spheres([0, 30, -50, 0.3], [0, 0, -51, 0.3], [0, 0, -126, 2], [0, 0, -128, 2], [0, 0, -204, 5], [0, 0, -206, 5], [0, 0, -900, 8])
	const out: number[] = []
	const v = { ...view(), doodadReach: true }
	cullSpheres(v, s, 7, out, [], -1, true)
	assert.deepEqual(out, [0, 2, 4, 6])
	cullSpheres(v, s, 7, out, [], -1, false)
	assert.deepEqual(out, [0, 1, 2, 3, 4, 5, 6], 'a batch that is not doodads keeps them all')
	cullSpheres(view(), s, 7, out, [], -1, true)
	assert.deepEqual(out, [0, 1, 2, 3, 4, 5, 6], 'a view without the reach keeps them all')
})
