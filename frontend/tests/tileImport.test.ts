// Run with: bun test tests/tileImport.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NO_TEXTURE, SLOTS } from '../src/lib/terrain/chunkPaint.ts'
import { tilePaint } from '../src/lib/io/tileImport.ts'

const half = (n: number) => new Uint8Array(64 * 64).fill(n)

test('a base-only chunk is the base texture everywhere', () => {
	const p = tilePaint([{ indexX: 0, indexY: 0, layers: [{ texture: 'a.blp' }] }], 2)
	assert.equal(p.palette[0], 'a.blp')
	assert.equal(p.chunkSlots[0], 0)
	assert.equal(p.weights[0], 255)
	assert.equal(p.dropped, 0)
})

test('an alpha of half splits a texel between two layers in WoW order', () => {
	const p = tilePaint([{ indexX: 1, indexY: 0, layers: [{ texture: 'base.blp' }, { texture: 'top.blp', alpha: half(128) }] }], 2)
	const slots = [...p.chunkSlots.slice(SLOTS, SLOTS + 2)]
	assert.deepEqual(slots, [p.palette.indexOf('base.blp'), p.palette.indexOf('top.blp')])
	// Texel (0,0) of chunk (1,0) is at x = 32 in the 64-texel-wide splat.
	const base = (0 * 64 + 32) * SLOTS
	assert.ok(Math.abs(p.weights[base] - 127) <= 1)
	assert.ok(Math.abs(p.weights[base + 1] - 128) <= 1)
	assert.equal(p.weights[base] + p.weights[base + 1], 255)
})

test('later layers sit on top of earlier ones', () => {
	// Layer 2 covers everything, so layer 1 shows nothing.
	const layers = [{ texture: 'a.blp' }, { texture: 'b.blp', alpha: half(0) }, { texture: 'c.blp', alpha: half(255) }]
	const p = tilePaint([{ indexX: 0, indexY: 0, layers }], 2)
	const c = p.palette.indexOf('c.blp')
	assert.equal(p.chunkSlots[2], c)
	assert.equal(p.weights[2], 255)
	assert.equal(p.weights[0] + p.weights[1] + p.weights[2] + p.weights[3], 255)
})

test('more than four layers keeps the first four and reports the rest', () => {
	const layers = [0, 1, 2, 3, 4].map((i) => ({ texture: `t${i}.blp`, alpha: i ? half(10) : undefined }))
	const p = tilePaint([{ indexX: 0, indexY: 0, layers }], 2)
	assert.equal(p.dropped, 1)
	assert.equal(p.palette.includes('t4.blp'), false, 'a dropped layer is not added to the palette')
	assert.equal(p.chunkSlots[SLOTS - 1] === NO_TEXTURE, false)
})

test('a chunk with no layers falls back to the first palette entry', () => {
	const p = tilePaint([{ indexX: 0, indexY: 0, layers: [] }], 2)
	assert.equal(p.chunkSlots[0], 0)
	assert.equal(p.weights[0], 255)
})

test('palette entries are shared by name across chunks', () => {
	const p = tilePaint(
		[
			{ indexX: 0, indexY: 0, layers: [{ texture: 'x.blp' }] },
			{ indexX: 1, indexY: 1, layers: [{ texture: 'x.blp' }, { texture: 'y.blp', alpha: half(1) }] },
		],
		2,
	)
	assert.equal(p.palette.filter((t) => t === 'x.blp').length, 1)
})

test('weights match Go ClientWeights for the same chunk, which compile compares them against (#526)', () => {
	// The alpha and the fold are internal/adt/clientalpha_test.go's parityAlpha and paritySum.
	const alpha = (l: number) => Uint8Array.from({ length: 64 * 64 }, (_, i) => (l === 1 ? (i * 37) % 256 : (i * 91 + 17) % 256))
	const p = tilePaint([{ indexX: 0, indexY: 0, layers: [{ texture: 'a' }, { texture: 'b', alpha: alpha(1) }, { texture: 'c', alpha: alpha(2) }] }], 1)
	let sum = 0
	p.weights.forEach((v, i) => (sum = (sum * 31 + v * ((i % 251) + 1)) % 1000000007))
	assert.equal(sum, 138039546)
})
