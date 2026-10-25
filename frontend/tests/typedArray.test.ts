// Run with: bun test tests/typedArray.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { grow } from '../src/lib/tools/typedArray.ts'

test('grow keeps an array long enough and doubles a short one, keeping its items and type', () => {
	const a = new Float32Array([1, 2, 3, 4])
	assert.equal(grow(a, 4), a)
	const b = grow(a, 5)
	assert.ok(b instanceof Float32Array)
	assert.equal(b.length, 8)
	assert.deepEqual([...b.subarray(0, 4)], [1, 2, 3, 4])
	const c = grow(new Int32Array([7]), 10)
	assert.ok(c instanceof Int32Array)
	assert.equal(c.length, 10)
	assert.equal(c[0], 7)
})
