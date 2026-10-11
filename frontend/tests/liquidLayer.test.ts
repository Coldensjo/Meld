// Run with: node --import ./tests/register.mjs --test tests/liquidLayer.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { liquidMesh } from '../src/lib/world/LiquidLayer.ts'

const chunk = (cells: number[], kind = 0x04) => ({
  indexX: 0,
  indexY: 0,
  kind,
  heights: new Array(81).fill(5),
  cells: Array.from({ length: 64 }, (_, i) => cells.includes(i)),
})

test('a block with no water gives no mesh', () => {
  assert.equal(liquidMesh([chunk([])], 4), null)
  assert.equal(liquidMesh([], 4), null)
})

test('each covered cell is two triangles at the surface height', () => {
  const mesh = liquidMesh([chunk([0, 9])], 4)!
  const pos = mesh.geometry.getAttribute('position')
  assert.equal(pos.count, 2 * 6)
  // Cell 0 is the chunk's first cell: its corners are at (0,0) and (4,4) in cell size 4.
  for (let i = 0; i < pos.count; i++) assert.equal(pos.getY(i), 5)
})

test('the mesh is one layer for the whole block', () => {
  const mesh = liquidMesh([chunk([0]), { ...chunk([0]), indexX: 1 }], 4)!
  assert.equal(mesh.geometry.getAttribute('position').count, 2 * 6)
})
