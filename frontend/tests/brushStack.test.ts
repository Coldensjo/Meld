// Run with: bun test tests/brushStack.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyItem, freeStackName, newStackItem } from '../src/lib/tools/brushStack.ts'

function settings() {
	return {
		sculptMode: 'raise' as const,
		paintMode: 'swap',
		paintSpray: true,
		paintLayer: 0,
		sculptPaint: 'slope',
		sculptLimit: 'above',
		brush: { radius: 30, strength: 1, falloff: 0.2 },
		brushImage: { rotation: 10, random: true },
	}
}

test("an item takes the stack's size, strength and turn where it inherits, and its own elsewhere", () => {
	const stack = { radius: 40, strength: 2, rotation: 90 }
	const flatten = { ...newStackItem('sculpt'), mode: 'flatten' as const, radius: 12, strength: 0.3, falloff: 0.7, rotation: 45, inheritRadius: false }
	const s = applyItem(settings(), flatten, stack, 0)
	assert.equal(s.sculptMode, 'flatten')
	assert.equal(s.brush.radius, 12)
	assert.equal(s.brush.strength, 2)
	assert.equal(s.brush.falloff, 0.7)
	assert.equal(s.brushImage.rotation, 90)
	// A stack brush only shapes or paints: no painting while sculpting, no spray, no edit limit, no random turn.
	assert.equal(s.sculptPaint, 'off')
	assert.equal(s.paintSpray, false)
	assert.equal(s.paintMode, 'texture')
	assert.equal(s.sculptLimit, 'none')
	assert.equal(s.brushImage.random, false)
	const paint = applyItem(settings(), { ...newStackItem('paint', 'Tileset\Rock.blp'), inheritRotation: false, rotation: 30 }, stack, 5)
	assert.equal(paint.paintLayer, 5)
	assert.equal(paint.brush.radius, 40)
	assert.equal(paint.brushImage.rotation, 30)
})

test('new stacks get a free name', () => {
	assert.equal(freeStackName([]), 'Stack')
	assert.equal(
		freeStackName([
			{ name: 'Stack', items: [] },
			{ name: 'Stack 2', items: [] },
		]),
		'Stack 3',
	)
})
