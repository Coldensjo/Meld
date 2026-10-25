// Run with: bun test tests/noise.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fbm, noise, ridged } from '../src/lib/engine/noise.ts'

test('noise is seeded: the same seed repeats and another seed differs', () => {
	assert.equal(noise(3.7, -1.2, 5), noise(3.7, -1.2, 5))
	assert.notEqual(noise(3.7, -1.2, 5), noise(3.7, -1.2, 6))
})

test('noise, fbm and ridged stay in [0,1] and vary', () => {
	for (const f of [(x: number, y: number) => noise(x, y, 1), (x: number, y: number) => fbm(x, y, 5, 1), (x: number, y: number) => ridged(x, y, 5, 1)]) {
		let lo = 1,
			hi = 0
		for (let i = 0; i < 4000; i++) {
			const v = f(i * 0.137, i * 0.071 - 40)
			assert.ok(v >= 0 && v <= 1, `${v}`)
			lo = Math.min(lo, v)
			hi = Math.max(hi, v)
		}
		assert.ok(hi - lo > 0.4, `range ${lo}..${hi}`)
	}
})
