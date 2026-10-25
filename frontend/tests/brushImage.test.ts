// Run with: bun test tests/brushImage.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brushImage, imageWeight, setBrushImage, setBrushImageRotation } from '../src/lib/tools/brushImage.ts'

// A 2x2 image: white top-left, black elsewhere.
const white = Uint8Array.from([255, 0, 0, 0])

test('no image leaves the weight alone', () => {
	setBrushImage(null)
	assert.equal(imageWeight(3, 4, 10), 1)
})

test('the image spans the brush square, with its top left at -x and -z', () => {
	setBrushImage(white, 2, 2)
	setBrushImageRotation(0)
	assert.ok(imageWeight(-7, -7, 10) > 0.99)
	assert.ok(imageWeight(7, -7, 10) < 0.01)
	assert.ok(imageWeight(7, 7, 10) < 0.01)
	// Outside the square there is no image.
	assert.equal(imageWeight(-11, 0, 10), 0)
})

test('a turn moves the image about the centre', () => {
	setBrushImage(white, 2, 2)
	setBrushImageRotation(90)
	// A quarter turn carries the top-left corner to the top-right (x east, z south).
	assert.ok(imageWeight(7, -7, 10) > 0.99)
	assert.ok(imageWeight(-7, -7, 10) < 0.01)
	setBrushImageRotation(0)
	assert.equal(brushImage.active, false)
})
