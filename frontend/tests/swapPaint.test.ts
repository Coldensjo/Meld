// Run with: bun test tests/swapPaint.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NO_TEXTURE, SLOTS, dominantTexel, swapTexel } from '../src/lib/terrain/chunkPaint.ts'

/** A map that is one paint chunk (8 cells x 4 texels a side) whose slots hold the given textures. */
function oneChunk(textures: number[]) {
	const res = 32
	const slots = new Uint8Array(SLOTS).fill(NO_TEXTURE)
	slots.set(textures)
	return { side: 1, res, slots, weights: new Uint8Array(res * res * SLOTS) }
}

const texel = (m: ReturnType<typeof oneChunk>, pixel = 0) => [...m.weights.slice(pixel * SLOTS, pixel * SLOTS + SLOTS)]

test('a swap moves part of the weight and keeps the texel at 255', () => {
	const m = oneChunk([0, 2])
	m.weights[0] = 255
	assert.equal(swapTexel(m.side, m.res, m.slots, m.weights, 0, 0, 2, 0.5), true)
	assert.deepEqual(texel(m), [127, 128, 0, 0])
})

test('a full swap leaves the texel entirely on the new texture', () => {
	const m = oneChunk([0, 2])
	m.weights[0] = 255
	swapTexel(m.side, m.res, m.slots, m.weights, 0, 0, 2, 1)
	assert.deepEqual(texel(m), [0, 255, 0, 0])
	assert.equal(dominantTexel(m.side, m.res, m.slots, m.weights, 0), 2)
})

test('a swap takes a free slot for the new texture', () => {
	const m = oneChunk([0])
	m.weights[0] = 255
	swapTexel(m.side, m.res, m.slots, m.weights, 0, 0, 7, 1)
	assert.equal(m.slots[1], 7)
	assert.deepEqual(texel(m), [0, 255, 0, 0])
})

test('a swap in a full chunk gives up the weakest other texture', () => {
	const m = oneChunk([0, 1, 2, 3])
	m.weights[0] = 255
	// Textures 1 to 3 each paint one other texel, so all four are in use and texture 1 is the first weakest.
	for (const pixel of [1, 2, 3]) m.weights[pixel * SLOTS + pixel] = 255
	assert.equal(swapTexel(m.side, m.res, m.slots, m.weights, 0, 0, 9, 1), true)
	assert.equal(dominantTexel(m.side, m.res, m.slots, m.weights, 0), 9)
	// Texture 1's texel moved to the chunk's biggest remaining texture, 0, instead of vanishing.
	assert.equal(dominantTexel(m.side, m.res, m.slots, m.weights, 1), 0)
	assert.equal(dominantTexel(m.side, m.res, m.slots, m.weights, 2), 2)
})

test('a swap replaces the texture in a full chunk when the others are no longer used', () => {
	// Textures 1 to 3 have no weight anywhere in the chunk, so their slots are free to reuse.
	const m = oneChunk([0, 1, 2, 3])
	m.weights[0] = 255
	assert.equal(swapTexel(m.side, m.res, m.slots, m.weights, 0, 0, 9, 1), true)
	assert.deepEqual(texel(m), [0, 255, 0, 0])
	assert.equal(dominantTexel(m.side, m.res, m.slots, m.weights, 0), 9)
})

test('a swap in a full chunk keeps the other texels on their textures', () => {
	// Texel 0 is repainted from texture 0 to 9; texel 1 still uses texture 0, so slot 0 must stay.
	const m = oneChunk([0, 1, 2, 3])
	m.weights[0] = 255
	m.weights[SLOTS + 0] = 255
	assert.equal(swapTexel(m.side, m.res, m.slots, m.weights, 0, 0, 9, 1), true)
	assert.equal(dominantTexel(m.side, m.res, m.slots, m.weights, 0), 9)
	assert.equal(dominantTexel(m.side, m.res, m.slots, m.weights, 1), 0)
})

test('a swap does nothing where the source texture is absent', () => {
	const m = oneChunk([0, 2])
	m.weights[0] = 255
	assert.equal(swapTexel(m.side, m.res, m.slots, m.weights, 0, 5, 2, 1), true)
	assert.deepEqual(texel(m), [255, 0, 0, 0])
})

test('the dominant texture is the one with the most weight at a texel', () => {
	const m = oneChunk([4, 6])
	m.weights.set([60, 195, 0, 0], 0)
	assert.equal(dominantTexel(m.side, m.res, m.slots, m.weights, 0), 6)
})

test('a texel with no paint has no dominant texture', () => {
	const m = oneChunk([4])
	assert.equal(dominantTexel(m.side, m.res, m.slots, m.weights, 0), -1)
})

test("texels in a later chunk use that chunk's slots", () => {
	// Two chunks side by side, 32 texels each: chunk 1 starts at x = 32.
	const res = 64
	const slots = new Uint8Array(2 * SLOTS).fill(NO_TEXTURE)
	slots[SLOTS] = 9 // chunk 1, slot 0
	const weights = new Uint8Array(res * res * SLOTS)
	const pixel = 32 // x = 32, z = 0: the first texel of chunk 1
	weights[pixel * SLOTS] = 255
	assert.equal(dominantTexel(2, res, slots, weights, pixel), 9)
	assert.equal(dominantTexel(2, res, slots, weights, 0), -1)
})
