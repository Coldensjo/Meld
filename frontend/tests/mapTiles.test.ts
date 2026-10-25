// Run with: bun test tests/mapTiles.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blockGaps, fullBlock, tileKey } from '../src/lib/io/mapTiles.ts'

const grid = (rows: string[], x0 = 30, y0 = 30) => rows.flatMap((r, j) => [...r].flatMap((c, i) => (c === '#' ? [{ X: x0 + i, Y: y0 + j }] : [])))

test('blockGaps counts the tiles of a block with no ADT', () => {
	const have = new Set(grid(['##', '#.']).map((t) => tileKey(t.X, t.Y)))
	assert.equal(blockGaps({ x: 30, y: 30, size: 2 }, have), 1)
	assert.equal(blockGaps({ x: 30, y: 30, size: 1 }, have), 0)
	assert.equal(blockGaps({ x: 0, y: 0, size: 3 }, have), 9)
})

test('fullBlock picks the biggest square wholly on the tiles', () => {
	const tiles = grid(['#...', '.###', '.###', '.###'])
	assert.deepEqual(fullBlock(tiles, 8), { x: 31, y: 31, size: 3 })
	assert.deepEqual(fullBlock(tiles, 2), { x: 31, y: 31, size: 2 })
})

test('fullBlock is null for a map without tiles, a WMO-only instance', () => {
	assert.equal(fullBlock([], 8), null)
})
