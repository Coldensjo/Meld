// Run with: bun test tests/minimapImage.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MinimapDrawn, minimapScale, shadeHeights } from '../src/lib/io/minimapImage.ts'

test('ground is grey from low to high and water is blue', () => {
	const size = 2
	// Vertices row-major, (size+1) a side: one cell under the sea, the others rising.
	const heights = Float32Array.from([-10, 0, 0, 5, 10, 10, 10, 10, 10])
	const out = new Uint8ClampedArray(size * size * 4)
	shadeHeights(heights, size, 0, out)
	const px = (i: number) => [...out.subarray(i * 4, i * 4 + 4)]
	// Cell (0, 0) reads the vertex at -10: under the sea, so blue.
	assert.ok(px(0)[2] > px(0)[0])
	// Cell (1, 1) reads the vertex at 10, the highest: the lightest grey.
	assert.equal(px(3)[0], 220)
	assert.equal(px(3)[3], 255)
	// Cell (1, 0) reads the vertex at 0, the sea level: the darkest dry grey.
	assert.equal(px(1)[0], 70)
})

test('a small map saves at least 512 pixels across', () => {
	assert.equal(minimapScale(128), 4)
	assert.equal(minimapScale(512), 1)
	assert.equal(minimapScale(2048), 1)
})

test('the minimap redraws for another map at the same size and heights version (#749)', () => {
	const drawn = new MinimapDrawn()
	const a = {}
	const b = {}
	assert.equal(drawn.stale(a, 1, 0), true)
	assert.equal(drawn.stale(a, 1, 0), false)
	// A new world of the same size: its own terrain, also at version 1.
	assert.equal(drawn.stale(b, 1, 0), true)
	assert.equal(drawn.stale(b, 2, 0), true)
	assert.equal(drawn.stale(b, 2, 5), true)
	assert.equal(drawn.stale(b, 2, -Infinity), true)
	assert.equal(drawn.stale(b, 2, -Infinity), false)
	// Back to the first tab.
	assert.equal(drawn.stale(a, 1, 0), true)
})
