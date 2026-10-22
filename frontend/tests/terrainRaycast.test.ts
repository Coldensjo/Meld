// Run with: bun test tests/terrainRaycast.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { rayMarchGround } from '../src/lib/terrain/rayMarch.ts'

// Flat ground at y = 0 with a hole over world x and z 20..28. the ray-march runs on a stand-in ground.
function fake() {
	const cellSize = 2
	const size = 32
	const inHole = (x: number, z: number) => x >= 20 && x < 28 && z >= 20 && z < 28
	return {
		cellSize,
		worldSize: size * cellSize,
		contains: (x: number, z: number) => x >= 0 && z >= 0 && x <= size * cellSize && z <= size * cellSize,
		heightAt: () => 0,
		isHole: inHole,
	}
}

function cast(self: ReturnType<typeof fake>, from: THREE.Vector3, to: THREE.Vector3, solid = false) {
	const ray = new THREE.Ray(from.clone(), to.clone().sub(from).normalize())
	const out = new THREE.Vector3()
	const box = new THREE.Box3(new THREE.Vector3(0, -1e5, 0), new THREE.Vector3(0, 1e5, 0))
	const hit = rayMarchGround(self, box, new THREE.Vector3(), ray, out, 4000, solid)
	return hit ? out : null
}

test('a ray straight down through a hole passes it and finds nothing below', () => {
	const hit = cast(fake(), new THREE.Vector3(24, 20, 24), new THREE.Vector3(24, -20, 24))
	assert.equal(hit, null)
})

test('a slanted ray that enters a hole and leaves its cells under the ground does not hit the underside', () => {
	// Slope -2: over the hole from x 20, below the ground from x 23, and past the hole (x 28) at y -10.
	const hit = cast(fake(), new THREE.Vector3(18, 10, 24), new THREE.Vector3(30, -14, 24))
	assert.equal(hit, null)
})

test('a slanted ray that misses the hole still hits the ground', () => {
	const hit = cast(fake(), new THREE.Vector3(2, 10, 4), new THREE.Vector3(12, -10, 4))
	assert.ok(hit)
	assert.ok(Math.abs(hit.y) < 0.01)
})

test('solid makes holes ground', () => {
	const hit = cast(fake(), new THREE.Vector3(24, 20, 24), new THREE.Vector3(24, -20, 24), true)
	assert.ok(hit)
	assert.ok(Math.abs(hit.y) < 0.01)
})
