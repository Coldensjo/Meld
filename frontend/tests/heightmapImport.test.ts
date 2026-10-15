// Run with: node --import ./tests/register.mjs --test tests/heightmapImport.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IMAGE_MAX, IMAGE_MIN, imageRatios, importHeights } from '../src/lib/io/heightmapImport.ts'

test('an image of the map\'s size reads back exactly with Set between the image range', () => {
  const heights = [IMAGE_MIN, 0, 100, IMAGE_MAX]
  const r = imageRatios({ side: 2, heights }, 2)
  assert.deepEqual([...r], [0, 0.5, (100 - IMAGE_MIN) / 2048, 1])
  const out = importHeights(new Float32Array(4), r, 'set', IMAGE_MIN, IMAGE_MAX)
  assert.deepEqual([...out], heights)
})

test('the modes put the min-to-max heights onto the ground', () => {
  const r = Float32Array.from([0, 0.5, 1])
  const ground = Float32Array.from([10, 10, 10])
  assert.deepEqual([...importHeights(ground, r, 'set', 0, 20)], [0, 10, 20])
  assert.deepEqual([...importHeights(ground, r, 'add', 0, 20)], [10, 20, 30])
  assert.deepEqual([...importHeights(ground, r, 'subtract', 0, 20)], [10, 0, -10])
  assert.deepEqual([...importHeights(ground, r, 'multiply', 1, 3)], [10, 20, 30])
})

test('an image of another size is stretched over the map', () => {
  // A 2x2 image black on the left, white on the right, read onto 3x3: the middle column is grey.
  const r = imageRatios({ side: 2, heights: [IMAGE_MIN, IMAGE_MAX, IMAGE_MIN, IMAGE_MAX] }, 3)
  assert.deepEqual([...r], [0, 0.5, 1, 0, 0.5, 1, 0, 0.5, 1])
})
