// Run with: bun test tests/modelBuild.test.ts
// A loaded model's bounds tree, LOD and WMO group cull, built from its buffers alone as the model
// worker does (#507), come out as the main thread built them on the geometry itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { buildBoundsTree } from '../src/lib/world/bvh.ts'
import { buildLod } from '../src/lib/models/lod.ts'
import { MIN_TRIANGLES, WmoGroupCull } from '../src/lib/world/wmoGroupCull.ts'
import { adoptModel, buildModel } from '../src/lib/models/modelBuild.ts'

/** A bumpy grid of 20,000 triangles over two materials, its vertices in six WMO groups by x (a city's worth for the cull). */
function model() {
	const g = new THREE.PlaneGeometry(120, 120, 100, 100).rotateX(-Math.PI / 2)
	const pos = g.getAttribute('position')
	const room = new Uint16Array(pos.count * 2)
	for (let i = 0; i < pos.count; i++) {
		pos.setY(i, Math.sin(pos.getX(i) * 0.3) * Math.cos(pos.getZ(i) * 0.2) * 4)
		room[2 * i] = 1 + Math.min(5, Math.floor((pos.getX(i) + 60) / 20))
	}
	g.setAttribute('wmoRoom', new THREE.BufferAttribute(room, 2))
	g.deleteAttribute('normal')
	const n = g.index!.count
	g.clearGroups()
	g.addGroup(0, n / 2, 0)
	g.addGroup(n / 2, n / 2, 1)
	g.computeBoundingSphere()
	return g
}

test('the worker build gives the same index, tree, LOD and group cull as the main thread did', async () => {
	assert.ok(model().index!.count / 3 >= MIN_TRIANGLES)
	const here = model()
	buildBoundsTree(here)
	const lodHere = await buildLod(here)
	const cullHere = WmoGroupCull.of(here)
	assert.ok(lodHere && cullHere, 'the model is big enough for both')

	const built = model()
	const data = await buildModel(built)
	assert.ok(data.cull, 'the build made the group cull')
	const lod = adoptModel(built, data)
	assert.ok(built.boundsTree instanceof MeshBVH)
	assert.deepEqual(Array.from(built.index!.array), Array.from(here.index!.array), 'the tree reordered the index the same way')
	assert.ok(lod)
	assert.deepEqual(Array.from(lod.index!.array), Array.from(lodHere.index!.array), 'the LOD comes from the reordered index')
	assert.deepEqual(lod.groups, lodHere.groups)
	assert.equal(lod.getAttribute('position'), built.getAttribute('position'), 'the LOD shares the vertex buffers')
	assert.equal(lod.boundsTree, built.boundsTree)

	const cull = WmoGroupCull.of(built)
	assert.ok(cull, 'the cull was adopted with the model')
	assert.equal(WmoGroupCull.of(built), cull)
	assert.deepEqual(Array.from(cull.geometry.index!.array), Array.from(cullHere.geometry.index!.array))
	assert.deepEqual(
		cull.boxes.map((b) => [...b.min.toArray(), ...b.max.toArray()]),
		cullHere.boxes.map((b) => [...b.min.toArray(), ...b.max.toArray()]),
	)
	assert.equal(cull.geometry.boundsTree, built.boundsTree, 'the twin picks through the model tree')

	// A ray picks the same spot through either tree.
	const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
	const ray = new THREE.Raycaster(new THREE.Vector3(13.3, 50, -7.1), new THREE.Vector3(0, -1, 0))
	ray.firstHitOnly = true
	const a = ray.intersectObject(new THREE.Mesh(here, [mat, mat]))
	const b = ray.intersectObject(new THREE.Mesh(built, [mat, mat]))
	assert.equal(b.length, 1)
	assert.ok(Math.abs(a[0].distance - b[0].distance) < 1e-6)
})

test('a model too small for a group cull is sent without its rooms and gets none', async () => {
	const g = new THREE.BoxGeometry(2, 2, 2)
	g.setAttribute('wmoRoom', new THREE.BufferAttribute(new Uint16Array(g.getAttribute('position').count * 2).fill(1), 2))
	const data = await buildModel(g)
	assert.equal(data.cull, undefined)
	assert.equal(adoptModel(g, data), undefined, 'too simple for a LOD')
	assert.ok(g.boundsTree instanceof MeshBVH)
	assert.equal(WmoGroupCull.of(g), null)
})
