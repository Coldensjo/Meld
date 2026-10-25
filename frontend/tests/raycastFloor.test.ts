// Run with: bun test tests/raycastFloor.test.ts
// A floor ray passes ceilings and walls and stops on a surface facing up (#660).
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { Terrain } from '../src/lib/terrain/Terrain.ts'

const { ObjectLayer } = await import('../src/lib/world/ObjectLayer.ts')

const terrain = { heightAt: () => 0 } as unknown as Terrain

/** A 4-yard helper cube standing at (10, 10), so its faces are at y 0 and 4 and x and z 8 and 12. */
function cube() {
	const L = new ObjectLayer(terrain)
	L.add({ type: 'helper:cube:4', x: 10, z: 10, yOff: 0, rotY: 0, scale: 1 })
	L.group.updateMatrixWorld(true)
	// Drawn (packed into the instance buffer) as in a frame, seen by a camera that holds the whole map.
	L.update()
	const cam = new THREE.OrthographicCamera(-1000, 1000, 1000, -1000, -1000, 1000)
	cam.updateMatrixWorld()
	L.cull({ frustums: [new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))], eye: new THREE.Vector3(10, 50, 10), pxPerUnit: 1000, cutoffPx: 0 })
	return L
}

const ray = (from: [number, number, number], dir: [number, number, number]) => new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...dir).normalize())

test('a ray from above stops on the top, the surface facing up', () => {
	const hit = cube().raycastFloor(ray([10, 9, 10], [0, -1, 0]))
	assert.ok(hit)
	assert.ok(Math.abs(hit.point.y - 4) < 1e-3, `top at ${hit.point.y}`)
})

test('a ray from below meets only the bottom, a ceiling seen from under it, so no floor', () => {
	const L = cube()
	const up = ray([10, -2, 10], [0, 1, 0])
	assert.ok(L.raycastSurface(up), 'the bottom is a surface')
	assert.equal(L.raycastFloor(up), null)
})

test('a level ray meets only a wall, so no floor', () => {
	const L = cube()
	const level = ray([0, 2, 10], [1, 0, 0])
	assert.ok(L.raycastSurface(level), 'the wall is a surface')
	assert.equal(L.raycastFloor(level), null)
})
