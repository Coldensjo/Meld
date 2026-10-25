// Run with: bun test tests/alphamap.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layAlphamapChunk, textureWeights } from '../src/lib/terrain/alphamap.ts'
import { NO_TEXTURE, SLOTS } from '../src/lib/terrain/chunkPaint.ts'

/** One chunk of 2x2 texels, all grass (palette 0). */
function paint() {
	const weights = new Uint8Array(4 * SLOTS)
	for (let i = 0; i < 4; i++) weights[i * SLOTS] = 255
	return { paintChunksPerSide: 1, splatRes: 2, chunkSlots: new Uint8Array([0, NO_TEXTURE, NO_TEXTURE, NO_TEXTURE]), weights }
}

test('an alphamap laid in reads back out, the other texture taking the rest', () => {
	const t = paint()
	const values = Float32Array.from([0, 0.5, 1, 0.25])
	assert.equal(layAlphamapChunk(t, 0, 7, values), false)
	assert.deepEqual([...t.chunkSlots], [0, 7, NO_TEXTURE, NO_TEXTURE])
	const back = textureWeights(t, 7)
	for (let i = 0; i < 4; i++) assert.ok(Math.abs(back[i] - values[i]) < 1 / 255 + 1e-6, `texel ${i}`)
	// Every texel still sums to 255, and grass holds what the new texture left.
	for (let i = 0; i < 4; i++) assert.equal(t.weights[i * SLOTS] + t.weights[i * SLOTS + 1], 255)
	assert.equal(t.weights[2 * SLOTS], 0)
})

test('a chunk that has no room refuses, and one that needs none of it is left alone', () => {
	const t = paint()
	t.chunkSlots.set([0, 1, 2, 3])
	for (let i = 0; i < 4; i++) t.weights.set([100, 55, 50, 50], i * SLOTS)
	assert.equal(layAlphamapChunk(t, 0, 9, Float32Array.from([1, 1, 1, 1])), true)
	const free = paint()
	assert.equal(layAlphamapChunk(free, 0, 9, new Float32Array(4)), false)
	assert.deepEqual([...free.chunkSlots], [0, NO_TEXTURE, NO_TEXTURE, NO_TEXTURE])
})
