// Run with: bun test tests/worldDetail.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worldCellDetail, type WorldTileData } from '../src/lib/world/worldDetail.ts'
import { GROUND_CELLS, GROUND_SIDE } from '../src/lib/world/worldGround.ts'
import { PAINT_SIDE } from '../src/lib/world/worldPaint.ts'
import type { TileLiquid } from '../src/lib/world/worldLiquid.ts'
import { TILE_YARDS } from '../src/lib/wow/format.ts'

const CELL = TILE_YARDS / GROUND_CELLS
const NO = 255

/** Tile (10, 20), flat, with every cell solid, unpainted and dry. */
function tile(): WorldTileData {
	const cells = GROUND_CELLS * GROUND_CELLS
	const ground = { heights: new Float32Array(GROUND_SIDE * GROUND_SIDE), holes: new Uint8Array(cells), noEffect: new Uint8Array(cells), areas: new Uint32Array(256), impassable: new Uint8Array(256) }
	return { x: 10, y: 20, ground, paint: null, liquids: null }
}

/** The world point in the middle of tile (10, 20)'s cell (cx, cy). */
const at = (cx: number, cy: number) => [(10 * GROUND_CELLS + cx + 0.5) * CELL, (20 * GROUND_CELLS + cy + 0.5) * CELL] as const

test('worldCellDetail names the chunk and cell in the tile, and its hole', () => {
	const t = tile()
	t.ground.holes[19 * GROUND_CELLS + 27] = 1
	const d = worldCellDetail(t, ...at(27, 19))
	assert.deepEqual([d.chunkX, d.chunkY, d.cellX, d.cellY, d.hole], [3, 2, 27, 19, true])
	assert.equal(worldCellDetail(t, ...at(28, 19)).hole, false)
	assert.deepEqual([d.noTufts, d.area, d.impassable], [false, 0, false])
	// Chunk (3, 2)'s zone and flag, and cell (27, 19)'s no-tufts bit.
	t.ground.areas[2 * 16 + 3] = 1519
	t.ground.impassable[2 * 16 + 3] = 1
	t.ground.noEffect[19 * GROUND_CELLS + 27] = 1
	const f = worldCellDetail(t, ...at(27, 19))
	assert.deepEqual([f.noTufts, f.area, f.impassable], [true, 1519, true])
	const g = worldCellDetail(t, ...at(28, 19))
	assert.deepEqual([g.noTufts, g.area, g.impassable], [false, 1519, true])
	assert.equal(worldCellDetail(t, ...at(32, 19)).area, 0)
	// Unpainted: no textures to tell, rather than none.
	assert.equal(d.textures, null)
	assert.deepEqual(d.liquids, [])
})

test("worldCellDetail shares the cell's texels among its chunk's slots", () => {
	const t = tile()
	const slots = new Uint8Array(16 * 16 * 4).fill(NO)
	// Chunk (3, 2): grass in slot 0, dirt in slot 1.
	const chunk = 2 * 16 + 3
	slots[chunk * 4] = 1
	slots[chunk * 4 + 1] = 0
	const weights = new Uint8Array(PAINT_SIDE * PAINT_SIDE * 4)
	// Cell (27, 19)'s 4x4 texels: the top half all grass, the bottom half all dirt.
	for (let v = 0; v < 4; v++)
		for (let u = 0; u < 4; u++) {
			const i = ((19 * 4 + v) * PAINT_SIDE + 27 * 4 + u) * 4
			weights[i + (v < 2 ? 0 : 1)] = 255
		}
	t.paint = { names: ['dirt.blp', 'grass.blp'], slots, weights }
	assert.deepEqual(worldCellDetail(t, ...at(27, 19)).textures, [
		{ path: 'grass.blp', weight: 0.5 },
		{ path: 'dirt.blp', weight: 0.5 },
	])
})

test('worldCellDetail lists the liquid layers covering the cell, at its corner', () => {
	const t = tile()
	const water = (indexX: number, indexY: number, covered: number): TileLiquid => {
		const heights = new Float32Array(81)
		heights[3 * 9 + 3] = 42.5
		const cells = new Uint8Array(64)
		cells[covered] = 1
		return { indexX, indexY, type: 1, heights, depth: new Uint8Array(81), cells }
	}
	// Cell (27, 19) is (3, 3) in chunk (3, 2): only the first layer covers it.
	t.liquids = [water(3, 2, 3 * 8 + 3), water(3, 2, 0), water(2, 2, 3 * 8 + 3)]
	assert.deepEqual(worldCellDetail(t, ...at(27, 19)).liquids, [{ type: 1, height: 42.5 }])
})
