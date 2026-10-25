// Run with: bun test tests/holeBlocks.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapToBlocks } from '../src/lib/terrain/holes.ts'

test('a cell grows to its whole 2x2 block', () => {
	assert.deepEqual(snapToBlocks({ x0: 3, z0: 4, x1: 3, z1: 4 }, 16), { x0: 2, z0: 4, x1: 3, z1: 5 })
})

test('a rect grows out to the blocks it touches, clipped to the map', () => {
	assert.deepEqual(snapToBlocks({ x0: 1, z0: 0, x1: 4, z1: 15 }, 16), { x0: 0, z0: 0, x1: 5, z1: 15 })
})
