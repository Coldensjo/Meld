// Run with: bun test tests/regionGrow.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { growableSides, grownBlock } from '../src/lib/io/regionGrow.ts'

test('growing east or south keeps the origin and adds a tile a side', () => {
	assert.deepEqual(grownBlock({ x: 30, y: 40, size: 2 }, 'e'), { x: 30, y: 40, size: 3 })
	assert.deepEqual(grownBlock({ x: 30, y: 40, size: 2 }, 's'), { x: 30, y: 40, size: 3 })
})

test('growing north or west moves the origin that way', () => {
	assert.deepEqual(grownBlock({ x: 30, y: 40, size: 2 }, 'n'), { x: 30, y: 39, size: 3 })
	assert.deepEqual(grownBlock({ x: 30, y: 40, size: 2 }, 'w'), { x: 29, y: 40, size: 3 })
})

test('at the map edge the other axis grows the other way, and off the map there is no growth', () => {
	assert.deepEqual(grownBlock({ x: 62, y: 10, size: 2 }, 'n'), { x: 61, y: 9, size: 3 }, 'no room east, so west')
	assert.equal(grownBlock({ x: 62, y: 10, size: 2 }, 'e'), null)
	assert.equal(grownBlock({ x: 0, y: 10, size: 2 }, 'w'), null)
	assert.equal(grownBlock({ x: 10, y: 0, size: 2 }, 'n'), null)
	assert.deepEqual(grownBlock({ x: 10, y: 62, size: 2 }, 'w'), { x: 9, y: 61, size: 3 }, 'no room south, so north')
})

test('the largest region grows no more', () => {
	assert.equal(grownBlock({ x: 10, y: 10, size: 16 }, 'e'), null)
	assert.deepEqual(growableSides({ x: 10, y: 10, size: 16 }), [])
	assert.deepEqual(growableSides({ x: 0, y: 0, size: 1 }), ['e', 's'])
	assert.deepEqual(growableSides({ x: 30, y: 30, size: 4 }), ['n', 'e', 's', 'w'])
})
