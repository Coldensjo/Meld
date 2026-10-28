// Run with: bun test tests/spawnBrush.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { brushLevels, entryFrom, facingTurn, newSpawnBrush, pickSpawnEntry, spacedOut, targetCount } from '../src/lib/tools/spawnBrush.ts'

const tmpl = { entry: 299, name: 'Young Wolf', subname: '', levelMin: 1, levelMax: 2, faction: 32, npcFlags: 0, rank: 0, type: 1, display: 903, scale: 1, equipment: 0 }

test('the density is creatures per 100 by 100 yards of the brush circle', () => {
	// A circle of 56.4 yd radius is 10,000 yd².
	assert.equal(targetCount(12, Math.sqrt(10000 / Math.PI)), 12)
	assert.equal(targetCount(12, 0), 0)
	assert.equal(targetCount(4, 20), 1) // 0.5 rounds up
})

test('entries are drawn by weight; none with weight gives -1', () => {
	const a = entryFrom(tmpl, 3)
	const b = entryFrom({ ...tmpl, entry: 69 }, 1)
	assert.equal(pickSpawnEntry([a, b], 0), 0)
	assert.equal(pickSpawnEntry([a, b], 0.74), 0)
	assert.equal(pickSpawnEntry([a, b], 0.76), 1)
	assert.equal(pickSpawnEntry([entryFrom(tmpl, 0)], 0.5), -1)
	assert.equal(pickSpawnEntry([], 0.5), -1)
})

test('spacing keeps creatures apart', () => {
	const near = [0, 0, 10, 0]
	assert.ok(!spacedOut(3, 0, 5, near, 2))
	assert.ok(spacedOut(5, 0, 5, near, 2))
	// Only the first `count` points count.
	assert.ok(spacedOut(9, 0, 5, near, 1))
})

test('facing: toward the centre, or random', () => {
	assert.ok(Math.abs(facingTurn('centre', 0, 0, 10, 0, 0.3)) < 1e-9)
	assert.ok(Math.abs(facingTurn('centre', 0, 0, 0, 10, 0.3) + Math.PI / 2) < 1e-9)
	assert.ok(Math.abs(facingTurn('random', 0, 0, 10, 0, 0.25) - Math.PI / 2) < 1e-9)
	// At the centre itself there is nothing to face.
	assert.ok(Math.abs(facingTurn('centre', 10, 0, 10, 0, 0.5) - Math.PI) < 1e-9)
})

test("levels: the template's unless the brush sets a range", () => {
	const b = newSpawnBrush()
	const e = entryFrom(tmpl)
	assert.deepEqual(brushLevels(b, e), { min: 1, max: 2 })
	assert.deepEqual(brushLevels({ ...b, levelMin: 5, levelMax: 7 }, e), { min: 5, max: 7 })
	assert.deepEqual(brushLevels({ ...b, levelMin: 6, levelMax: 0 }, e), { min: 6, max: 6 })
	assert.deepEqual(brushLevels({ ...b, levelMin: 9, levelMax: 4 }, e), { min: 9, max: 9 })
})
