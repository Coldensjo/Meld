// Run with: bun test tests/normalMap.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalMapPixels, toBase64 } from '../src/lib/io/normalMap.ts'

test('flat ground points straight up; a slope rising east tilts the normal west', () => {
	const flat = normalMapPixels(new Float32Array(9), 3, 2)
	assert.deepEqual([...flat.subarray(0, 3)], [128, 255, 128])
	// Heights rise 2 yd a 2 yd cell eastward: a 45 degree slope, the normal (-1, 1, 0) / sqrt 2.
	const ramp = normalMapPixels(Float32Array.from([0, 2, 4, 0, 2, 4, 0, 2, 4]), 3, 2)
	const c = 4 * 3
	assert.deepEqual([...ramp.subarray(c, c + 3)], [Math.round(-Math.SQRT1_2 * 127.5 + 127.5), Math.round(Math.SQRT1_2 * 127.5 + 127.5), 128])
	assert.deepEqual([...ramp.subarray(0, 3)], [...ramp.subarray(c, c + 3)], 'the edge takes the one-sided difference')
})

test('bytes go over the bridge as base64', () => {
	assert.equal(toBase64(Uint8Array.from([0, 1, 2, 253, 254, 255])), Buffer.from([0, 1, 2, 253, 254, 255]).toString('base64'))
})
