// Run with: node --import ./tests/register.mjs --test tests/bakedShadowsBake.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHADOW_PER_CELL, bakeShadows, chunkShadowBits, packShadowBits, unpackShadowBits } from '../src/lib/terrain/bakedShadows.ts'

test('a wall shadows the ground on its far side from the sun', () => {
  const size = 16
  const verts = size + 1
  const heights = new Float32Array(verts * verts)
  // A wall 10 high along x = 8 cells.
  for (let z = 0; z < verts; z++) heights[z * verts + 8] = 10
  const side = size * SHADOW_PER_CELL
  const out = new Uint8Array(side * side)
  // The sun low in the +x: the ground west of the wall (smaller x) is in its shadow.
  const sun = [Math.cos(1), Math.sin(1), 0] // a 10-high wall casts 6.4 yards, 3.2 cells
  const n = bakeShadows(heights, size, 2, sun, { x0: 0, z0: 0, x1: side - 1, z1: side - 1 }, out)
  assert.ok(n > 0)
  const at = (cellX: number) => out[8 * side + Math.floor(cellX * SHADOW_PER_CELL)]
  assert.equal(at(6), 255, 'just west of the wall')
  assert.equal(at(12), 0, 'east of the wall, toward the sun')
  assert.equal(at(1), 0, 'far west, out of reach')
  // A sun at the horizon or below casts nothing.
  bakeShadows(heights, size, 2, [0, -1, 0], { x0: 0, z0: 0, x1: side - 1, z1: side - 1 }, out)
  assert.ok(out.every((v) => v === 0))
})

test('the bits round-trip and a chunk is cut out in the client form', () => {
  const side = 128
  const bytes = new Uint8Array(side * side)
  bytes[0] = 255
  bytes[64 + 3] = 255 // chunk (1, 0), row 0, column 3
  bytes[(64 + 63) * side + 64 + 63] = 255 // chunk (1, 1), the last texel
  assert.deepEqual(unpackShadowBits(packShadowBits(bytes), side), bytes)
  const c10 = chunkShadowBits(bytes, side, 1, 0)
  assert.equal(c10[0], 1 << 3)
  const c11 = chunkShadowBits(bytes, side, 1, 1)
  assert.equal(c11[511], 0x80)
  assert.equal(chunkShadowBits(bytes, side, 0, 0)[0], 1)
})
