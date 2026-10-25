// Run with: bun test tests/objectLayer.test.ts
// The attachment tree is read from the kids index, not by walking every object (#512).
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { Terrain } from '../src/lib/terrain/Terrain.ts'

const { ObjectLayer } = await import('../src/lib/world/ObjectLayer.ts')
const selection = await import('../src/lib/state/selection.ts')

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

/** A seeded random number in [0, 1). */
function rng(seed: number) {
	let s = seed >>> 0
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0
		return s / 4294967296
	}
}

type Layer = ReturnType<typeof tree>['L']
type Obj = ReturnType<typeof tree>['a']

/** What the cells must give: the roots near the spot, found by looking at every object. */
function brute(L: Layer, x: number, z: number, r: number, sized: boolean): number[] {
	const out: number[] = []
	for (const o of L.objects.values()) {
		if (o.parent !== undefined) continue
		const lim = sized ? r + L.groundReach(o.type, o.scale) : r
		if ((o.x - x) ** 2 + (o.z - z) ** 2 <= lim * lim) out.push(o.id)
	}
	return out.sort((p, q) => p - q)
}

test('rootsNear and rootsIn find what a scan of every object finds, through moves, removes and scale', () => {
	const L = new ObjectLayer(terrain)
	const r = rng(512)
	const objs: Obj[] = []
	for (let i = 0; i < 400; i++) objs.push(L.add({ type: TYPE, x: r() * 600 - 100, z: r() * 600 - 100, yOff: 0, rotY: 0, scale: 0.5 + r() }))
	// A few attached ones, which the roots queries leave out, and a few very wide ones (a building's reach).
	for (let i = 0; i < 20; i++) L.add({ type: TYPE, x: 1, z: 1, yOff: 0, rotY: 0, scale: 1, parent: objs[i * 7].id })
	for (let i = 0; i < 5; i++) {
		const o = objs[i * 50 + 3]
		o.scale = 60
		L.touch(o.id)
	}
	const out: Obj[] = []
	const check = () => {
		for (let k = 0; k < 60; k++) {
			const x = r() * 700 - 150
			const z = r() * 700 - 150
			const rad = k % 10 === 0 ? 2000 : r() * 60
			for (const sized of [false, true]) {
				assert.deepEqual(ids(L.rootsNear(x, z, rad, out, sized).map((o) => o.id)), brute(L, x, z, rad, sized), `near ${x}, ${z}, ${rad}, sized ${sized}`)
			}
			const want = [...L.objects.values()].filter((o) => o.parent === undefined && o.x >= x && o.x <= x + rad && o.z >= z && o.z <= z + rad).map((o) => o.id)
			assert.deepEqual(ids(L.rootsIn(x, z, x + rad, z + rad, out).map((o) => o.id)), ids(want))
		}
	}
	check()
	// Moved (as a drag does: the fields written, then a touch), removed, attached and detached.
	for (let i = 0; i < 100; i++) {
		const o = objs[(i * 13) % objs.length]
		if (!L.objects.has(o.id)) continue
		o.x += (r() - 0.5) * 200
		o.z += (r() - 0.5) * 200
		L.touch(o.id)
	}
	for (let i = 0; i < 30; i++) L.remove(objs[i * 11 + 1].id)
	L.place(objs[200], objs[201].id, L.worldPlacement(objs[200]))
	L.place(objs[7], null, L.worldPlacement(objs[7]))
	check()
	assert.equal(L.attachedObjects(out).length, [...L.objects.values()].filter((o) => o.parent !== undefined).length)
	L.clear()
	assert.deepEqual(L.rootsNear(0, 0, 1e6, out), [])
})

test('groupMembers follows add, setGroup, a snapshot written back with touch, remove and clear (#630)', () => {
	const { L, a, b, c, d, e } = tree()
	assert.equal(L.groupMembers(1).size, 0)
	const g = L.newGroup()
	for (const o of [a, c, e]) L.setGroup(o.id, g)
	assert.deepEqual(ids(L.groupMembers(g)), ids([a.id, c.id, e.id]))
	const { withGroups } = selection
	assert.deepEqual(ids(withGroups(L, [c.id])), ids([a.id, c.id, e.id]))
	assert.deepEqual(ids(withGroups(L, [b.id])), [b.id])
	// Taken out of the group.
	L.setGroup(e.id, undefined)
	assert.equal(e.group, undefined)
	assert.deepEqual(ids(L.groupMembers(g)), ids([a.id, c.id]))
	// An undo snapshot writes the field over, then touches.
	const before = { ...d }
	d.group = g
	L.touch(d.id)
	assert.deepEqual(ids(L.groupMembers(g)), ids([a.id, c.id, d.id]))
	Object.assign(d, before)
	delete d.group
	L.touch(d.id)
	assert.deepEqual(ids(L.groupMembers(g)), ids([a.id, c.id]))
	// Added with a group (paste, a map loading), and re-added under the same id in another.
	const f = L.add({ type: TYPE, x: 5, z: 5, yOff: 0, rotY: 0, scale: 1, group: g })
	assert.ok(L.groupMembers(g).has(f.id))
	assert.ok(L.newGroup() > g)
	L.add({ ...f, group: 9 })
	assert.ok(!L.groupMembers(g).has(f.id))
	assert.deepEqual(ids(L.groupMembers(9)), [f.id])
	L.remove(a.id)
	assert.deepEqual(ids(L.groupMembers(g)), [c.id])
	L.clear()
	assert.equal(L.groupMembers(g).size, 0)
	assert.equal(L.groupMembers(9).size, 0)
})

test('objects read without ids (a map saved before they had them, #534) are each given a new one', () => {
	const L = new ObjectLayer(terrain)
	const old = { type: TYPE, x: 0, z: 0, yOff: 0, rotY: 0, scale: 1, id: 0 }
	const placed = [L.add({ ...old }), L.add({ ...old }), L.add({ ...old })]
	assert.deepEqual(
		placed.map((o) => o.id),
		[1, 2, 3],
	)
	assert.equal(L.objects.size, 3)
	// The next object placed after them takes the id after theirs.
	assert.equal(L.add({ ...old, id: undefined }).id, 4)
})

test('dropEmptyBatches takes away the batches no object uses any more, and only those (#15)', () => {
	const L = new ObjectLayer(terrain)
	const OTHER = 'helper:cube:1'
	const at = (type: string) => ({ type, x: 0, z: 0, yOff: 0, rotY: 0, scale: 1 })
	const a = L.add(at(TYPE))
	const b = L.add(at(OTHER))
	assert.equal(L.group.children.length, 2)
	assert.deepEqual([...L.dropEmptyBatches(new Set())], [])
	L.remove(b.id)
	// The empty batch is still named until it is dropped.
	assert.ok(L.modelTypes(new Set()).has(OTHER))
	assert.deepEqual([...L.dropEmptyBatches(new Set())], [OTHER])
	assert.deepEqual([...L.modelTypes(new Set())], [TYPE])
	assert.equal(L.group.children.length, 1)
	assert.deepEqual([...L.dropEmptyBatches(new Set())], [])
	// Placed again, the type gets a batch again and is drawn.
	L.add(at(OTHER))
	L.update()
	assert.equal(L.group.children.length, 2)
	assert.ok(L.modelTypes(new Set()).has(OTHER))
	assert.ok(L.objects.has(a.id))
})
