// Run with: bun test tests/cubeEdit.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CubeWorld, GROUND_LAYER, kindId } from '../src/lib/cubes/world.ts'
import { CubeChanges, FIRST_METAL_LAYER, boxOf, boxSize, chunksAround, editBlock, fillBox } from '../src/lib/cubes/edit.ts'
import { pickCube, sliceShows } from '../src/lib/cubes/pick.ts'
import { CubeLayer } from '../src/lib/cubes/CubeLayer.ts'
import { meshChunk, triangles } from '../src/lib/cubes/mesher.ts'
import { History } from '../src/lib/state/historyCore.ts'

const STONE = kindId('stone')
const WOOD = kindId('wood')
const WATER = kindId('water')
const SLOPE = 2
const all = () => true

/** A ray straight down onto the middle of cube column (x, z), from high above. */
const down = (x: number, z: number) => ({ ox: x * 3 + 1.5, oy: 100, oz: z * 3 + 1.5, dx: 0, dy: -1, dz: 0 })

test('a ray down meets the top cube and places on it', () => {
	const w = CubeWorld.create(2, 2, true)
	const p = pickCube(w, down(5, 7), all, 1000)
	assert.deepEqual(p?.cube, { x: 5, z: 7, layer: GROUND_LAYER })
	assert.deepEqual(p?.place, { x: 5, z: 7, layer: GROUND_LAYER - 1 })
	// The ground's top is at 3 m.
	assert.ok(Math.abs(p!.t - 97) < 1e-9)
})

test('a slanted ray meets a wall across its side face', () => {
	const w = new CubeWorld(1, 1)
	w.set(8, 4, GROUND_LAYER, STONE)
	// From the west at the cube's height, aiming east.
	const p = pickCube(w, { ox: -5, oy: 1.5, oz: 4 * 3 + 1.5, dx: 1, dy: 0.01, dz: 0 }, all, 1000)
	assert.deepEqual(p?.cube, { x: 8, z: 4, layer: GROUND_LAYER })
	assert.deepEqual(p?.place, { x: 7, z: 4, layer: GROUND_LAYER })
})

test('the layer slice hides cubes from the pick', () => {
	const w = CubeWorld.create(1, 1, true)
	// Showing layer 12 and below: the ray passes the ground and the first dirt layer.
	const p = pickCube(w, down(3, 3), sliceShows({ mode: 'below', layer: 12 }), 1000, 12)
	assert.deepEqual(p?.cube, { x: 3, z: 3, layer: 12 })
	assert.deepEqual(p?.place, { x: 3, z: 3, layer: 11 })
	// Showing only the sky layers: nothing to meet, so the floor of the slice layer.
	const f = pickCube(w, down(3, 3), sliceShows({ mode: 'above', layer: 5 }), 1000, 5)
	assert.equal(f?.cube, null)
	assert.deepEqual(f?.place, { x: 3, z: 3, layer: 5 })
})

test('an empty world is built on from the ground layer', () => {
	const w = new CubeWorld(1, 1)
	const p = pickCube(w, down(2, 9), all, 1000)
	assert.deepEqual(p, { cube: null, place: { x: 2, z: 9, layer: GROUND_LAYER }, t: 100 })
	// Outside the world there is nothing.
	assert.equal(pickCube(w, down(20, 9), all, 1000), null)
	// Looking up from below the world's floor plane finds nothing either.
	assert.equal(pickCube(w, { ox: 5, oy: -10, oz: 5, dx: 0, dy: -1, dz: 0 }, all, 1000), null)
})

test('a ray from inside a cube has nowhere to place', () => {
	const w = CubeWorld.create(1, 1, true)
	const p = pickCube(w, { ox: 4.5, oy: -4, oz: 4.5, dx: 0, dy: -1, dz: 0 }, all, 1000)
	assert.deepEqual(p?.cube, { x: 1, z: 1, layer: 12 })
	assert.equal(p?.place, null)
})

test('nothing changes in the metal layers or outside the world', () => {
	const w = CubeWorld.create(1, 1, true)
	assert.equal(editBlock(w, 0, 0, FIRST_METAL_LAYER - 1), '')
	assert.match(editBlock(w, 0, 0, FIRST_METAL_LAYER), /metal/)
	assert.match(editBlock(w, 16, 0, 5), /outside/)
	assert.match(editBlock(w, 0, 0, -1), /outside/)
	const c = new CubeChanges(w)
	assert.equal(c.set(0, 0, 30, 0), false)
	assert.equal(c.set(0, 0, FIRST_METAL_LAYER, 0), false)
	assert.equal(w.get(0, 0, FIRST_METAL_LAYER).kind, kindId('metal'))
	assert.equal(c.size, 0)
})

test('changes undo and redo, normalized, and an unchanged cube is not a change', () => {
	const w = new CubeWorld(2, 1)
	const c = new CubeChanges(w)
	assert.ok(c.set(3, 4, 9, WOOD, SLOPE, 7))
	assert.deepEqual(w.get(3, 4, 9), { kind: WOOD, shape: SLOPE, rotation: 7 })
	assert.ok(c.set(3, 4, 9, STONE))
	assert.equal(c.set(3, 4, 9, STONE), false)
	assert.ok(c.set(17, 0, 9, WATER, 0, 5))
	assert.deepEqual(w.get(17, 0, 9), { kind: WATER, shape: 0, rotation: 0 })
	assert.equal(c.size, 2)
	c.undo()
	assert.equal(w.get(3, 4, 9).kind, 0)
	assert.equal(w.get(17, 0, 9).kind, 0)
	c.redo()
	assert.deepEqual(w.get(3, 4, 9), { kind: STONE, shape: 0, rotation: 0 })
	assert.equal(w.get(17, 0, 9).kind, WATER)
})

test('a change touches the chunks beside it across edges and layers', () => {
	const w = new CubeWorld(3, 3)
	const keys = (s: Set<number>) => [...s].sort((a, b) => a - b)
	// In the middle of chunk (1, 1): itself and the layers above and below.
	assert.deepEqual(keys(chunksAround(w, 20, 20, 10)), keys(new Set([w.chunkKey(1, 1, 9), w.chunkKey(1, 1, 10), w.chunkKey(1, 1, 11)])))
	// On its west and north edge, at the top layer: the chunks across those edges, no layer -1.
	assert.deepEqual(keys(chunksAround(w, 16, 31, 0)), keys(new Set([w.chunkKey(1, 1, 0), w.chunkKey(1, 1, 1), w.chunkKey(0, 1, 0), w.chunkKey(1, 2, 0)])))
	// The world's corner has no chunk beyond it.
	assert.equal(chunksAround(w, 0, 0, 30).size, 2)
})

test('a box fills between its corners and up, and empties again', () => {
	const w = CubeWorld.create(1, 1, true)
	const box = boxOf({ x: 4, z: 2, layer: 9 }, { x: 1, z: 3, layer: 9 }, 2)
	assert.deepEqual(box, { x0: 1, x1: 4, z0: 2, z1: 3, top: 7, bottom: 9 })
	assert.equal(boxSize(box), 4 * 2 * 3)
	const c = new CubeChanges(w)
	assert.equal(fillBox(c, box, WOOD), 24)
	assert.equal(w.get(1, 2, 7).kind, WOOD)
	assert.equal(w.get(4, 3, 9).kind, WOOD)
	assert.equal(w.get(5, 3, 9).kind, 0)
	// A box reaching into the metal leaves the metal alone (layer 24 is the cavern's air already).
	const deep = new CubeChanges(w)
	assert.equal(fillBox(deep, boxOf({ x: 0, z: 0, layer: 24 }, { x: 0, z: 0, layer: 27 }), 0), 1)
	assert.equal(w.get(0, 0, 25).kind, 0)
	assert.equal(w.get(0, 0, 26).kind, kindId('metal'))
	// Undone through the history, as the tool pushes it.
	const h = new History({ dirty() {}, sync() {} })
	h.push({ label: 'Fill', undo: () => c.undo(), redo: () => c.redo() })
	h.undo()
	assert.equal(w.get(1, 2, 7).kind, 0)
	h.redo()
	assert.equal(w.get(1, 2, 7).kind, WOOD)
})

test('rebuilding the changed chunks draws what the mesher gives', () => {
	const w = CubeWorld.create(2, 2, true)
	const layer = new CubeLayer(w)
	layer.buildAll()
	const expected = () => {
		let n = 0
		for (const key of w.chunks.keys()) {
			const cx = key % w.chunksX
			const cz = Math.floor(key / w.chunksX) % w.chunksZ
			n += triangles(meshChunk(w, cx, cz, Math.floor(key / (w.chunksX * w.chunksZ))))
		}
		return n
	}
	const before = layer.drawn().triangles
	assert.equal(before, expected())
	// A cube on a chunk corner, in a layer with no chunk yet, and a hole dug in the ground.
	const c = new CubeChanges(w)
	c.set(15, 15, 9, STONE)
	c.set(16, 3, GROUND_LAYER, 0)
	layer.rebuild(c.dirty())
	assert.equal(layer.drawn().triangles, expected())
	assert.notEqual(layer.drawn().triangles, before)
	layer.rebuild(c.undo())
	assert.equal(layer.drawn().triangles, before)
	// With the slice on, the cut layer's caps follow the edit too.
	layer.update({ mode: 'below', layer: GROUND_LAYER }, 0)
	const capped = layer.drawn().caps
	layer.rebuild(c.redo())
	assert.notEqual(layer.drawn().caps, capped)
	layer.rebuild(c.undo())
	assert.equal(layer.drawn().caps, capped)
	layer.dispose()
})
