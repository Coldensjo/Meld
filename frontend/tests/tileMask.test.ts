// Run with: bun test tests/tileMask.test.ts
import { describe, expect, test } from 'bun:test'
import { MAX_WORLD_TILES, boundingSquare, editTiles, gridTile, maskBytes, maskOf, placeTiles } from '../src/lib/terrain/tileMask'
import { CoastShape, presetHeight } from '../src/lib/terrain/presets'

const set = (...t: Array<[number, number]>) => new Set(t.map(([x, y]) => gridTile(x, y)))

describe("a new world's tiles on the 64×64 grid (#46)", () => {
	test('the square is the smallest that holds the tiles, kept on the grid', () => {
		expect(boundingSquare(set([31, 31]))).toEqual({ x: 31, y: 31, size: 1 })
		// An L of three: a 2×2 square.
		expect(boundingSquare(set([10, 5], [11, 5], [10, 6]))).toEqual({ x: 10, y: 5, size: 2 })
		// A row of three at the grid's south edge: the square reaches north instead.
		expect(boundingSquare(set([4, 63], [5, 63], [6, 63]))).toEqual({ x: 4, y: 61, size: 3 })
		expect(boundingSquare(new Set())).toBeNull()
		// The square a map has can't shrink.
		expect(boundingSquare(set([3, 3]), { x: 2, y: 2, size: 3 })).toEqual({ x: 2, y: 2, size: 3 })
		expect(boundingSquare(set([6, 2]), { x: 2, y: 2, size: 3 })).toEqual({ x: 2, y: 2, size: 5 })
	})

	test('the mask is a 1 or 0 a tile of the square, row by row, and empty for a whole square', () => {
		const tiles = set([10, 5], [11, 5], [10, 6])
		const sq = boundingSquare(tiles)!
		expect(maskOf(sq, tiles)).toBe('1110')
		expect(maskOf(sq, set([10, 5], [11, 5], [10, 6], [11, 6]))).toBe('')
		expect([...maskBytes('1110', 2)!]).toEqual([1, 1, 1, 0])
		expect(maskBytes('', 2)).toBeNull()
		expect(maskBytes('1111', 2)).toBeNull()
		// A mask that doesn't fit the square is taken as every tile.
		expect(maskBytes('110', 2)).toBeNull()
		expect(placeTiles({ tileX: 10, tileY: 5, tiles: '1110' }, 2)).toEqual(tiles)
		expect(placeTiles({}, 1)).toEqual(set([0, 0]))
	})

	test('a click adds, Ctrl takes away, Shift adds the 3×3; the last tile and a square past 8×8 are refused', () => {
		const one = set([20, 20])
		expect(editTiles(one, 21, 20, 'add')).toEqual({ tiles: set([20, 20], [21, 20]) })
		const r3 = editTiles(one, 0, 0, 'add3')
		// The square reaches from 0,0 to 20,20: too big.
		expect('error' in r3).toBe(true)
		const near = editTiles(one, 21, 21, 'add3')
		expect('tiles' in near && near.tiles.size).toBe(9)
		// At the grid's corner, the 3×3 keeps to the grid.
		const corner = editTiles(set([0, 0]), 0, 0, 'add3')
		expect('tiles' in corner && corner.tiles).toEqual(set([0, 0], [1, 0], [0, 1], [1, 1]))
		expect(editTiles(one, 20, 20, 'remove')).toEqual({ error: 'A map keeps one tile at least.' })
		expect('error' in editTiles(one, 20 + MAX_WORLD_TILES, 20, 'add')).toBe(true)
		expect('tiles' in editTiles(one, 20 + MAX_WORLD_TILES - 1, 20, 'add')).toBe(true)
		// With the map's square kept, a tile far from it is refused too.
		expect('error' in editTiles(one, 25, 20, 'add', { x: 14, y: 20, size: 3 })).toBe(true)
	})

	test("a preset's coast follows the picked tiles: land on them, sea at a tile left out", () => {
		// An L of three tiles in a 2×2 square, the south-east one left out.
		const shape = new CoastShape(new Uint8Array([1, 1, 1, 0]), 2)
		expect(shape.present(0.25, 0.25)).toBe(true)
		expect(shape.present(0.75, 0.75)).toBe(false)
		expect(shape.depth(0.75, 0.75)).toBe(0)
		expect(shape.depth(0, 0)).toBeLessThan(0.05)
		let land = 0
		let off = -Infinity
		for (let i = 0; i < 20; i++) {
			for (let j = 0; j < 20; j++) {
				const u = (i + 0.5) / 20
				const v = (j + 0.5) / 20
				const h = presetHeight('island', u, v, 7, { tiles: 2, shape })
				if (!shape.present(u, v)) off = Math.max(off, h)
				else if (h > 0) land++
			}
		}
		// The tile left out is all seabed, and the arms of the L hold land.
		expect(off).toBeLessThan(0)
		expect(land).toBeGreaterThan(50)
		// Without a shape, the island is as it always was.
		expect(presetHeight('island', 0.5, 0.5, 7, { tiles: 2, shape: null })).toBe(presetHeight('island', 0.5, 0.5, 7, { tiles: 2 }))
	})
})
