// Run with: bun test tests/classes.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLASSES, classCell, classOfBit } from '../src/lib/wow/classes.ts'
import { CLASS_MASK } from '../src/lib/world/questFields.ts'

test('every class mask bit maps to its class, with the same name', () => {
	const names = new Map(CLASSES)
	for (const [bit, name] of CLASS_MASK) assert.equal(names.get(classOfBit(bit)), name, `bit ${bit}`)
	assert.equal(classOfBit(0), 0)
	assert.equal(classOfBit(3), 0)
	assert.equal(classOfBit(-1), 0)
})

test('every playable class has its own cell in the atlas, inside it', () => {
	const seen = new Set<string>()
	for (const [id] of CLASSES) {
		const c = classCell(id)
		assert.ok(c, `class ${id}`)
		const [l, r, t, b] = c
		assert.ok(l >= 0 && r <= 1 && t >= 0 && b <= 1 && r > l && b > t)
		seen.add(c.join())
	}
	assert.equal(seen.size, CLASSES.length)
	assert.equal(classCell(6), null)
	assert.equal(classCell(0), null)
	// The game's cells: Warrior top left, Paladin alone on the third row.
	assert.deepEqual(classCell(1), [0, 0.25, 0, 0.25])
	assert.deepEqual(classCell(2), [0, 0.25, 0.5, 0.75])
})
