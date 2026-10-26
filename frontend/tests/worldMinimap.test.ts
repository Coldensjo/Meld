// Run with: bun test tests/worldMinimap.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worldExtent } from '../src/lib/world/worldMinimap.ts'

const key = (x: number, y: number) => x + 64 * y

test('worldExtent is null for a map with no tiles', () => {
	assert.equal(worldExtent([]), null)
})

test('worldExtent of one tile is that tile', () => {
	assert.deepEqual(worldExtent([key(31, 48)]), { x: 31, y: 48, n: 1 })
})

test('worldExtent is the square round a tall map, the tiles centred across it', () => {
	// Tiles 30..32 across, 10..19 down: ten a side, the three columns in the middle.
	const keys = []
	for (let y = 10; y < 20; y++) for (let x = 30; x < 33; x++) keys.push(key(x, y))
	assert.deepEqual(worldExtent(keys), { x: 27, y: 10, n: 10 })
})

test('worldExtent stays on the map', () => {
	// Tiles 0..1 across and 0..5 down: centring would start the square left of tile 0.
	assert.deepEqual(worldExtent([key(0, 0), key(1, 5)]), { x: 0, y: 0, n: 6 })
	// The same against the east and south edges.
	assert.deepEqual(worldExtent([key(63, 63), key(62, 58)]), { x: 58, y: 58, n: 6 })
})
