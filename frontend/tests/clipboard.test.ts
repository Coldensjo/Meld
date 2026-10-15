// Run with: node --import ./tests/register.mjs --test tests/clipboard.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MapClip } from '../src/lib/world/clipboard.ts'
import { rotateClip } from '../src/lib/world/clipRotate.ts'
import { LiquidMap, copyLiquidCells, pasteLiquidCells, rotateLiquidClip, newLayer, LIQUID_CELLS } from '../src/lib/water/liquids.ts'
import { NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../src/lib/terrain/chunkPaint.ts'

/** A 3 by 2 clip whose heights count up by vertex, with one hole, one painted texel and one model. */
function clip(): MapClip {
  const w = 3
  const h = 2
  const heights = Float32Array.from({ length: (w + 1) * (h + 1) }, (_, i) => i)
  const holes = new Uint8Array(w * h)
  holes[1 * w + 2] = 1 // cell (2, 1)
  const T = SPLAT_PER_CELL
  const weights = new Uint8Array(w * T * h * T * SLOTS)
  const slots = new Uint8Array(weights.length).fill(NO_TEXTURE)
  const texel = (0 * w * T + 1) * SLOTS // texel (1, 0)
  slots[texel] = 0
  weights[texel] = 255
  return { w, h, heights, holes, weights, slots, palette: ['Tileset\\A.blp'], objects: [{ type: 'm2:a', cid: 1, x: 1, z: 0.5, yOff: 0, rotY: 0, scale: 1 }] }
}

test('a quarter turn moves every part of the clip the same way and swaps its sides', () => {
  const c = clip()
  const r = rotateClip(c, 2)
  assert.equal(r.w, 2)
  assert.equal(r.h, 3)
  // Vertex (x, z) lands at (z, w - x): the corner (3, 0) at (0, 0), (0, 0) at (0, 3).
  assert.equal(r.heights[0 * (r.w + 1) + 0], c.heights[0 * (c.w + 1) + 3])
  assert.equal(r.heights[3 * (r.w + 1) + 0], c.heights[0])
  // Cell (2, 1) lands at (1, 0).
  assert.equal(r.holes[0 * r.w + 1], 1)
  assert.equal(r.holes.reduce((a, b) => a + b, 0), 1)
  // Texel (1, 0) of a 12 by 8 texel grid lands at (0, 10).
  const T = SPLAT_PER_CELL
  assert.equal(r.weights[(10 * r.w * T + 0) * SLOTS], 255)
  assert.equal(r.slots[(10 * r.w * T + 0) * SLOTS], 0)
  // The model at (1, 0.5) of a 6-unit-wide clip lands at (0.5, 5) and turns a quarter turn.
  assert.deepEqual([r.objects[0].x, r.objects[0].z, r.objects[0].rotY], [0.5, 5, Math.PI / 2])
  // Four turns bring it back.
  const back = rotateClip(rotateClip(rotateClip(r, 2), 2), 2)
  assert.deepEqual([...back.heights], [...c.heights])
  assert.deepEqual([...back.holes], [...c.holes])
  assert.ok(Math.abs(back.objects[0].x - 1) < 1e-9 && Math.abs(back.objects[0].z - 0.5) < 1e-9)
})

test('liquid cells copy, paste anywhere, and turn with the clip', () => {
  const map = new LiquidMap(16)
  const l = newLayer(2, 5)
  l.cells[0 * LIQUID_CELLS + 1] = 1 // cell (1, 0)
  l.heights[1] = 6 // the (1,0) corner of that cell
  map.set(0, [l])
  const c = copyLiquidCells(map, { x0: 0, z0: 0, x1: 3, z1: 2 })
  assert.equal(c.cells.length, 1)
  assert.deepEqual([c.cells[0].x, c.cells[0].z, c.cells[0].id], [1, 0, 2])
  assert.deepEqual(c.cells[0].heights, [6, 5, 5, 5])
  // Pasted at (9, 9): the cell lands at (10, 9) of chunk (1, 1), and what that chunk held under the rect goes.
  const other = newLayer(1, 1)
  other.cells.fill(1)
  map.set(1 * 2 + 1, [other])
  const reserved: number[] = []
  pasteLiquidCells(map, c, 9, 9, (ch) => reserved.push(ch))
  const layers = map.layers(3)
  assert.ok(reserved.includes(3))
  const water = layers.find((t) => t.id === 1)!
  assert.equal(water.cells[(9 % 8) * 8 + (9 % 8)], 0, 'the rect cleared the cell it covers')
  assert.equal(water.cells[0], 1, 'a cell outside the rect keeps its liquid')
  const ocean = layers.find((t) => t.id === 2)!
  assert.equal(ocean.cells[(9 % 8) * 8 + (10 % 8)], 1)
  assert.equal(ocean.heights[(9 % 8) * 9 + (10 % 8)], 6)
  // The turn: cell (1, 0) of a 3-wide clip lands at (0, 1), its (1,0) corner at (0,0).
  const r = rotateLiquidClip(c)
  assert.deepEqual([r.w, r.h, r.cells[0].x, r.cells[0].z], [2, 3, 0, 1])
  assert.deepEqual(r.cells[0].heights, [5, 5, 6, 5])
})
