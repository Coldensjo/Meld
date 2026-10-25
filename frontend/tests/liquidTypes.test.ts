// Run with: bun test tests/liquidTypes.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIQUID_TYPES, kindOfDbcType, liquidType, setLiquidTypes, tileLiquidType } from '../src/lib/water/liquids.ts'

test("the client's LiquidType rows replace the base list, each drawn as its kind", () => {
	setLiquidTypes([
		{ id: 21, name: 'Naxxramas - Slime', kind: 2 },
		{ id: 1, name: 'Water', kind: 3 },
		{ id: 2, name: 'Ocean', kind: 3 },
		{ id: 3, name: 'Magma', kind: 0 },
		{ id: 4, name: 'Slime', kind: 2 },
	])
	assert.deepEqual(
		LIQUID_TYPES.map((t) => [t.id, t.kind]),
		[
			[1, 'river'],
			[2, 'ocean'],
			[3, 'magma'],
			[4, 'slime'],
			[21, 'slime'],
		],
	)
	assert.equal(liquidType(21).texture, liquidType(4).texture, 'the dungeon slime looks like slime')
	// A tile stores the kind: the dungeon slime is written as slime.
	assert.equal(tileLiquidType(21), 4)
	assert.equal(tileLiquidType(2), 2)
	assert.equal(tileLiquidType(99), 1, 'an unknown id falls back to water')
})

test('the type column maps to a kind, with the ocean told apart by its id', () => {
	assert.equal(kindOfDbcType(1, 3), 'river')
	assert.equal(kindOfDbcType(2, 3), 'ocean')
	assert.equal(kindOfDbcType(3, 0), 'magma')
	assert.equal(kindOfDbcType(21, 2), 'slime')
	assert.equal(kindOfDbcType(50, 9), 'river', 'an unknown type reads as water')
})

test('an empty table leaves the list alone', () => {
	const before = LIQUID_TYPES.length
	setLiquidTypes([])
	assert.equal(LIQUID_TYPES.length, before)
})
