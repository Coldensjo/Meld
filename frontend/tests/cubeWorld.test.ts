// Run with: bun test tests/cubeWorld.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHUNK_AREA, CubeWorld, LAYER_COUNT, PAINT_LEN, TEXTURES, baseFill, isWorldPath, kindId, normalize } from '../src/lib/cubes/world.ts'

const STONE = kindId('stone')
const WOOD = kindId('wood')
const SLOPE = 2
const HALF = 1
const LADDER = 6
const PILLAR = 5

test('normalize keeps cubes as the game does', () => {
	assert.deepEqual(normalize(0, SLOPE, 3), { kind: 0, shape: 0, rotation: 0 })
	assert.deepEqual(normalize(STONE, 0, 7), { kind: STONE, shape: 0, rotation: 0 })
	assert.deepEqual(normalize(STONE, PILLAR, 5), { kind: STONE, shape: PILLAR, rotation: 0 })
	assert.deepEqual(normalize(STONE, HALF, 7), { kind: STONE, shape: HALF, rotation: 4 })
	assert.deepEqual(normalize(WOOD, LADDER, 7), { kind: WOOD, shape: LADDER, rotation: 3 })
	assert.deepEqual(normalize(STONE, SLOPE, 7), { kind: STONE, shape: SLOPE, rotation: 7 })
	assert.throws(() => normalize(8, 0, 0))
	assert.deepEqual(normalize(STONE, 7, 7), { kind: STONE, shape: 7, rotation: 7 }) // doorway
	assert.deepEqual(normalize(STONE, 8, 7), { kind: STONE, shape: 8, rotation: 3 }) // window
	assert.throws(() => normalize(1, 9, 0))
	assert.throws(() => normalize(1, 0, 8))
})

test('set and get cubes, empty where nothing is stored', () => {
	const w = new CubeWorld(2, 3)
	assert.equal(w.sizeX, 32)
	assert.equal(w.sizeZ, 48)
	assert.deepEqual(w.get(20, 40, 10), { kind: 0, shape: 0, rotation: 0 })
	w.set(20, 40, 10, STONE, SLOPE, 1)
	assert.deepEqual(w.get(20, 40, 10), { kind: STONE, shape: SLOPE, rotation: 1 })
	assert.ok(w.chunk(1, 2, 10))
	// Setting an empty cube where nothing is stored stores nothing.
	w.set(0, 0, 0, 0)
	assert.equal(w.chunk(0, 0, 0), undefined)
	assert.throws(() => w.set(32, 0, 10, STONE))
	assert.throws(() => w.set(0, 0, LAYER_COUNT, STONE))
	assert.deepEqual(w.get(-1, 0, 10), { kind: 0, shape: 0, rotation: 0 })
})

test('a world survives the bridge, leaving out empty chunks', () => {
	const w = new CubeWorld(2, 2)
	w.set(3, 4, 10, STONE, SLOPE, 1)
	w.set(20, 20, 9, WOOD, HALF, 4)
	w.set(5, 5, 3, STONE)
	w.set(5, 5, 3, 0) // stored but empty again
	const d = w.toData()
	assert.equal(d.chunks.length, 2)
	const back = CubeWorld.fromData(d)
	assert.equal(back.chunksX, 2)
	assert.deepEqual(back.get(3, 4, 10), { kind: STONE, shape: SLOPE, rotation: 1 })
	assert.deepEqual(back.get(20, 20, 9), { kind: WOOD, shape: HALF, rotation: 4 })
	assert.equal(back.chunkCount, 2)
})

test('fromData refuses chunks outside the world or of the wrong size', () => {
	const cubes = btoa(String.fromCharCode(...new Uint8Array(3 * CHUNK_AREA)))
	assert.throws(() => CubeWorld.fromData({ chunksX: 1, chunksZ: 1, chunks: [{ cx: 1, cz: 0, layer: 0, cubes }] }))
	assert.throws(() => CubeWorld.fromData({ chunksX: 1, chunksZ: 1, chunks: [{ cx: 0, cz: 0, layer: 31, cubes }] }))
	assert.throws(() => CubeWorld.fromData({ chunksX: 1, chunksZ: 1, chunks: [{ cx: 0, cz: 0, layer: 0, cubes: btoa('abc') }] }))
	assert.throws(() => new CubeWorld(0, 1))
})

test('a themed new world fills the layers as the game generator starts', () => {
	assert.equal(baseFill(0), kindId('empty'))
	assert.equal(baseFill(9), kindId('empty'))
	assert.equal(baseFill(10), kindId('dirt'))
	assert.equal(baseFill(14), kindId('dirt'))
	assert.equal(baseFill(15), kindId('stone'))
	assert.equal(baseFill(20), kindId('stone'))
	assert.equal(baseFill(21), kindId('empty'))
	assert.equal(baseFill(25), kindId('lava'))
	assert.equal(baseFill(26), kindId('metal'))
	assert.equal(baseFill(30), kindId('metal'))
	const w = CubeWorld.create(2, 1, true)
	assert.deepEqual(w.get(31, 15, 18), { kind: STONE, shape: 0, rotation: 0 })
	assert.deepEqual(w.get(31, 15, 5), { kind: 0, shape: 0, rotation: 0 })
	// Layers 10 to 20, 25 and 26 to 30 are filled: 17 layers of 2 chunks.
	assert.equal(w.toData().chunks.length, 34)
	assert.equal(CubeWorld.create(2, 1, false).chunkCount, 0)
})

test('isWorldPath tells worlds from maps', () => {
	assert.ok(isWorldPath('C:\\a\\b.WORLD'))
	assert.ok(!isWorldPath('b.wmap'))
})

test('the spawn point goes through toData and fromData', () => {
	const w = CubeWorld.create(2, 2, false)
	assert.equal(w.spawn, null)
	assert.equal(CubeWorld.fromData(w.toData()).spawn, null)
	w.spawn = { x: 4, z: 5, layer: 9 }
	const d = w.toData()
	assert.deepEqual(d.spawn, { x: 4, z: 5, layer: 9 })
	assert.deepEqual(CubeWorld.fromData(d).spawn, { x: 4, z: 5, layer: 9 })
	assert.equal(CubeWorld.fromData({ ...d, spawn: undefined }).spawn, null)
	assert.throws(() => CubeWorld.fromData({ ...d, spawn: { x: 32, z: 0, layer: 9 } }))
	assert.throws(() => CubeWorld.fromData({ ...d, spawn: { x: 0, z: 0, layer: LAYER_COUNT } }))
})

test('monster spawn points go through toData and fromData, in order', () => {
	const w = CubeWorld.create(2, 2, false)
	assert.deepEqual(w.toData().monsters, [])
	w.monsters = [
		{ kind: 'wolf', pos: { x: 20, z: 25, layer: 9 } },
		{ kind: 'höhlenbär', pos: { x: 3, z: 30, layer: 25 } },
	]
	const d = w.toData()
	assert.deepEqual(CubeWorld.fromData(d).monsters, w.monsters)
	// The data is a copy: changing it leaves the world alone.
	d.monsters![0].pos.x = 1
	assert.equal(w.monsters[0].pos.x, 20)
	assert.deepEqual(CubeWorld.fromData({ ...d, monsters: null }).monsters, [])
	assert.deepEqual(CubeWorld.fromData({ ...d, monsters: undefined }).monsters, [])
	assert.throws(() => CubeWorld.fromData({ ...d, monsters: [{ kind: 'wolf', pos: { x: 32, z: 0, layer: 9 } }] }))
	assert.throws(() => CubeWorld.fromData({ ...d, monsters: [{ kind: 'wolf', pos: { x: 0, z: 0, layer: LAYER_COUNT } }] }))
})

test('NPCs go through toData and fromData, in order with their routes', () => {
	const w = CubeWorld.create(2, 2, false)
	assert.deepEqual(w.toData().npcs, [])
	w.npcs = [
		{ name: 'Warden Hask', pos: { x: 12, z: 20, layer: 9 }, route: [{ x: 14, z: 20, layer: 9 }, { x: 14, z: 28, layer: 8 }] },
		{ name: 'Þóra', pos: { x: 6, z: 9, layer: 10 }, route: [] },
	]
	const d = w.toData()
	assert.deepEqual(CubeWorld.fromData(d).npcs, w.npcs)
	// The data is a copy: changing it leaves the world alone.
	d.npcs![0].route[0].x = 1
	assert.equal(w.npcs[0].route[0].x, 14)
	assert.deepEqual(CubeWorld.fromData({ ...d, npcs: null }).npcs, [])
	assert.deepEqual(CubeWorld.fromData({ ...d, npcs: undefined }).npcs, [])
	// Go sends a route it read as empty as null.
	assert.deepEqual(CubeWorld.fromData({ ...d, npcs: [{ name: 'A', pos: { x: 0, z: 0, layer: 9 }, route: null as unknown as [] }] }).npcs[0].route, [])
	assert.throws(() => CubeWorld.fromData({ ...d, npcs: [{ name: 'A', pos: { x: 32, z: 0, layer: 9 }, route: [] }] }))
	assert.throws(() => CubeWorld.fromData({ ...d, npcs: [{ name: 'A', pos: { x: 0, z: 0, layer: 9 }, route: [{ x: 0, z: 0, layer: LAYER_COUNT }] }] }))
})

test('joined cubes and objects go through toData and fromData', () => {
	const w = CubeWorld.create(2, 2, false)
	assert.deepEqual(w.toData().joins, [])
	assert.deepEqual(w.toData().objects, [])
	w.joins = [{ id: 1, cubes: [{ x: 9, z: 2, layer: 9 }, { x: 10, z: 2, layer: 9 }] }]
	w.objects = [
		{ id: 1, kind: 0, face: 2, pos: { x: 9, z: 2, layer: 9 }, targets: [], state: 1 },
		{ id: 2, kind: 2, face: 2, pos: { x: 10, z: 2, layer: 9 }, targets: [1], state: 0 },
	]
	const d = w.toData()
	const back = CubeWorld.fromData(d)
	assert.deepEqual(back.joins, w.joins)
	assert.deepEqual(back.objects, w.objects)
	// The data is a copy: changing it leaves the world alone.
	d.objects![1].targets.push(5)
	assert.deepEqual(w.objects[1].targets, [1])
	assert.deepEqual(CubeWorld.fromData({ ...d, joins: null, objects: undefined }).objects, [])
	assert.throws(() => CubeWorld.fromData({ ...d, joins: [{ id: 1, cubes: [{ x: 32, z: 0, layer: 9 }] }] }))
	assert.throws(() => CubeWorld.fromData({ ...d, objects: [{ id: 1, kind: 0, face: 0, pos: { x: 0, z: 0, layer: LAYER_COUNT }, targets: [], state: 0 }] }))
})

test('painted faces go through toData and fromData, and emptying a cube clears its paint', () => {
	const w = CubeWorld.create(1, 1, false)
	w.set(3, 4, 10, STONE)
	w.set(5, 4, 10, STONE)
	const paint = new Uint16Array(PAINT_LEN)
	const up = 4
	paint[up * CHUNK_AREA + 4 * 16 + 3] = TEXTURES.indexOf('grass')
	paint[up * CHUNK_AREA + 4 * 16 + 5] = TEXTURES.indexOf('path')
	const d = w.toData()
	assert.equal(d.chunks[0].paint, '')
	d.chunks[0].paint = btoa(String.fromCharCode(...new Uint8Array(paint.buffer)))
	const back = CubeWorld.fromData(d)
	assert.equal(back.paintAt(3, 4, 10, up), TEXTURES.indexOf('grass'))
	assert.equal(back.paintAt(3, 4, 10, 0), 0)
	assert.equal(back.toData().chunks[0].paint, d.chunks[0].paint)
	back.set(3, 4, 10, 0)
	assert.equal(back.paintAt(3, 4, 10, up), 0)
	assert.equal(back.paintAt(5, 4, 10, up), TEXTURES.indexOf('path'))
	back.set(5, 4, 10, 0)
	assert.equal(back.toData().chunks.length, 0)
	assert.throws(() => CubeWorld.fromData({ ...d, chunks: [{ ...d.chunks[0], paint: btoa('abc') }] }))
})
