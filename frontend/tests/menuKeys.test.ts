// Run with: bun test tests/menuKeys.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { menuStep } from '../src/lib/ui/menuKeys.ts'

test('Down and Up step through the items and wrap at the ends', () => {
	assert.equal(menuStep('ArrowDown', 0, 3), 1)
	assert.equal(menuStep('ArrowDown', 2, 3), 0)
	assert.equal(menuStep('ArrowUp', 0, 3), 2)
	assert.equal(menuStep('ArrowUp', 2, 3), 1)
})

test('with no item focused, Down goes to the first and Up to the last', () => {
	assert.equal(menuStep('ArrowDown', -1, 4), 0)
	assert.equal(menuStep('ArrowUp', -1, 4), 3)
})

test('Home and End go to the first and last item', () => {
	assert.equal(menuStep('Home', 2, 5), 0)
	assert.equal(menuStep('End', 0, 5), 4)
})

test('other keys, and an empty menu, move nothing', () => {
	assert.equal(menuStep('a', 0, 3), null)
	assert.equal(menuStep('ArrowLeft', 0, 3), null)
	assert.equal(menuStep('ArrowDown', -1, 0), null)
})
