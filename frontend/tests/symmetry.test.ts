// Run with: bun test tests/symmetry.test.ts
// Symmetry painting (#182, lib/tools/symmetry.ts): the copies a mode makes, where a dab's copies land and
// merge, and that a model's copy faces the mirrored way (checked against the client's placement rotation).
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { IDENTITY, centerBuffers, eachMirror, mirrorDirection, mirrorHeading, mirrorPoint, mirrorRoll, mirrorsOf, snapCenter, symmetricCenters, unmirrorPoint, type MirrorDab, type SymmetryMode } from '../src/lib/tools/symmetry.ts'
import { imageWeight, setBrushImage, setBrushImageRotation, setBrushImageTransform } from '../src/lib/tools/brushImage.ts'
import { placementEuler } from '../src/lib/world/placement.ts'

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)

test('each mode makes its copies, the stroke itself first', () => {
	const counts: Record<SymmetryMode, number> = { off: 1, x: 2, z: 2, xz: 4, point: 2, radial: 4 }
	for (const [mode, n] of Object.entries(counts)) {
		const list = mirrorsOf(mode as SymmetryMode, 4)
		assert.equal(list.length, n, mode)
		assert.equal(list[0], IDENTITY)
	}
	assert.equal(mirrorsOf('radial', 6).length, 6)
	// The count is held to 2..8, and the same mode gives the same array.
	assert.equal(mirrorsOf('radial', 20).length, 8)
	assert.equal(mirrorsOf('radial', 1).length, 2)
	assert.equal(mirrorsOf('xz', 0), mirrorsOf('xz', 5))
})

test('Mirror X flips x about the centre, Mirror Z flips z, Point turns half way', () => {
	const out = [0, 0]
	mirrorPoint(mirrorsOf('x', 0)[1], 100, 100, 130, 90, out)
	assert.deepEqual(out, [70, 90])
	mirrorPoint(mirrorsOf('z', 0)[1], 100, 100, 130, 90, out)
	assert.deepEqual(out, [130, 110])
	mirrorPoint(mirrorsOf('point', 0)[1], 100, 100, 130, 90, out)
	near(out[0], 70)
	near(out[1], 110)
})

test('the radial copies lie evenly on the circle through the stroke, and unmirror takes each back', () => {
	const out = [0, 0]
	const back = [0, 0]
	const list = mirrorsOf('radial', 3)
	const angles = list.map((m) => {
		mirrorPoint(m, 50, 50, 60, 50, out)
		near(Math.hypot(out[0] - 50, out[1] - 50), 10)
		unmirrorPoint(m, 50, 50, out[0], out[1], back)
		near(back[0], 60)
		near(back[1], 50)
		return (Math.atan2(out[1] - 50, out[0] - 50) * 180) / Math.PI
	})
	const sorted = angles.map((a) => Math.round((a + 360) % 360)).sort((a, b) => a - b)
	assert.deepEqual(sorted, [0, 120, 240])
})

test("a model's copy faces the mirrored way: a model facing the centre faces it on every copy", () => {
	const out = [0, 0]
	for (const mode of ['x', 'z', 'xz', 'point', 'radial'] as SymmetryMode[]) {
		for (const m of mirrorsOf(mode, 5)) {
			// At (110, 100), facing the centre (100, 100): its forward (+x turned by rotY) points to -x.
			const rotY = Math.PI
			mirrorPoint(m, 100, 100, 110, 100, out)
			const r = mirrorHeading(m, rotY)
			const f = new THREE.Vector3(1, 0, 0).applyEuler(placementEuler(new THREE.Euler(), r))
			near(f.x, (100 - out[0]) / 10, 1e-9)
			near(f.z, (100 - out[1]) / 10, 1e-9)
		}
	}
})

test("a tilted model's copy is the model mirrored (for one that is the same on its left and right)", () => {
	// The copy of a model turned by Q is M Q L: the world mirror M, and L the model's own left-right
	// flip (z, since it faces +x), which leaves a model that is the same on both sides as it is.
	const L = new THREE.Matrix4().makeScale(1, 1, -1)
	for (const mode of ['x', 'z', 'xz', 'radial'] as SymmetryMode[]) {
		for (const m of mirrorsOf(mode, 3)) {
			const rotY = 0.7
			const tiltX = 0.2
			const tiltZ = -0.15
			const Q = new THREE.Matrix4().makeRotationFromEuler(placementEuler(new THREE.Euler(), rotY, tiltX, tiltZ))
			const M = new THREE.Matrix4().set(m.m00, 0, m.m01, 0, 0, 1, 0, 0, m.m10, 0, m.m11, 0, 0, 0, 0, 1)
			const want = M.clone().multiply(Q)
			if (m.flip) want.multiply(L)
			const got = new THREE.Matrix4().makeRotationFromEuler(placementEuler(new THREE.Euler(), mirrorHeading(m, rotY), tiltX, mirrorRoll(m, tiltZ)))
			for (let i = 0; i < 16; i++) near(got.elements[i], want.elements[i], 1e-9)
		}
	}
})

test("an angled plane's direction turns with the copy", () => {
	const x = mirrorsOf('x', 0)[1]
	near(Math.cos(mirrorDirection(x, 0)), -1)
	near(mirrorDirection(mirrorsOf('z', 0)[1], Math.PI / 2), -Math.PI / 2)
	assert.equal(mirrorDirection(IDENTITY, 0.3), 0.3)
})

test('copies of a dab that overlap merge into one at their mean, unless the tool sets values', () => {
	const { out, scratch } = centerBuffers()
	const xm = mirrorsOf('x', 0)
	// 2 yards from the axis with a 5-yard brush (the copies 4 apart): one dab on the axis.
	assert.equal(symmetricCenters(xm, 100, 100, 102, 40, 5, true, out, scratch), 1)
	near(out[0], 100)
	assert.equal(out[1], 40)
	assert.equal(out[2], 0)
	// Far from it: two dabs, the stroke's own at the cursor exactly.
	assert.equal(symmetricCenters(xm, 100, 100, 120, 40, 5, true, out, scratch), 2)
	assert.deepEqual([out[0], out[1], out[2], out[3], out[4], out[5]], [120, 40, 0, 80, 40, 1])
	// Without merging, the near copies both stay; only a copy on the same spot goes.
	assert.equal(symmetricCenters(xm, 100, 100, 103, 40, 5, false, out, scratch), 2)
	assert.equal(symmetricCenters(xm, 100, 100, 100, 40, 5, false, out, scratch), 1)
	// Mirror X and Z near the x axis only: the pairs across it merge, the two sides stay apart.
	assert.equal(symmetricCenters(mirrorsOf('xz', 0), 100, 100, 130, 102, 5, true, out, scratch), 2)
	// Radial on the centre: one dab.
	assert.equal(symmetricCenters(mirrorsOf('radial', 6), 100, 100, 100, 100, 5, true, out, scratch), 1)
})

test('eachMirror runs once at the hit with symmetry off, and at every copy with it on, on the ground there', () => {
	const ground = { worldSize: 200, heightAt: (x: number) => x / 10 }
	const seen: MirrorDab[] = []
	const hit = { x: 150, y: 99, z: 50 }
	eachMirror({ mode: 'off', count: 4, center: null }, ground, hit, 5, true, (d) => seen.push({ ...d }))
	assert.equal(seen.length, 1)
	assert.deepEqual([seen[0].x, seen[0].y, seen[0].z, seen[0].index], [150, 99, 50, 0])
	seen.length = 0
	eachMirror({ mode: 'x', count: 4, center: null }, ground, hit, 5, true, (d) => seen.push({ ...d }))
	assert.equal(seen.length, 2)
	// The stroke's own dab keeps the cursor's height; the copy (about the map's middle, x 100) stands on the ground.
	assert.equal(seen[0].y, 99)
	assert.deepEqual([seen[1].x, seen[1].y, seen[1].z, seen[1].index], [50, 5, 50, 1])
	seen.length = 0
	eachMirror({ mode: 'x', count: 4, center: { x: 140, z: 0 } }, ground, hit, 5, false, (d) => seen.push({ ...d }))
	assert.equal(seen[1].x, 130)
})

test('a picked centre snaps to the nearest half cell', () => {
	assert.deepEqual(snapCenter(10.3, 7.9, 2), { x: 10, z: 8 })
	assert.deepEqual(snapCenter(10.6, 7.4, 2), { x: 11, z: 7 })
})

test('a mirrored dab paints the brush image mirrored', () => {
	// White top-left: under Mirror X the copy's image is white top-right.
	setBrushImage(Uint8Array.from([255, 0, 0, 0]), 2, 2)
	setBrushImageTransform(0, mirrorsOf('x', 0)[1])
	assert.ok(imageWeight(7, -7, 10) > 0.99)
	assert.ok(imageWeight(-7, -7, 10) < 0.01)
	// A half turn's copy: white bottom-right.
	setBrushImageTransform(0, mirrorsOf('point', 0)[1])
	assert.ok(imageWeight(7, 7, 10) > 0.99)
	setBrushImageRotation(0)
	assert.ok(imageWeight(-7, -7, 10) > 0.99)
	setBrushImage(null)
})
