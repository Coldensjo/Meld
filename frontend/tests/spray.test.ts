// Run with: bun test tests/spray.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_DABS, sprayAmount, sprayDabRadius, sprayDabs } from '../src/lib/tools/spray.ts'

/** A seeded generator, so the counts below are repeatable. */
function seeded(seed: number) {
	let s = seed >>> 0
	return () => {
		s = (s + 0x6d2b79f5) >>> 0
		let t = s
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const out = new Float32Array(MAX_DABS * 2)

test('a dab is at least one splat texel across, and grows with Size as noggit3 sizes it', () => {
	assert.equal(sprayDabRadius(1, 1), 1)
	assert.ok(Math.abs(sprayDabRadius(40, 1) - (40 * (100 / 3 / 64)) / 2) < 1e-9)
})

test('no pressure sprays nothing', () => {
	assert.equal(sprayDabs(0, 0, 10, 1, 0, 1 / 60, seeded(1), out), 0)
})

test('dabs land inside the brush circle', () => {
	const n = sprayDabs(50, 20, 10, 1, 10, 1 / 60, seeded(2), out)
	assert.ok(n > 0)
	for (let i = 0; i < n; i++) assert.ok(Math.hypot(out[i * 2] - 50, out[i * 2 + 1] - 20) <= 10 + 1e-4)
})

test('the dab count matches the grid chance and does not depend on the frame rate', () => {
	// Radius 10, dab 1: the quarter-dab grid has about 5027 points, so pressure 2 gives about 10 dabs at 60 Hz.
	const rand = seeded(3)
	let at60 = 0
	for (let i = 0; i < 600; i++) at60 += sprayDabs(0, 0, 10, 1, 2, 1 / 60, rand, out)
	let at30 = 0
	for (let i = 0; i < 300; i++) at30 += sprayDabs(0, 0, 10, 1, 2, 1 / 30, rand, out)
	const expected = Math.PI * 40 * 40 * 0.002 * 600
	assert.ok(Math.abs(at60 - expected) < expected * 0.02, `60 Hz: ${at60} vs ${expected}`)
	assert.ok(Math.abs(at30 - expected) < expected * 0.02, `30 Hz: ${at30} vs ${expected}`)
})

test('one frame never places more than MAX_DABS', () => {
	assert.equal(sprayDabs(0, 0, 500, 1, 10, 1, seeded(4), out), MAX_DABS)
})

test('dab amount follows the brush strength and stays within 0 to 1', () => {
	assert.equal(sprayAmount(0), 0)
	assert.equal(sprayAmount(1), 1)
	assert.ok(sprayAmount(0.5) > 0 && sprayAmount(0.5) < 0.5)
})
