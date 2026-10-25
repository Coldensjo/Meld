// Run with: bun test tests/chunkFlags.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHUNK_IMPASSABLE, areaColor, forEachSquare, squaresUnder, type GridRect } from '../src/lib/terrain/chunkFlags.ts'
import { NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../src/lib/terrain/chunkPaint.ts'
import { mapToTiles, type ExportInput } from '../src/lib/io/vmangosExport.ts'
import { SHADOW_PER_CELL } from '../src/lib/terrain/bakedShadows.ts'

const rect = (): GridRect => ({ x0: 0, z0: 0, x1: 0, z1: 0 })

test('the squares whose centre is in the brush are visited, and their rect is returned', () => {
	const seen: number[] = []
	const r = rect()
	// Squares of 10 yards on a 4x4 grid; a brush of 8 at (20, 20) reaches the four centres around it.
	assert.ok(forEachSquare(4, 10, 20, 20, 8, r, (i) => seen.push(i)))
	assert.deepEqual(
		seen.sort((a, b) => a - b),
		[5, 6, 9, 10],
	)
	assert.deepEqual(r, { x0: 1, z0: 1, x1: 2, z1: 2 })
})

test('a brush smaller than a square still reaches the square under it, and none off the grid', () => {
	const seen: number[] = []
	const r = rect()
	assert.ok(squaresUnder(4, 10, 32, 7, 1, r, (i) => seen.push(i)))
	assert.deepEqual(seen, [3])
	assert.deepEqual(r, { x0: 3, z0: 0, x1: 3, z1: 0 })
	assert.equal(
		squaresUnder(4, 10, 45, 7, 1, rect(), () => assert.fail('off the grid')),
		false,
	)
})

test('a zone colour is black for none and stable for an ID', () => {
	const a = new Uint8Array(6)
	areaColor(0, a, 0)
	areaColor(12, a, 3)
	assert.deepEqual([...a.subarray(0, 3)], [0, 0, 0])
	assert.ok(a[3] + a[4] + a[5] > 0)
	const b = new Uint8Array(3)
	areaColor(12, b, 0)
	assert.deepEqual([...b], [...a.subarray(3)])
})

/** A one-tile map with a zone and the impassable flag in two chunks. */
function input(headers: boolean): ExportInput {
	const size = 128
	const splatRes = size * SPLAT_PER_CELL
	const weights = new Uint8Array(splatRes * splatRes * SLOTS)
	for (let i = 0; i < weights.length; i += SLOTS) weights[i] = 255
	const chunkSlots = new Uint8Array(16 * 16 * SLOTS).fill(NO_TEXTURE)
	for (let c = 0; c < 256; c++) chunkSlots[c * SLOTS] = 0
	const areaIds = new Uint32Array(256)
	const chunkFlags = new Uint8Array(256)
	areaIds[17] = 40
	chunkFlags[17] = CHUNK_IMPASSABLE
	areaIds[255] = 12
	return {
		size,
		cellSize: 1600 / 3 / 128,
		heights: new Float32Array(129 * 129),
		weights,
		chunkSlots,
		palette: ['Tileset\\Elwynn\\Grass.blp'],
		objects: [],
		waterEnabled: false,
		waterLevel: 0,
		headers: headers ? { areaIds, chunkFlags } : undefined,
	}
}

test('the export sends every chunk header, with its zone and flag', () => {
	const h = mapToTiles(input(true)).tiles[0].Headers!
	assert.equal(h.length, 256)
	assert.deepEqual(h[17], { chunk: 17, areaId: 40, impassable: true })
	assert.deepEqual(h[255], { chunk: 255, areaId: 12, impassable: false })
	assert.deepEqual(h[0], { chunk: 0, areaId: 0, impassable: false })
})

test('the header carries every chunk’s no-tuft rows, zeros included, so a cleared cell comes off', () => {
	const inp = input(true)
	inp.noEffect = new Uint8Array(128 * 128)
	// Cell (9, 8) is in chunk (1, 1): row 0, bit 1.
	inp.noEffect[8 * 128 + 9] = 1
	const h = mapToTiles(inp).tiles[0].Headers!
	assert.deepEqual(h[17].noEffect, [2, 0, 0, 0, 0, 0, 0, 0])
	assert.deepEqual(h[0].noEffect, [0, 0, 0, 0, 0, 0, 0, 0])
})

test('the header carries every chunk’s hole cells, which Go turns into blocks', () => {
	const inp = input(true)
	inp.holes = new Uint8Array(128 * 128)
	// Cells (8, 8) and (9, 8) are in chunk (1, 1), row 0.
	inp.holes[8 * 128 + 8] = 1
	inp.holes[8 * 128 + 9] = 1
	const h = mapToTiles(inp).tiles[0].Headers!
	assert.deepEqual(h[17].holes, [3, 0, 0, 0, 0, 0, 0, 0])
	assert.deepEqual(h[16].holes, [0, 0, 0, 0, 0, 0, 0, 0])
})

test('a map without chunk data, holes or shadows sends no headers, which keeps the tile’s own', () => {
	assert.equal(mapToTiles(input(false)).tiles[0].Headers, undefined)
})

test('a map without chunk data still sends its holes and shadows, keeping the tile’s zones, flags and no-tuft cells (#644)', () => {
	const inp = input(false)
	inp.noEffect = new Uint8Array(128 * 128)
	inp.noEffect[8 * 128 + 9] = 1
	inp.holes = new Uint8Array(128 * 128)
	inp.holes[8 * 128 + 8] = 1
	inp.shadows = new Uint8Array(128 * SHADOW_PER_CELL * 128 * SHADOW_PER_CELL)
	const h = mapToTiles(inp).tiles[0].Headers!
	assert.equal(h.length, 256)
	assert.deepEqual(h[17].holes, [1, 0, 0, 0, 0, 0, 0, 0])
	assert.deepEqual(h[16].holes, [0, 0, 0, 0, 0, 0, 0, 0])
	assert.equal(typeof h[17].shadow, 'string')
	assert.equal(h[17].areaId, 0)
	assert.equal('impassable' in h[17], false)
	assert.equal('noEffect' in h[17], false)
})

test('a map that doesn’t know the client’s holes adds its own to them, and leaves the chunks without any alone (#663)', () => {
	const inp = input(false)
	inp.holes = new Uint8Array(128 * 128)
	inp.holes[8 * 128 + 8] = 1
	inp.holesAdd = true
	const h = mapToTiles(inp).tiles[0].Headers!
	assert.deepEqual(h[17].holes, [1, 0, 0, 0, 0, 0, 0, 0])
	assert.equal(h[17].holesAdd, true)
	assert.equal('holes' in h[16], false)
	assert.equal('holesAdd' in h[16], false)
	// Known, every chunk's holes are sent and replace the tile's.
	inp.holesAdd = false
	const known = mapToTiles(inp).tiles[0].Headers!
	assert.deepEqual(known[16].holes, [0, 0, 0, 0, 0, 0, 0, 0])
	assert.equal('holesAdd' in known[17], false)
})
