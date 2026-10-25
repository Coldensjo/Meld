// Run with: bun test tests/roles.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guessRoles, slopeDegrees, slopeWeights, validRoles } from '../src/lib/terrain/roles.ts'

test('a zone palette names its rock and dirt', () => {
	const r = guessRoles(['Tileset\\Elwynn\\ElwynnGrassBase.blp', 'Tileset\\Elwynn\\ElwynnFlowerBase.blp', 'Tileset\\Elwynn\\ElwynnRockBase.blp', 'Tileset\\Elwynn\\ElwynnDirtBase.blp'])
	assert.deepEqual(r, { rock: 2, dirt: 3 })
})

test('the colour palette falls back to its fixed slots, and a palette with neither has none', () => {
	assert.deepEqual(guessRoles(['#1', '#2', '#3', '#4', '#5']), { rock: 3, dirt: 2 })
	assert.deepEqual(guessRoles(['Tileset\\Elwynn\\ElwynnGrassBase.blp']), { rock: -1, dirt: -1 })
	assert.deepEqual(guessRoles(['Tileset\\Barrens\\BarrensRockyDirt.blp']), { rock: 0, dirt: -1 }, 'one texture fills one role only')
})

test('roles outside the palette are dropped', () => {
	assert.deepEqual(validRoles({ rock: 3, dirt: 7 }, 4), { rock: 3, dirt: -1 })
	assert.deepEqual(validRoles({ rock: -1, dirt: 1.5 }, 4), { rock: -1, dirt: -1 })
})

test('slope weights: flat ground gets nothing, moderate slopes dirt, steep slopes rock', () => {
	const out = new Float32Array(2)
	assert.deepEqual([...slopeWeights(5, 40, 22, out)], [0, 0])
	const [rockMid, dirtMid] = slopeWeights(30, 40, 22, out)
	assert.ok(rockMid < 0.05 && dirtMid > 0.95, `moderate: rock ${rockMid}, dirt ${dirtMid}`)
	const [rockSteep, dirtSteep] = slopeWeights(60, 40, 22, out)
	assert.ok(rockSteep > 0.99 && dirtSteep < 0.01, `steep: rock ${rockSteep}, dirt ${dirtSteep}`)
	const [r, d] = slopeWeights(40, 40, 22, out)
	assert.ok(Math.abs(r - 0.5) < 1e-6 && Math.abs(d - 0.5) < 1e-6, 'the rock angle itself is half rock, half dirt')
})

test('the slope angle comes from the gradient', () => {
	assert.equal(slopeDegrees(0, 0), 0)
	assert.ok(Math.abs(slopeDegrees(1, 0) - 45) < 1e-9)
	assert.ok(Math.abs(slopeDegrees(0, Math.sqrt(3)) - 60) < 1e-9)
})
