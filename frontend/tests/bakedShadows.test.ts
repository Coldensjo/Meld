// Run with: node --import ./tests/register.mjs --test tests/bakedShadows.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unpackShadowBits } from '../src/lib/terrain/bakedShadows.ts'

test('a shadow bit is the texel its byte and bit name, rows running on', () => {
  // 16 texels a side: two bytes a row. Byte 0 bit 3 is texel (3, 0); byte 3 bit 7 is texel (15, 1).
  const bits = new Uint8Array(32)
  bits[0] = 1 << 3
  bits[3] = 1 << 7
  const px = unpackShadowBits(bits, 16)
  assert.equal(px.length, 256)
  assert.equal(px[3], 255)
  assert.equal(px[16 + 15], 255)
  assert.equal(px.reduce((n, v) => n + (v ? 1 : 0), 0), 2)
})
