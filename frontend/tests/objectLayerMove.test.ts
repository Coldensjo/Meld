// Run with: bun test tests/objectLayerMove.test.ts
// A touched object's row is recomputed and written in place, not its whole type's (#510).
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { Terrain } from '../src/lib/terrain/Terrain.ts'

const { ObjectLayer } = await import('../src/lib/world/ObjectLayer.ts')
type ObjectLayer = InstanceType<typeof ObjectLayer>
import type { CullView } from '../src/lib/world/instanceCull.ts'

const TYPE = 'helper:cube:4'
const terrain = { heightAt: (x: number) => x * 0.1 } as unknown as Terrain
// A frustum with no planes set holds everything.
const view: CullView = { frustums: [new THREE.Frustum()], eye: new THREE.Vector3(0, 1e6, 0), pxPerUnit: 1, cutoffPx: 0 }

interface Peek {
	batches: Map<string, { mesh: THREE.InstancedMesh; ids: number[] }>
}

function setup(n: number) {
	const L = new ObjectLayer(terrain)
	for (let i = 0; i < n; i++) L.add({ type: TYPE, x: i * 10, z: 0, yOff: 0, rotY: 0, scale: 1 })
	L.update()
	L.cull(view)
	const b = (L as unknown as Peek).batches.get(TYPE)!
	const attr = b.mesh.instanceMatrix
	// What three does once it has drawn the buffer: clears the ranges and calls back.
	const upload = () => {
		attr.clearUpdateRanges()
		attr.onUploadCallback()
	}
	upload()
	return { L, b, attr, upload }
}

function rowOf(b: { mesh: THREE.InstancedMesh; ids: number[] }, id: number): number[] {
	const k = b.ids.indexOf(id)
	return Array.from(b.mesh.instanceMatrix.array.slice(k * 16, k * 16 + 16))
}

function matrix(L: ObjectLayer, id: number): number[] {
	return L.matrixOf(L.objects.get(id)!, new THREE.Matrix4()).toArray()
}

test('a moved object is written in place with a range of its own row, the others left alone', () => {
	const { L, b, attr } = setup(50)
	const before = Float32Array.from(attr.array)
	const o = L.objects.get(20)!
	const k = b.ids.indexOf(20)
	o.x += 3
	o.rotY = 1
	L.touch(o.id)
	const v0 = attr.version
	L.update()
	L.cull(view)
	assert.equal(attr.version, v0 + 1, 'the buffer is marked for upload')
	assert.deepEqual(attr.updateRanges, [{ start: k * 16, count: 16 }])
	const row = rowOf(b, 20)
	const want = matrix(L, 20)
	for (let j = 0; j < 16; j++) assert.ok(Math.abs(row[j] - want[j]) < 1e-4, `row value ${j}`)
	for (let i = 0; i < 50 * 16; i++) if (i < k * 16 || i >= k * 16 + 16) assert.equal(attr.array[i], before[i])
	const c = new THREE.Vector3(want[12], want[13], want[14])
	assert.ok(b.mesh.boundingSphere!.containsPoint(c), 'the mesh sphere covers the moved instance')
})

test('a child follows its moved parent', () => {
	const { L, b } = setup(5)
	const kid = L.add({ type: TYPE, parent: 2, x: 1, z: 0, yOff: 2, rotY: 0, scale: 1 })
	L.update()
	L.cull(view)
	const p = L.objects.get(2)!
	p.x += 5
	L.touch(2)
	L.update()
	L.cull(view)
	const row = rowOf(b, kid.id)
	const want = matrix(L, kid.id)
	for (let j = 0; j < 16; j++) assert.ok(Math.abs(row[j] - want[j]) < 1e-4)
})

test('a move before a whole repack was uploaded keeps the whole upload', () => {
	const { L, b, attr, upload } = setup(10)
	// A new object repacks the whole buffer; nothing draws it before the next move.
	L.add({ type: TYPE, x: 500, z: 0, yOff: 0, rotY: 0, scale: 1 })
	L.update()
	L.cull(view)
	const o = L.objects.get(3)!
	o.x += 1
	L.touch(3)
	L.update()
	L.cull(view)
	assert.equal(attr.updateRanges.length, 0, 'no range cuts the pending whole upload short')
	upload()
	o.x += 1
	L.touch(3)
	L.update()
	L.cull(view)
	assert.equal(attr.updateRanges.length, 1, 'once uploaded, the next move uploads its row only')
	const row = rowOf(b, 3)
	const want = matrix(L, 3)
	for (let j = 0; j < 16; j++) assert.ok(Math.abs(row[j] - want[j]) < 1e-4)
})

test('many moved rows upload the whole buffer', () => {
	const { L, attr } = setup(100)
	for (let id = 1; id <= 60; id++) {
		L.objects.get(id)!.yOff = 3
		L.touch(id)
	}
	L.update()
	L.cull(view)
	assert.equal(attr.updateRanges.length, 0)
	assert.ok(attr.version > 0)
})

test('a hidden object moved is skipped, and showing it again draws it where it is', () => {
	const { L, b } = setup(6)
	L.setHidden(4, true)
	L.update()
	L.cull(view)
	assert.equal(b.ids.includes(4), false)
	L.objects.get(4)!.x = 77
	L.touch(4)
	L.update()
	L.cull(view)
	L.setHidden(4, false)
	L.update()
	L.cull(view)
	const row = rowOf(b, 4)
	const want = matrix(L, 4)
	for (let j = 0; j < 16; j++) assert.ok(Math.abs(row[j] - want[j]) < 1e-4)
})

test('a move is logged with its children and leaves shapeVersion; a change of what is placed bumps it (#511)', () => {
	const { L } = setup(5)
	const kid = L.add({ type: TYPE, parent: 2, x: 1, z: 0, yOff: 2, rotY: 0, scale: 1 })
	const shape = L.shapeVersion
	const v = L.version
	const seq = L.moveSeq
	L.objects.get(2)!.x += 5
	L.touch(2)
	L.markRegionDirty(35, -1, 45, 1)
	assert.equal(L.shapeVersion, shape, 'moves leave shapeVersion')
	assert.ok(L.version > v, 'version still moves on any change')
	assert.deepEqual(L.movedSince(seq), [2, kid.id, 5])
	assert.deepEqual(L.movedSince(L.moveSeq), [])
	// An undo-style snapshot that gives an object another type changes what is placed.
	L.objects.get(3)!.type = 'helper:cube:2'
	L.touch(3)
	assert.equal(L.shapeVersion, shape + 1)
	L.setHidden(4, true)
	L.remove(1)
	L.add({ type: TYPE, x: 0, z: 9, yOff: 0, rotY: 0, scale: 1 })
	assert.equal(L.shapeVersion, shape + 4)
})

test('a reader the move log no longer reaches is told to rebuild', () => {
	const { L } = setup(1)
	const seq = L.moveSeq
	for (let i = 0; i < 20000; i++) L.touch(1)
	assert.equal(L.movedSince(seq), null)
	assert.equal(L.movedSince(L.moveSeq - 1)!.length, 1)
})
