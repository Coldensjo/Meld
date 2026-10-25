// Run with: bun test tests/heightmapImport.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IMAGE_MAX, IMAGE_MIN, imageRatios, importHeights } from '../src/lib/io/heightmapImport.ts'

test("an image of the map's size reads back exactly with Set between the image range", () => {
	const heights = [IMAGE_MIN, 0, 100, IMAGE_MAX]
	const r = imageRatios({ side: 2, heights }, 2)
	assert.deepEqual([...r], [0, 0.5, (100 - IMAGE_MIN) / 2048, 1])
	const out = importHeights(new Float32Array(4), r, 'set', IMAGE_MIN, IMAGE_MAX)
	assert.deepEqual([...out], heights)
})

test('the modes put the min-to-max heights onto the ground', () => {
	const r = Float32Array.from([0, 0.5, 1])
	const ground = Float32Array.from([10, 10, 10])
	assert.deepEqual([...importHeights(ground, r, 'set', 0, 20)], [0, 10, 20])
	assert.deepEqual([...importHeights(ground, r, 'add', 0, 20)], [10, 20, 30])
	assert.deepEqual([...importHeights(ground, r, 'subtract', 0, 20)], [10, 0, -10])
	assert.deepEqual([...importHeights(ground, r, 'multiply', 1, 3)], [10, 20, 30])
})

test('an image of another size is stretched over the map', () => {
	// A 2x2 image black on the left, white on the right, read onto 3x3: the middle column is grey.
	const r = imageRatios({ side: 2, heights: [IMAGE_MIN, IMAGE_MAX, IMAGE_MIN, IMAGE_MAX] }, 3)
	assert.deepEqual([...r], [0, 0.5, 1, 0, 0.5, 1, 0, 0.5, 1])
})

test('a tile import touches only its tile; tiled edges leave the shared vertices alone', async () => {
	const { importHeightsOnTile } = await import('../src/lib/io/heightmapImport.ts')
	// A 5x5 vertex grid, two tiles of two cells a side: the second tile starts at vertex 2.
	const current = new Float32Array(25).fill(7)
	const full = importHeightsOnTile(current, 5, new Float32Array(9).fill(1), 2, 2, 'set', 0, 10)
	assert.equal(full[2 * 5 + 2], 10)
	assert.equal(full[4 * 5 + 4], 10)
	assert.equal(full[1 * 5 + 1], 7, 'outside the tile')
	const tiled = importHeightsOnTile(current, 5, new Float32Array(4).fill(1), 0, 0, 'add', 0, 10)
	assert.equal(tiled[1 * 5 + 1], 17)
	assert.equal(tiled[2 * 5 + 2], 7, 'the vertex shared with the next tiles keeps its height')
})
