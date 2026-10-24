// Run with: bun test tests/cubeBatches.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CHUNK_SIZE, CubeWorld, GROUND_LAYER, LAYER_COUNT, kindId } from '../src/lib/cubes/world.ts'
import { chunksAround } from '../src/lib/cubes/edit.ts'
import { BATCH, CubeLayer } from '../src/lib/cubes/CubeLayer.ts'
import { CAP_TOP, layerBottom, meshChunk, triangles } from '../src/lib/cubes/mesher.ts'

const WOOD = kindId('wood')

/** The chunks' meshes the mesher gives (one a part with anything to draw) and their triangles. */
function perChunk(w: CubeWorld) {
	let meshes = 0
	let tris = 0
	for (const key of w.chunks.keys()) {
		const parts = meshChunk(w, key % w.chunksX, Math.floor(key / w.chunksX) % w.chunksZ, Math.floor(key / (w.chunksX * w.chunksZ)))
		meshes += parts.filter((p) => p).length
		tris += triangles(parts)
	}
	return { meshes, tris }
}

test('a themed 32 x 32 world draws its triangles in a tenth of the meshes a chunk each would take', () => {
	const w = CubeWorld.create(32, 32, true)
	const cubes = new CubeLayer(w)
	cubes.buildAll()
	const want = perChunk(w)
	const got = cubes.drawn()
	assert.equal(got.triangles, want.tris)
	// 6608 meshes a chunk each; the batches of 4 x 4 chunks leave 656.
	assert.equal(want.meshes, 6608)
	assert.ok(got.meshes * 10 <= want.meshes, `${got.meshes} meshes`)
	cubes.dispose()
})

test('a batch places its chunks at their corners, and a world not a whole number of batches is drawn to its edge', () => {
	const w = new CubeWorld(BATCH + 1, BATCH + 1)
	// One cube in the last chunk of the first batch, one in the batch past it.
	w.set(BATCH * CHUNK_SIZE - 1, 2, GROUND_LAYER, WOOD)
	w.set(BATCH * CHUNK_SIZE + 3, BATCH * CHUNK_SIZE + 5, GROUND_LAYER, WOOD)
	const cubes = new CubeLayer(w)
	cubes.buildAll()
	cubes.group.updateMatrixWorld(true)
	assert.equal(cubes.drawn().meshes, 2)
	const boxes: THREE.Box3[] = []
	cubes.group.traverse((o) => {
		if (o instanceof THREE.Mesh) boxes.push(new THREE.Box3().setFromObject(o))
	})
	boxes.sort((a, b) => a.min.x - b.min.x)
	const bottom = layerBottom(GROUND_LAYER)
	assert.deepEqual(boxes[0].min.toArray(), [(BATCH * CHUNK_SIZE - 1) * 3, bottom, 6])
	assert.deepEqual(boxes[0].max.toArray(), [BATCH * CHUNK_SIZE * 3, bottom + 3, 9])
	assert.deepEqual(boxes[1].min.toArray(), [(BATCH * CHUNK_SIZE + 3) * 3, bottom, (BATCH * CHUNK_SIZE + 5) * 3])
	cubes.dispose()
})

test('an edit rebuilds its batches: the triangles follow the cubes, the batches stay as many', () => {
	const w = CubeWorld.create(8, 8, true)
	const cubes = new CubeLayer(w)
	cubes.buildAll()
	const before = cubes.drawn().meshes
	// A cube on the ground at a batch's corner, so its neighbours span four batches.
	const x = BATCH * CHUNK_SIZE
	w.set(x, x, GROUND_LAYER - 1, WOOD)
	cubes.rebuild(chunksAround(w, x, x, GROUND_LAYER - 1))
	assert.equal(cubes.drawn().triangles, perChunk(w).tris)
	assert.equal(cubes.drawn().meshes, before + 1)
	w.set(x, x, GROUND_LAYER - 1, 0)
	cubes.rebuild(chunksAround(w, x, x, GROUND_LAYER - 1))
	assert.equal(cubes.drawn().triangles, perChunk(w).tris)
	assert.equal(cubes.drawn().meshes, before)
	cubes.dispose()
})

test('the slice caps are batched too, and follow an edit in the slice layer', () => {
	const w = CubeWorld.create(8, 8, true)
	const cubes = new CubeLayer(w)
	cubes.buildAll()
	const n = 16
	cubes.update({ mode: 'below', layer: n }, 0)
	const capTris = () => {
		let t = 0
		for (let cz = 0; cz < w.chunksZ; cz++) for (let cx = 0; cx < w.chunksX; cx++) t += triangles(meshChunk(w, cx, cz, n, CAP_TOP))
		return t
	}
	assert.equal(cubes.drawn().caps, capTris())
	assert.equal(cubes.drawn().caps, 8 * 8 * 256 * 2)
	// Four batches of caps, one mesh each.
	assert.equal(cubes.group.getObjectByName('slice caps')!.children.length, 4)
	w.set(3, 3, n - 1, 0)
	cubes.rebuild(chunksAround(w, 3, 3, n - 1))
	assert.equal(cubes.drawn().caps, capTris())
	assert.ok(LAYER_COUNT > n)
	cubes.dispose()
})
