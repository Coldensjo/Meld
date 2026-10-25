// Run with: bun test tests/heightField.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { heightAt } from '../src/lib/terrain/heightField.ts'
import { rayMarchGround } from '../src/lib/terrain/rayMarch.ts'

const size = 8
const cellSize = 2
const V = size + 1

// A cliff: ground 0 for x < 8 (vertex columns 0..4), 10 from column 5 on.
function cliff() {
	const h = new Float32Array(V * V)
	for (let z = 0; z < V; z++) for (let x = 5; x < V; x++) h[z * V + x] = 10
	return h
}

function ground(h: Float32Array) {
	return {
		cellSize,
		worldSize: size * cellSize,
		contains: (x: number, z: number) => x >= 0 && z >= 0 && x <= size * cellSize && z <= size * cellSize,
		heightAt: (x: number, z: number) => heightAt(h, size, cellSize, x, z),
		isHole: () => false,
	}
}

function cast(h: Float32Array, from: THREE.Vector3, dir: THREE.Vector3) {
	const ray = new THREE.Ray(from.clone(), dir.clone().normalize())
	const out = new THREE.Vector3()
	const box = new THREE.Box3(new THREE.Vector3(0, -1e5, 0), new THREE.Vector3(0, 1e5, 0))
	return rayMarchGround(ground(h), box, new THREE.Vector3(), ray, out, 4000, false) ? out : null
}

test('heightAt is bilinear between the four vertices of a cell', () => {
	const h = new Float32Array(V * V)
	h[0] = 0
	h[1] = 4
	h[V] = 8
	h[V + 1] = 12
	assert.equal(heightAt(h, size, cellSize, 0, 0), 0)
	assert.equal(heightAt(h, size, cellSize, 2, 0), 4)
	assert.equal(heightAt(h, size, cellSize, 0, 2), 8)
	assert.equal(heightAt(h, size, cellSize, 2, 2), 12)
	assert.equal(heightAt(h, size, cellSize, 1, 1), 6)
})

test('heightAt clamps outside the map to the edge', () => {
	const h = cliff()
	assert.equal(heightAt(h, size, cellSize, -50, 3), 0)
	assert.equal(heightAt(h, size, cellSize, 500, 3), 10)
	assert.equal(heightAt(h, size, cellSize, 16, 16), 10)
})

test('a ray down the face of a cliff hits it at the top edge, not through it', () => {
	// Falls at a slant from above the high ground, landing on it.
	const hit = cast(cliff(), new THREE.Vector3(14, 20, 4), new THREE.Vector3(-0.1, -1, 0))
	assert.ok(hit)
	assert.ok(Math.abs(hit.y - heightAt(cliff(), size, cellSize, hit.x, hit.z)) < 0.05)
	assert.ok(hit.y > 9)
})

test('a low ray running into the cliff hits its face', () => {
	const hit = cast(cliff(), new THREE.Vector3(1, 3, 4), new THREE.Vector3(1, 0, 0))
	assert.ok(hit)
	assert.ok(hit.x > 8 && hit.x < 10.5)
	assert.ok(hit.y < 10)
})

test('a ray from outside the box finds the ground inside it', () => {
	const hit = cast(cliff(), new THREE.Vector3(-30, 5, 4), new THREE.Vector3(1, -0.2, 0))
	assert.ok(hit)
	assert.ok(hit.x >= 0 && hit.x <= 16)
})

test('a ray to the sky and one passing beside the map find nothing', () => {
	assert.equal(cast(cliff(), new THREE.Vector3(4, 5, 4), new THREE.Vector3(0, 1, 0)), null)
	assert.equal(cast(cliff(), new THREE.Vector3(-30, 50, 4), new THREE.Vector3(0, -1, 0)), null)
})
