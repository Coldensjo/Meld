// Run with: node --import ./tests/register.mjs --test tests/chunkPaint.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHUNK_CELLS,
  NO_TEXTURE,
  SLOTS,
  acquireSlot,
  addWeight,
  chunksPerSide,
  convertGlobalLayers,
  findSlot,
  normalizeTexel,
  packRoles,
  paletteCoverage,
  paletteIndex,
} from '../src/lib/terrain/chunkPaint.ts'

test('a chunk takes four textures and refuses a fifth', () => {
  const slots = new Uint8Array(SLOTS).fill(NO_TEXTURE)
  assert.equal(acquireSlot(slots, 0, 7), 0)
  assert.equal(acquireSlot(slots, 0, 9), 1)
  assert.equal(acquireSlot(slots, 0, 7), 0, 'a texture already in the chunk keeps its slot')
  assert.equal(acquireSlot(slots, 0, 3), 2)
  assert.equal(acquireSlot(slots, 0, 4), 3)
  assert.equal(acquireSlot(slots, 0, 5), -1, 'a fifth texture is refused')
  assert.equal(findSlot(slots, 0, 4), 3)
  assert.equal(findSlot(slots, 0, 5), -1)
})

test('chunks do not share slots', () => {
  const slots = new Uint8Array(2 * SLOTS).fill(NO_TEXTURE)
  acquireSlot(slots, 0, 1)
  assert.equal(findSlot(slots, 1, 1), -1)
})

test('adding weight keeps a texel summing to 255', () => {
  const w = new Uint8Array(SLOTS)
  w[0] = 255
  for (let i = 0; i < 200; i++) addWeight(w, 0, (i % 3) + 1, 0.1)
  assert.equal(w[0] + w[1] + w[2] + w[3], 255)
  assert.ok(w[1] > 0 && w[2] > 0 && w[3] > 0)
})

test('adding to an empty texel makes that slot the only one', () => {
  const w = new Uint8Array(SLOTS)
  addWeight(w, 0, 2, 0.5)
  assert.equal(w[2], 255)
  assert.equal(w[0] + w[1] + w[3], 0)
})

test('normalizeTexel fixes rounding without losing weight', () => {
  const w = Uint8Array.from([100, 100, 50, 0])
  normalizeTexel(w, 0)
  assert.equal(w[0] + w[1] + w[2] + w[3], 255)
})

test('packRoles keeps only four textures per chunk and sums each texel to 255', () => {
  const side = 2 // a 16-cell map: two chunks a side
  const res = side * CHUNK_CELLS * 2 // two texels a cell
  const roles = 6
  // Every texel holds all six roles equally, so each chunk must pick four of them.
  const { weights, chunkSlots } = packRoles(side, res, roles, (_x, _z, out) => out.fill(255 / 6))
  for (let c = 0; c < side * side; c++) {
    const used = [...chunkSlots.slice(c * SLOTS, c * SLOTS + SLOTS)].filter((v) => v !== NO_TEXTURE)
    assert.equal(used.length, 4)
    assert.equal(new Set(used).size, 4, 'a chunk never repeats a texture')
  }
  for (let t = 0; t < res * res; t++) {
    let sum = 0
    for (let k = 0; k < SLOTS; k++) sum += weights[t * SLOTS + k]
    assert.equal(sum, 255)
  }
})

test('a chunk nothing was painted in falls back to the first palette entry', () => {
  const side = 1
  const res = CHUNK_CELLS * 2
  const { weights, chunkSlots } = packRoles(side, res, 3, (_x, _z, out) => out.fill(0))
  assert.equal(chunkSlots[0], 0)
  assert.equal(weights[0], 255)
})

test('a format 1 map converts to chunks with the same look where a chunk has few layers', () => {
  const side = 2
  const oldRes = side * CHUNK_CELLS * 2
  const splatA = new Uint8Array(oldRes * oldRes * 4)
  const splatB = new Uint8Array(oldRes * oldRes * 4)
  for (let i = 0; i < splatA.length; i += 4) {
    splatA[i + 2] = 255 // layer 2 everywhere
    splatB[i + 1] = 255 // layer 5 everywhere
  }
  const res = side * CHUNK_CELLS * 4
  const { weights, chunkSlots } = convertGlobalLayers(side, res, oldRes, splatA, splatB)
  for (let c = 0; c < side * side; c++) {
    assert.deepEqual([...chunkSlots.slice(c * SLOTS, c * SLOTS + 2)].sort(), [2, 5])
  }
  // Each texel is an even mix of layers 2 and 5 (127 or 128 each, since 255 is odd).
  const slot2 = findSlot(chunkSlots, 0, 2)
  const slot5 = findSlot(chunkSlots, 0, 5)
  assert.ok(Math.abs(weights[slot2] - 127.5) <= 0.5)
  assert.ok(Math.abs(weights[slot5] - 127.5) <= 0.5)
  assert.equal(weights[slot2] + weights[slot5], 255)
})

test('the chunk count follows the map size', () => {
  assert.equal(chunksPerSide(128), 16)
  assert.equal(chunksPerSide(512), 64)
})

test('coverage counts each palette entry by its weight across the map', () => {
  const side = 1
  const res = CHUNK_CELLS * 2
  const weights = new Uint8Array(res * res * SLOTS)
  const slots = new Uint8Array(SLOTS).fill(NO_TEXTURE)
  slots[0] = 0
  slots[1] = 2
  for (let t = 0; t < res * res; t++) {
    weights[t * SLOTS] = 255 * 0.75
    weights[t * SLOTS + 1] = 255 * 0.25
  }
  const cov = paletteCoverage(weights, slots, res, side, 4)
  assert.ok(Math.abs(cov[0] - 0.75) < 0.01)
  assert.ok(Math.abs(cov[2] - 0.25) < 0.01)
  assert.equal(cov[1], 0)
})

test('paletteIndex ignores case', () => {
  assert.equal(paletteIndex(['#112233', 'Tileset\Elwynn\Dirt.blp'], 'tileset\elwynn\dirt.BLP'), 1)
  assert.equal(paletteIndex(['a'], 'b'), -1)
})
