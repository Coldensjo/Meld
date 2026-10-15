// Run with: node --import ./tests/register.mjs --test tests/groundEffects.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cellPredominant, cellTexture, cellTufts, chunkNoEffect, coverCells, effectFor, hash01, knownEffects, tuftsPerCell, type GroundEffectTables, type Tuft } from '../src/lib/world/groundEffects.ts'
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

test('tufts per cell follow the density and the density level, within the cap', () => {
  assert.equal(tuftsPerCell(8), 4)
  assert.equal(tuftsPerCell(1), 1)
  assert.equal(tuftsPerCell(0), 0)
  assert.equal(tuftsPerCell(24), 12)
  assert.equal(tuftsPerCell(8, 1), 8, 'full is the game\'s amount')
  assert.equal(tuftsPerCell(8, 0.25), 2, 'sparse is a quarter')
  assert.equal(tuftsPerCell(24, 1), 16, 'capped')
})

test('a building bares the cells under its turned box, and the chunk bits pack per row', () => {
  const cells = 16
  const out = new Uint8Array(cells * cells)
  // A 4x2 box (in its own space) at (8, 8), turned a quarter turn so it lies along z, scaled 2: 8 by 4.
  coverCells([{ x: 8, z: 8, rotY: Math.PI / 2, scale: 2, minX: -2, minZ: -1, maxX: 2, maxZ: 1 }], 1, cells, out)
  const at = (cx: number, cz: number) => out[cz * cells + cx]
  assert.equal(at(8, 8), 1, 'the centre')
  assert.equal(at(8, 4), 1, 'along z, inside the turned box')
  assert.equal(at(8, 11), 1)
  assert.equal(at(8, 3), 0, 'past its end')
  assert.equal(at(9, 8), 1, 'within its width')
  assert.equal(at(10, 8), 0, 'beyond its width')
  assert.equal(at(5, 8), 0)
  // Already-set bytes stay, and the chunk's rows pack the bits as the tile holds them.
  out[0] = 1
  const rows = chunkNoEffect(out, cells, 0, 0)!
  assert.equal(rows[0], 1)
  assert.equal(rows[1], 0)
  assert.equal(chunkNoEffect(new Uint8Array(cells * cells), cells, 1, 1), null, 'a chunk with nothing set')
  assert.deepEqual(chunkNoEffect(out, cells, 1, 1), [3, 3, 3, 3, 0, 0, 0, 0], 'the box reaches two cells into chunk (1, 1) for four rows')
  const mid = chunkNoEffect(out, cells, 1, 0)!
  assert.equal(mid[4] & (1 << 0), 1, 'cell (8, 4) is row 4 bit 0 of chunk (1, 0)')
  assert.equal(mid[3], 0)
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
