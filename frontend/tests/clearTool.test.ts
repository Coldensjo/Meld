// Run with: bun test tests/clearTool.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resetTexel } from '../src/lib/terrain/chunkPaint.ts'

const sum = (w: Uint8Array, o: number) => w[o] + w[o + 1] + w[o + 2] + w[o + 3]

test('a full reset makes the base texture the whole texel', () => {
	const w = Uint8Array.from([10, 100, 100, 45])
	resetTexel(w, 0, 1)
	assert.deepEqual([...w], [255, 0, 0, 0])
})

test('a partial reset moves the weights toward the base and keeps them at 255', () => {
	const w = Uint8Array.from([0, 85, 85, 85])
	resetTexel(w, 0, 0.5)
	assert.equal(sum(w, 0), 255)
	assert.ok(w[0] > 0 && w[1] < 85)
})

test('no reset leaves the texel alone', () => {
	const w = Uint8Array.from([30, 70, 90, 65])
	resetTexel(w, 0, 0)
	assert.deepEqual([...w], [30, 70, 90, 65])
})

test('rounding never breaks the 255 sum, across many weights', () => {
	for (let i = 0; i < 200; i++) {
		const a = Math.floor(Math.random() * 256)
		const b = Math.floor(Math.random() * (256 - a))
		const c = Math.floor(Math.random() * (256 - a - b))
		const d = 255 - a - b - c
		const w = Uint8Array.from([a, b, c, d])
		resetTexel(w, 0, Math.random())
		assert.equal(sum(w, 0), 255)
	}
})
