// Run with: bun test tests/instanceBatch.test.ts
// The instance batch ObjectLayer and SpawnLayer share (#517): the rows in view are packed to the front
// of the mesh with the item each instance draws, a repack is forced after rows are rewritten, moved
// rows are written in place, and a ray hit on a packed instance names its item, for both layers.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { vmangos } from '../wailsjs/go/models'
import type { CullView } from '../src/lib/world/instanceCull.ts'

const { InstanceBatch, instancedMesh, RANGES_MAX } = await import('../src/lib/world/instanceBatch.ts')
const { firstPick } = await import('../src/lib/world/instanceHit.ts')
const { SpawnLayer } = await import('../src/lib/world/SpawnLayer.ts')

/** A camera at the origin looking down -z with a 90 degree view, and the view it makes. */
function view(): CullView {
	const cam = new THREE.PerspectiveCamera(90, 1, 0.1, 1000)
	cam.updateMatrixWorld()
	const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
	return { frustums: [f], eye: cam.position.clone(), pxPerUnit: 500, cutoffPx: 0 }
}

const box = new THREE.BoxGeometry(2, 2, 2)
const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z)

/** A batch of the items `names` at `spots`, and a mesh for them. */
function setup(names: string[], spots: [number, number, number][]) {
	const rows = new InstanceBatch<string>()
	rows.items = names
	rows.reserve(names.length)
	spots.forEach(([x, y, z], i) => rows.setRow(i, at(x, y, z), box))
	const ids: string[] = []
	const mesh = instancedMesh(box, new THREE.MeshBasicMaterial(), names.length, null, ids)
	return { rows, ids, mesh }
}

test('a new mesh draws nothing and keeps its ids for picking', () => {
	const { mesh, ids } = setup(['a'], [[0, 0, -10]])
	assert.equal(mesh.count, 0)
	assert.equal(mesh.visible, false)
	assert.equal(mesh.userData.ids, ids)
})

test('the rows in view are packed to the front with the items they draw', () => {
	const { rows, ids, mesh } = setup(
		['a', 'behind', 'c'],
		[
			[0, 0, -10],
			[0, 0, 10],
			[3, 0, -20],
		],
	)
	assert.equal(rows.cull(view()), true)
	rows.pack(mesh, ids)
	assert.deepEqual(ids, ['a', 'c'])
	assert.equal(mesh.count, 2)
	assert.equal(mesh.visible, true)
	const m = new THREE.Matrix4()
	mesh.getMatrixAt(1, m)
	assert.deepEqual([m.elements[12], m.elements[13], m.elements[14]], [3, 0, -20])
	assert.ok(mesh.boundingSphere!.containsPoint(new THREE.Vector3(3, 0, -20)), 'the sphere covers the drawn instances')
})

test('the same rows in view report no change, unless a repack was asked for', () => {
	const { rows, ids, mesh } = setup(['a'], [[0, 0, -10]])
	assert.equal(rows.cull(view()), true, 'the first cull always packs')
	rows.pack(mesh, ids)
	assert.equal(rows.cull(view()), false)
	rows.setRow(0, at(1, 0, -10), box)
	rows.repack = true
	assert.equal(rows.cull(view()), true)
	assert.equal(rows.cull(view()), false, 'a repack is asked for once')
})

test('nothing in view hides the mesh', () => {
	const { rows, ids, mesh } = setup(['behind'], [[0, 0, 10]])
	assert.equal(rows.cull(view()), true, 'the first cull packs even an empty view')
	rows.pack(mesh, ids)
	assert.equal(mesh.count, 0)
	assert.equal(mesh.visible, false)
})

test('a moved row is written in place with a range of its own, or the whole buffer while a pack is pending', () => {
	const { rows, ids, mesh } = setup(
		['a', 'b', 'c'],
		[
			[0, 0, -10],
			[1, 0, -10],
			[2, 0, -10],
		],
	)
	const attr = mesh.instanceMatrix
	rows.cull(view())
	rows.pack(mesh, ids)
	rows.setRow(1, at(1, 5, -10), box)
	rows.patch(mesh, [1])
	assert.deepEqual(attr.updateRanges, [], 'the pack is not uploaded yet: the whole buffer goes')
	assert.equal(attr.array[16 + 13], 5)
	// What three does once it has drawn the buffer.
	attr.clearUpdateRanges()
	attr.onUploadCallback()
	rows.setRow(2, at(2, 7, -10), box)
	rows.patch(mesh, [2])
	assert.deepEqual(attr.updateRanges, [{ start: 32, count: 16 }])
	assert.equal(attr.array[32 + 13], 7)
	assert.ok(mesh.boundingSphere!.containsPoint(new THREE.Vector3(2, 7, -10)), 'the sphere grows over the moved row')
	assert.ok(RANGES_MAX > 1)
})

test('a ray on a packed instance names its item', () => {
	const { rows, ids, mesh } = setup(
		['a', 'behind', 'c'],
		[
			[0, 0, -10],
			[0, 0, 10],
			[3, 0, -20],
		],
	)
	rows.cull(view())
	rows.pack(mesh, ids)
	const ray = new THREE.Raycaster(new THREE.Vector3(3, 50, -20), new THREE.Vector3(0, -1, 0))
	assert.deepEqual(firstPick<string>(ray.intersectObject(mesh, false)), { id: 'c', distance: 49 })
})

function spawn(guid: number, x: number, z: number): vmangos.WorldSpawn {
	return vmangos.WorldSpawn.createFrom({ kind: 'monster', guid, entry: 1, name: 't', x, y: 0, z, orientation: 0, model: '', waypoints: [], leader: 0, pool: 0, motherPool: 0 })
}

test('a spawn is picked through its packed instance, and a moved one where it went', () => {
	const layer = new SpawnLayer()
	const a = spawn(1, 0, -10)
	const b = spawn(2, 4, -10)
	layer.set([a, b])
	layer.cull(view())
	const down = (x: number, z: number) => new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0))
	assert.equal(layer.pick(down(4, -10)), b)
	assert.equal(layer.pick(down(0, -10)), a)
	assert.equal(layer.pick(down(8, -10)), null)
	b.x = 8
	layer.refresh(b)
	layer.cull(view())
	assert.equal(layer.pick(down(8, -10)), b)
	assert.equal(layer.pick(down(4, -10)), null)
	const drawn: vmangos.WorldSpawn[] = []
	layer.forEachDrawn((s) => drawn.push(s))
	assert.deepEqual(drawn.map((s) => s.guid).sort(), [1, 2])
	layer.dispose()
})
