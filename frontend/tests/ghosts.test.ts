// Run with: bun test tests/ghosts.test.ts
import './runes.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { GhostPool } from '../src/lib/tools/ghosts.ts'
import type { ModelAsset } from '../src/lib/models/assets.ts'

function asset(geometry = new THREE.BufferGeometry()): ModelAsset {
	return { geometry, material: new THREE.MeshBasicMaterial(), bbox: new THREE.Box3(), ready: true, effects: [], emitters: [], ribbons: [] } as unknown as ModelAsset
}

test('grow adds empty ghosts to the group and never shrinks', () => {
	const pool = new GhostPool()
	pool.grow(3)
	pool.grow(1)
	assert.equal(pool.length, 3)
	assert.equal(pool.group.children.length, 3)
	assert.equal(pool.at(0).renderOrder, 20)
})

test('show swaps the mesh only when the geometry changes, and keeps the slot in the group', () => {
	const pool = new GhostPool(false)
	pool.grow(2)
	const a = asset()
	const first = pool.show(0, a)
	assert.equal(first.geometry, a.geometry)
	assert.equal(first.matrixAutoUpdate, false)
	assert.equal(pool.show(0, a), first, 'the same asset keeps the mesh')
	assert.equal(pool.show(0, asset(a.geometry)), first, 'another asset on the same geometry keeps it too')
	const b = asset()
	const second = pool.show(0, b)
	assert.notEqual(second, first)
	assert.equal(pool.at(0), second)
	assert.equal(pool.group.children.length, 2)
	assert.ok(!pool.group.children.includes(first))
})

test('hideAll hides every ghost, and attach and detach move the group in and out of the scene', () => {
	const pool = new GhostPool()
	pool.grow(2)
	pool.hideAll()
	assert.ok(!pool.at(0).visible && !pool.at(1).visible)
	const scene = new THREE.Scene()
	pool.attach(scene)
	assert.equal(pool.group.parent, scene)
	pool.detach(scene)
	assert.equal(pool.group.parent, null)
})
