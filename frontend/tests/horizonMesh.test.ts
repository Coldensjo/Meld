// Run with: node --import ./tests/register.mjs --test tests/horizonMesh.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { horizonMesh } from '../src/lib/world/horizonMesh.ts'

test('a horizon tile lies beside the block at its WDL heights, its triangles facing up', () => {
  const heights = Array.from({ length: 17 * 17 + 16 * 16 }, (_, i) => i)
  const { positions, indices } = horizonMesh([{ dx: -1, dy: 2, heights }], 160)
  assert.equal(positions.length, (17 * 17 + 16 * 16) * 3)
  assert.equal(indices.length, 16 * 16 * 12)
  const at = (v: number) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]
  assert.deepEqual(at(0), [-160, 0, 320], 'its north-west corner, a tile west and two south of the block')
  assert.deepEqual(at(17 * 17), [-155, 289, 325], 'the first chunk centre')
  assert.deepEqual(at(17 * 17 - 1), [0, 288, 480])
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [at(indices[t]), at(indices[t + 1]), at(indices[t + 2])]
    const u = [b[0] - a[0], b[2] - a[2]]
    const v = [c[0] - a[0], c[2] - a[2]]
    // The y of (b - a) x (c - a), from x and z alone.
    assert.ok(u[1] * v[0] - u[0] * v[1] > 0, 'triangle ' + t / 3 + ' faces up')
  }
})
