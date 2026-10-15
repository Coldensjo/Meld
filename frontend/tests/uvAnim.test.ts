// Run with: node --import ./tests/register.mjs --test tests/uvAnim.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uvMatrix, type UVAnimSpec } from '../src/lib/world/uvAnim.ts'

// Benilla's tex_anim.rs cases of the client's transform.
const apply = (spec: UVAnimSpec, ms: number, u: number, v: number) => {
  const m = uvMatrix(spec, ms, [0, 0, 0, 0, 0, 0])
  return [m[0] * u + m[1] * v + m[2], m[3] * u + m[4] * v + m[5]]
}
const near = (a: number[], b: number[]) => a.every((x, i) => Math.abs(x - b[i]) < 1e-6)
const r = Math.SQRT1_2
const turn = (z: number): UVAnimSpec => ({ r: { t: [0], v: [0, 0, z, r], loop: 0 } })

test('a positive z turns the texture counter-clockwise about its centre, a negative one the other way', () => {
  assert.ok(near(apply(turn(r), 0, 1, 0.5), [0.5, 1]))
  assert.ok(near(apply(turn(-r), 0, 1, 0.5), [0.5, 0]))
  assert.ok(near(apply({}, 0, 0.2, 0.7), [0.2, 0.7]), 'no transform, no change')
  // The translation is added before the turn.
  const both: UVAnimSpec = { ...turn(r), t: { t: [0], v: [0.5, 0, 0], loop: 0 } }
  assert.ok(near(apply(both, 0, 0.5, 0.5), [0.5, 1]))
})

test('a scroll ramps over its loop and wraps', () => {
  // The fountain shape: V from 0 to -1 over a 1333 ms global sequence.
  const spec: UVAnimSpec = { t: { t: [0, 1333], v: [0, 0, 0, 0, -1, 0], loop: 1333 } }
  assert.ok(Math.abs(apply(spec, 1333 / 2, 0, 0)[1] + 0.5) < 1e-6)
  assert.ok(Math.abs(apply(spec, 1333 + 100, 0, 0)[1] - apply(spec, 100, 0, 0)[1]) < 1e-9)
})
