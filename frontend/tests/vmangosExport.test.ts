// Run with: bun test tests/vmangosExport.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../src/lib/terrain/chunkPaint.ts'
import { mapToTiles, toBase64, TILE_CELLS, type ExportInput } from '../src/lib/io/vmangosExport.ts'
import { base64ToFloats } from '../src/lib/io/base64.ts'

const CELL = 1600 / 3 / 128

/** A map of `size` cells with flat paint from palette 0 and heights that count up. */
function input(size: number, over: Partial<ExportInput> = {}): ExportInput {
	const V = size + 1
	const heights = new Float32Array(V * V)
	for (let i = 0; i < heights.length; i++) heights[i] = i
	const splatRes = size * SPLAT_PER_CELL
	const weights = new Uint8Array(splatRes * splatRes * SLOTS)
	for (let i = 0; i < weights.length; i += SLOTS) weights[i] = 255
	const side = size / 8
	const chunkSlots = new Uint8Array(side * side * SLOTS).fill(NO_TEXTURE)
	for (let c = 0; c < side * side; c++) chunkSlots[c * SLOTS] = 0
	return {
		size,
		cellSize: CELL,
		heights,
		weights,
		chunkSlots,
		palette: ['Tileset\\Elwynn\\Grass.blp', 'Tileset\\Elwynn\\Dirt.blp', 'Tileset\\Elwynn\\Rock.blp'],
		objects: [],
		waterEnabled: false,
		waterLevel: 0,
		...over,
	}
}

test('a 256-cell map cuts into four 128-cell tiles, with their own heights', () => {
	const inp = input(256)
	const out = mapToTiles(inp)
	assert.equal(out.tiles.length, 4)
	const t = out.tiles.find((x) => x.X === 1 && x.Y === 0)!
	// The heights cross the bridge as base64 of their float32s (#632).
	assert.equal(typeof t.Outer, 'string')
	const outer = base64ToFloats(t.Outer)
	assert.equal(outer.length, 129 * 129)
	// Tile (1,0) starts 128 cells in: its first sample is map sample (0, 128).
	assert.equal(outer[0], inp.heights[128])
	assert.equal(outer[129 + 2], inp.heights[1 * 257 + 128 + 2])
})

test('a map that does not cut into whole tiles is refused', () => {
	assert.throws(() => mapToTiles(input(200)), /whole number of 128-cell tiles/)
})

test('paint keeps only the used slots, in order, with their weights', () => {
	const inp = input(128)
	// Chunk 0: slot 0 empty, slot 1 is palette 2 (rock) with the texel's weight in slot 1.
	inp.chunkSlots[0] = NO_TEXTURE
	inp.chunkSlots[1] = 2
	for (let t = 0; t < inp.weights.length / SLOTS; t++) {
		inp.weights[t * SLOTS] = 0
		inp.weights[t * SLOTS + 1] = 255
	}
	const out = mapToTiles(inp)
	const chunk = out.tiles[0].Paint.find((p) => p.Chunk === 0)!
	assert.deepEqual(chunk.Textures, ['Tileset\\Elwynn\\Rock.blp'])
	const w = Buffer.from(chunk.Weights, 'base64')
	assert.equal(w[0], 255, 'the rock texel keeps its full weight')
	assert.equal(w.length, 32 * 32 * 4)
})

test('a chunk painted with a colour is left out and counted', () => {
	const inp = input(128, { palette: ['#5d8a2f'] })
	const out = mapToTiles(inp)
	assert.equal(out.tiles[0].Paint.length, 0)
	assert.equal(out.colorChunks, 256)
})

test("a model goes to the tile it stands in, in that tile's own coordinates", () => {
	const tileYards = TILE_CELLS * CELL
	const inp = input(256, {
		objects: [
			{ type: 'm2:World\\Test\\Rock.m2', x: tileYards + 10, y: 42, z: 20, rotY: 0.5, tiltX: 0.1, tiltZ: -0.2, scale: 1 },
			{ type: 'wmo:World\\Test\\Hut.wmo', x: 5, y: 3, z: 6, rotY: 0, scale: 1 },
			{ type: 'm2:World\\Test\\Far.m2', x: -50, y: 0, z: 0, rotY: 0, scale: 1 },
		],
	})
	const out = mapToTiles(inp)
	const east = out.tiles.find((t) => t.X === 1 && t.Y === 0)!
	assert.equal(east.Objects.length, 1)
	assert.ok(Math.abs(east.Objects[0].X - 10) < 1e-6, 'x is measured from the tile')
	assert.equal(east.Objects[0].TiltX, 0.1, 'the tilt goes out with the model')
	assert.equal(east.Objects[0].TiltZ, -0.2)
	const west = out.tiles.find((t) => t.X === 0 && t.Y === 0)!
	assert.equal(west.Objects[0].Type, 'wmo:World\\Test\\Hut.wmo')
	assert.equal(west.Objects[0].TiltX, 0, 'a model without a tilt goes out level')
	assert.equal(out.outside, 1)
})

test('base64 of bytes round-trips', () => {
	const bytes = Uint8Array.from({ length: 70000 }, (_, i) => i * 7)
	assert.deepEqual(Buffer.from(toBase64(bytes), 'base64'), Buffer.from(bytes))
})

test('the no-doodad cells go out per chunk as row bits, and only for chunks that have any', () => {
	const size = 128
	const noEffect = new Uint8Array(size * size)
	noEffect[0] = 1
	noEffect[1 * size + 9] = 1
	const { tiles } = mapToTiles(input(size, { noEffect }))
	const first = tiles[0].Paint.find((p) => p.Chunk === 0)!
	assert.deepEqual(first.NoEffect, [1, 0, 0, 0, 0, 0, 0, 0])
	const second = tiles[0].Paint.find((p) => p.Chunk === 1)!
	assert.deepEqual(second.NoEffect, [0, 2, 0, 0, 0, 0, 0, 0])
	assert.equal(tiles[0].Paint.find((p) => p.Chunk === 2)!.NoEffect, undefined)
})
