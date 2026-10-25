// Run with: bun test tests/watermapImport.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watermapCells } from '../src/lib/io/watermapImport.ts'
import { LiquidMap, layLiquidCells, newLayer, LIQUID_WATER, LIQUID_MAGMA } from '../src/lib/water/liquids.ts'

test('a cell gets water where its four corners are not black, at the ground plus its depth', () => {
	// A 2x2-cell map, 3x3 vertices: the left column grey, the middle white, the right column black.
	const ratios = Float32Array.from([0.5, 1, 0, 0.5, 1, 0, 0.5, 1, 0])
	const ground = Float32Array.from([10, 12, 14, 10, 12, 14, 10, 12, 14])
	const cells = watermapCells(ratios, ground, 2, 0, 4)
	// The right cells touch the black column and stay dry.
	assert.deepEqual(
		cells.map((c) => [c.x, c.z]),
		[
			[0, 0],
			[0, 1],
		],
	)
	assert.deepEqual(cells[0].heights, [12, 16, 12, 16])
	assert.equal(cells[0].id, LIQUID_WATER)
})

test('laying cells takes them from other liquids but leaves the cells not listed alone', () => {
	const map = new LiquidMap(16)
	const magma = newLayer(LIQUID_MAGMA, 5)
	magma.cells[0] = 1
	magma.cells[1] = 1
	map.set(0, [magma])
	const reserved: number[] = []
	const changed = layLiquidCells(map, [{ x: 1, z: 0, id: LIQUID_WATER, heights: [7, 7, 7, 7], depth: [1, 1, 1, 1] }], (c) => reserved.push(c))
	assert.deepEqual(changed, [0])
	assert.deepEqual(reserved, [0])
	const layers = map.layers(0)
	const lava = layers.find((l) => l.id === LIQUID_MAGMA)!
	const water = layers.find((l) => l.id === LIQUID_WATER)!
	assert.equal(lava.cells[0], 1)
	assert.equal(lava.cells[1], 0)
	assert.equal(water.cells[1], 1)
	assert.equal(water.heights[1], 7)
})
