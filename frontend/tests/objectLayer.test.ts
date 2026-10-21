// Run with: bun test tests/objectLayer.test.ts
// The attachment tree is read from the kids index, not by walking every object (#512).
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { Terrain } from '../src/lib/terrain/Terrain.ts'

// The layer's imports reach the editor's state, whose runes need Svelte's compiler: plain values do here.
const g = globalThis as Record<string, unknown>
g.$state = <T>(v: T) => v
const { ObjectLayer } = await import('../src/lib/world/ObjectLayer.ts')

const TYPE = 'helper:cube:4'
const terrain = { heightAt: () => 0 } as unknown as Terrain

/** A root with a chain three deep below it (a > b > c), a second child of a (d), and an unrelated root. */
function tree() {
	const L = new ObjectLayer(terrain)
	const at = (x: number, z: number) => ({ type: TYPE, x, z, yOff: 0, rotY: 0, scale: 1 })
	const a = L.add(at(10, 10))
	const b = L.add({ ...at(1, 0), parent: a.id })
	const c = L.add({ ...at(1, 0), parent: b.id })
	const d = L.add({ ...at(0, 1), parent: a.id })
	const e = L.add(at(50, 50))
	return { L, a, b, c, d, e }
}

const ids = (s: Iterable<number>) => [...s].sort((x, y) => x - y)

test('descendantsOf walks the tree to the bottom, and leaves the rest out', () => {
	const { L, a, b, c, d, e } = tree()
	assert.deepEqual(ids(L.descendantIds(a.id)), ids([a.id, b.id, c.id, d.id]))
	assert.deepEqual(ids(L.descendantIds(b.id)), ids([b.id, c.id]))
	assert.deepEqual(ids(L.descendantIds(c.id)), [c.id])
	assert.deepEqual(ids(L.descendantsOf([b.id, e.id])), ids([b.id, c.id, e.id]))
})

test('descendantsOf into its own set walks the ids already in it', () => {
	const { L, a, b, c, d, e } = tree()
	const out = new Set([a.id, e.id])
	assert.equal(L.descendantsOf(out, out), out)
	assert.deepEqual(ids(out), ids([a.id, b.id, c.id, d.id, e.id]))
})

test('childrenOf gives the direct children only', () => {
	const { L, a, b, d } = tree()
	assert.deepEqual(ids(L.childrenOf(a.id).map((o) => o.id)), ids([b.id, d.id]))
	assert.deepEqual(L.childrenOf(d.id), [])
})

test('a kids entry whose child no longer names that parent is skipped', () => {
	const { L, a, b, c, d, e } = tree()
	// Written over from a snapshot (as an undo does) and not yet touched: c is still filed under b.
	c.parent = e.id
	assert.deepEqual(ids(L.descendantIds(a.id)), ids([a.id, b.id, d.id]))
	assert.deepEqual(L.childrenOf(b.id), [])
	// The touch files it under its new parent.
	L.touch(c.id)
	assert.deepEqual(ids(L.descendantIds(e.id)), ids([e.id, c.id]))
	assert.deepEqual(ids(L.descendantIds(b.id)), [b.id])
})

test('a removed child leaves the tree, and comes back with its id', () => {
	const { L, a, b, c, d } = tree()
	const snap = { ...b }
	L.remove(b.id)
	// c still names b, which is gone: it is no longer part of a's tree.
	assert.deepEqual(ids(L.descendantIds(a.id)), ids([a.id, d.id]))
	L.add(snap)
	assert.deepEqual(ids(L.descendantIds(a.id)), ids([a.id, b.id, c.id, d.id]))
})

test('place refuses to hang an object on itself or on anything below it', () => {
	const { L, a, b, c, e } = tree()
	const w = L.worldPlacement(a)
	L.place(a, c.id, w)
	assert.equal(a.parent, undefined, 'not onto its grandchild')
	L.place(a, a.id, w)
	assert.equal(a.parent, undefined, 'not onto itself')
	L.place(b, e.id, L.worldPlacement(b))
	assert.equal(b.parent, e.id, 'onto an unrelated root')
	assert.deepEqual(ids(L.descendantIds(e.id)), ids([e.id, b.id, c.id]))
	// And the world spot is kept through the move.
	const p = L.worldPosition(c, new THREE.Vector3())
	assert.ok(Math.abs(p.x - 12) < 1e-9 && Math.abs(p.z - 10) < 1e-9, `c stays at (12, 10): ${p.x}, ${p.z}`)
})
