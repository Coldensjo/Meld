// Run with: bun test tests/brush.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FALLOFF_CURVES, brushWeight, type FalloffCurve } from '../src/lib/tools/falloff.ts'

const curves = FALLOFF_CURVES.map((c) => c.id) as FalloffCurve[]

test('every curve is full inside the solid part and zero at the edge', () => {
	for (const c of curves) {
		// falloff 0.5: solid up to t = 0.5, edge at t = 1.
		assert.equal(brushWeight(0.2, 0.5, c), 1, c)
		assert.equal(brushWeight(1, 0.5, c), 0, c)
		assert.equal(brushWeight(1.5, 0.5, c), 0, c)
	}
})

test('every curve falls off without rising', () => {
	for (const c of curves) {
		let prev = Infinity
		for (let t = 0.5; t <= 1; t += 0.01) {
			const w = brushWeight(t, 0.5, c)
			assert.ok(w <= prev + 1e-12, `${c} rises at t=${t}`)
			assert.ok(w >= 0 && w <= 1, `${c} out of range at t=${t}`)
			prev = w
		}
	}
})

test('a zero falloff is a hard edge for every curve', () => {
	for (const c of curves) {
		assert.equal(brushWeight(0.99, 0, c), 1, c)
		assert.equal(brushWeight(1, 0, c), 0, c)
	}
})

test('the curves differ across the band', () => {
	const mid = curves.map((c) => brushWeight(0.6, 0.5, c)) // off the midpoint, where several curves meet
	assert.equal(new Set(mid.map((w) => w.toFixed(3))).size, curves.length)
})
