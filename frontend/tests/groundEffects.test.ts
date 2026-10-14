// Run with: node --import ./tests/register.mjs --test tests/groundEffects.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellPredominant, cellTexture, cellTufts, effectFor, hash01, knownEffects, tuftsPerCell, type GroundEffectTables, type Tuft } from '../src/lib/world/groundEffects.ts'
import { NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../src/lib/terrain/chunkPaint.ts'

const tables: GroundEffectTables = {
  effects: { 7: { doodads: ['World\\NoDXT\\Detail\\ElwGra01.m2', 'World\\NoDXT\\Detail\\ElwFlo01.m2'], density: 8, terrain: 5 } },
  textures: { 'tileset\\elwynn\\elwynngrassbase.blp': 7, 'tileset\\elwynn\\elwynnflowerbase.blp': 7 },
}

test("a texture grows the client's effect unless the map says otherwise", () => {
  assert.equal(effectFor('Tileset\\Elwynn\\ElwynnGrassBase.blp', {}, tables), 7, 'case does not matter')
  assert.equal(effectFor('Tileset\\Elwynn\\ElwynnGrassBase.blp', { 'Tileset\\Elwynn\\ElwynnGrassBase.blp': 0 }, tables), 0, 'the map turned it off')
  assert.equal(effectFor('Tileset\\Elwynn\\ElwynnRockBase.blp', {}, tables), 0, 'unknown textures grow nothing')
  assert.equal(effectFor('#5d8a2f', {}, tables), 0, 'colours grow nothing')
  assert.equal(effectFor('Tileset\\Elwynn\\ElwynnRockBase.blp', {}, null), 0, 'no tables yet')
})

test('the cell grows the slot that weighs most over its texels', () => {
  const res = SPLAT_PER_CELL * 16
  const w = new Uint8Array(res * res * SLOTS)
  // Cell (1, 0): slot 2 strongest; cell (0, 0): slot 0.
  for (let z = 0; z < SPLAT_PER_CELL; z++) {
    for (let x = 0; x < SPLAT_PER_CELL; x++) {
      w[(z * res + x) * SLOTS] = 255
      const i = (z * res + SPLAT_PER_CELL + x) * SLOTS
      w[i] = 100
      w[i + 2] = 155
    }
  }
  assert.equal(cellPredominant(w, res, 0, 0), 0)
  assert.equal(cellPredominant(w, res, 1, 0), 2)
  assert.equal(cellPredominant(w, res, 5, 5), -1, 'an unpainted cell')
  const slots = new Uint8Array(4 * SLOTS).fill(NO_TEXTURE)
  slots.set([3, 9, 12, NO_TEXTURE])
  assert.equal(cellTexture(w, slots, res, 2, 1, 0), 12)
  assert.equal(cellTexture(w, slots, res, 2, 5, 5), NO_TEXTURE)
})

test('tufts per cell follow the density, within the cap', () => {
  assert.equal(tuftsPerCell(8), 4)
  assert.equal(tuftsPerCell(1), 1)
  assert.equal(tuftsPerCell(0), 0)
  assert.equal(tuftsPerCell(24), 8)
})

test('a cell grows the same tufts every time, spread over it', () => {
  const a: Tuft[] = []
  const b: Tuft[] = []
  cellTufts(10, 20, 4, 2, a)
  cellTufts(10, 20, 4, 2, b)
  assert.deepEqual(a, b)
  for (const t of a) {
    assert.ok(t.u >= 0 && t.u < 1 && t.v >= 0 && t.v < 1)
    assert.ok(t.doodad === 0 || t.doodad === 1)
    assert.ok(t.scale >= 0.85 && t.scale <= 1.15)
  }
  // No two tufts share a sub-cell of the jittered grid.
  const cells = new Set(a.map((t) => `${Math.floor(t.u * 2)},${Math.floor(t.v * 2)}`))
  assert.equal(cells.size, 4)
  const c: Tuft[] = []
  cellTufts(11, 20, 4, 2, c)
  assert.notDeepEqual(a, c, 'the next cell differs')
  assert.ok(hash01(1, 2, 3) >= 0 && hash01(1, 2, 3) < 1)
})

test('the known effects are those the client uses, most used first', () => {
  assert.deepEqual(knownEffects(tables), [{ id: 7, uses: 2 }])
})
