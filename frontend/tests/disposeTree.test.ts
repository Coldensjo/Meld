// Run with: bun test tests/disposeTree.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { disposeTree } from '../src/lib/engine/disposeTree.ts'

/** Counts the dispose events a resource fires. */
function watch(r: THREE.EventDispatcher<{ dispose: object }>): { n: number } {
	const c = { n: 0 }
	r.addEventListener('dispose', () => c.n++)
	return c
}

test('disposeTree frees each geometry, shared material and map once, and leaves a sprite its shared quad', () => {
	const shared = new THREE.MeshBasicMaterial()
	const a = new THREE.Mesh(new THREE.BoxGeometry(), shared)
	const b = new THREE.Mesh(new THREE.ConeGeometry(), shared)
	const map = new THREE.Texture()
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map }))
	const group = new THREE.Group()
	const inner = new THREE.Group()
	inner.add(b)
	group.add(a, inner, sprite)
	const ga = watch(a.geometry)
	const gb = watch(b.geometry)
	const gs = watch(sprite.geometry)
	const ms = watch(shared)
	const mm = watch(map)
	const sm = watch(sprite.material)
	disposeTree(group)
	assert.equal(ga.n, 1)
	assert.equal(gb.n, 1)
	assert.equal(gs.n, 0)
	assert.equal(ms.n, 1)
	assert.equal(mm.n, 1)
	assert.equal(sm.n, 1)
})
