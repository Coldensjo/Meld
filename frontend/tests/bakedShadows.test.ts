// Run with: bun test tests/bakedShadows.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHUNK_SHADOW_BYTES, chunkShadowBits, packShadowBits, unpackShadowBits } from '../src/lib/terrain/bakedShadows.ts'

const setBits = (b: Uint8Array) => b.reduce((n, v) => n + v.toString(2).replaceAll('0', '').length, 0)

test('a shadow bit is the texel its byte and bit name, rows running on', () => {
	// 16 texels a side: two bytes a row. Byte 0 bit 3 is texel (3, 0); byte 3 bit 7 is texel (15, 1).
	const bits = new Uint8Array(32)
	bits[0] = 1 << 3
	bits[3] = 1 << 7
	const px = unpackShadowBits(bits, 16)
	assert.equal(px.length, 256)
	assert.equal(px[3], 255)
	assert.equal(px[16 + 15], 255)
	assert.equal(
		px.reduce((n, v) => n + (v ? 1 : 0), 0),
		2,
	)
})

test('packShadowBits sets a bit from 128 up and unpackShadowBits reads it back', () => {
	const side = 16
	const px = new Uint8Array(side * side)
	px[3] = 128
	px[16 + 15] = 255
	px[40] = 127 // under the threshold: lit
	px[200] = 200
	const bits = packShadowBits(px)
	assert.equal(bits.length, 32)
	assert.equal(bits[0], 1 << 3)
	assert.equal(bits[3], 1 << 7)
	assert.equal(bits[5], 0)
	assert.equal(bits[25], 1 << 0)
	assert.equal(setBits(bits), 3)
	const back = unpackShadowBits(bits, side)
	for (let i = 0; i < px.length; i++) assert.equal(back[i], px[i] >= 128 ? 255 : 0, `texel ${i}`)
})

test('packShadowBits rounds a partial last byte up', () => {
	const px = new Uint8Array(9)
	px[8] = 255
	const bits = packShadowBits(px)
	assert.equal(bits.length, 2)
	assert.equal(bits[1], 1)
})

test('chunkShadowBits takes its chunk 64 texels a side, row r at byte r*8 + c>>3, bit c&7', () => {
	// Three chunks a side (192 texels). Texels in chunk (cx 1, cz 2) at chunk-local (c, r).
	const side = 192
	const px = new Uint8Array(side * side)
	const spots = [
		[0, 0],
		[13, 5],
		[63, 63],
		[7, 40],
	]
	for (const [c, r] of spots) px[(2 * 64 + r) * side + 1 * 64 + c] = 255
	// Neighbours just outside the chunk, which must not leak in.
	px[(2 * 64 - 1) * side + 64] = 255 // the row above, in chunk (1, 1)
	px[2 * 64 * side + 63] = 255 // the column left, in chunk (0, 2)
	px[2 * 64 * side + 128] = 255 // the column right, in chunk (2, 2)
	const bits = chunkShadowBits(px, side, 1, 2)
	assert.equal(bits.length, CHUNK_SHADOW_BYTES)
	for (const [c, r] of spots) {
		assert.equal((bits[r * 8 + (c >> 3)] >> (c & 7)) & 1, 1, `texel (${c}, ${r})`)
	}
	assert.equal(setBits(bits), spots.length)
	// A chunk's bits are its 64x64 texels as packShadowBits lays out a 64-texel-wide map.
	const local = new Uint8Array(64 * 64)
	for (const [c, r] of spots) local[r * 64 + c] = 255
	assert.deepEqual(bits, packShadowBits(local))
	// The neighbours land in their own chunks.
	assert.equal(chunkShadowBits(px, side, 1, 1)[63 * 8], 1)
	assert.equal(chunkShadowBits(px, side, 0, 2)[7], 1 << 7)
	assert.equal(chunkShadowBits(px, side, 2, 2)[0], 1)
})
