// Run with: bun test tests/brushSize.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dragFalloff, dragRadius, stepFalloff, stepRadius } from '../src/lib/tools/brushSize.ts'

test('[ and ] step the radius finely when small and coarsely when big', () => {
	assert.equal(stepRadius(3, 1, 1, 200), 3.5)
	assert.equal(stepRadius(10, 1, 1, 200), 11)
	assert.equal(stepRadius(30, 1, 1, 200), 32.5)
	assert.equal(stepRadius(60, 1, 1, 200), 65)
	assert.equal(stepRadius(150, 1, 1, 200), 160)
	assert.equal(stepRadius(150, -1, 1, 200), 140)
})

test('a radius off the grid snaps to it first, and the band edges step down finely', () => {
	assert.equal(stepRadius(10.3, 1, 1, 200), 11)
	assert.equal(stepRadius(10.3, -1, 1, 200), 10)
	assert.equal(stepRadius(20, -1, 1, 200), 19, 'down from the edge of a band uses the finer band')
	assert.equal(stepRadius(20, 1, 1, 200), 22.5)
	assert.equal(stepRadius(1, -1, 1, 200), 1, 'never under the minimum')
	assert.equal(stepRadius(200, 1, 1, 200), 200, 'never over the maximum')
})

test('Shift+[ and ] step the falloff by a tenth', () => {
	assert.equal(stepFalloff(0.6, 1), 0.7)
	assert.equal(stepFalloff(0.6, -1), 0.5)
	assert.equal(stepFalloff(0.95, 1), 1)
	assert.equal(stepFalloff(0, -1), 0)
	assert.equal(stepFalloff(0.3000001, 1), 0.4, 'a rounding remainder does not steal a notch')
})

test('a drag doubles the radius every DRAG_DOUBLE pixels and halves it the other way', () => {
	assert.equal(dragRadius(10, 160, 1, 200), 20)
	assert.equal(dragRadius(10, -160, 1, 200), 5)
	assert.equal(dragRadius(10, 0, 1, 200), 10)
	assert.equal(dragRadius(150, 400, 1, 200), 200)
})

test('a drag up hardens and down softens, within 0..1', () => {
	assert.equal(dragFalloff(0.5, 40), 0.6)
	assert.equal(dragFalloff(0.5, -40), 0.4)
	assert.equal(dragFalloff(0.9, 100), 1)
	assert.equal(dragFalloff(0.1, -100), 0)
})
