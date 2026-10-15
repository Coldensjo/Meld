// Run with: node --import ./tests/register.mjs --test tests/doodadBrush.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attemptRate, candidate, fits, fitsOn, formatBrush, newBrush, newEntry, parseBrush, pickEntry, uniqueName } from '../src/lib/tools/doodadBrush.ts'

const bush = () => {
  const b = newBrush('Bush')
  b.entries.push(newEntry('m2:World\\Generic\\Bush01.m2', 30), newEntry('m2:World\\Generic\\Stone.m2', 20), newEntry('m2:World\\Generic\\Tree.m2', 25), newEntry('m2:World\\Generic\\Log.m2', 25))
  return b
}

test('entries come out in proportion to their weights', () => {
  const b = bush()
  const counts = [0, 0, 0, 0]
  const n = 20000
  for (let i = 0; i < n; i++) counts[pickEntry(b, (i + 0.5) / n)]++
  const share = counts.map((c) => c / n)
  assert.ok(Math.abs(share[0] - 0.3) < 0.01 && Math.abs(share[1] - 0.2) < 0.01 && Math.abs(share[2] - 0.25) < 0.01 && Math.abs(share[3] - 0.25) < 0.01, `${share}`)
  assert.equal(pickEntry(newBrush(), 0.5), -1, 'an empty brush picks nothing')
  const zero = newBrush()
  zero.entries.push(newEntry('m2:a', 0), newEntry('m2:b', 5))
  assert.equal(pickEntry(zero, 0), 1, 'a zero weight never comes out')
})

test('the brush file round-trips, with literal strings for the client paths', () => {
  const b = bush()
  b.spacing = 1.5
  b.entries[1].sink = -0.4
  b.entries[1].tilt = 10
  b.entries[2].scaleMin = 0.7
  b.entries[2].scaleMax = 1.3
  const text = formatBrush(b)
  assert.match(text, /type = 'm2:World\\Generic\\Bush01\.m2'/, 'single-quoted, so the backslashes stay as written')
  const { brush, errors } = parseBrush(text)
  assert.deepEqual(errors, [])
  assert.deepEqual(brush, b)
})

test('a hand-written brush reads with defaults, and bad entries are reported and skipped', () => {
  const { brush, errors } = parseBrush(`
name = "Rocks"
[[model]]
type = 'm2:World\\Rock.m2'
weight = 3
scale = 1.2
[[model]]
type = 'tex:not-a-model'
[[model]]
type = 'm2:World\\Pebble.m2'
weight = -1
`)
  assert.ok(brush)
  assert.equal(brush.name, 'Rocks')
  assert.equal(brush.spacing, 1)
  assert.equal(brush.entries.length, 1)
  assert.deepEqual([brush.entries[0].scaleMin, brush.entries[0].scaleMax, brush.entries[0].sink, brush.entries[0].tilt], [1.2, 1.2, 0, 0])
  assert.equal(errors.length, 2)
  assert.match(errors[0], /model 2/)
  assert.match(errors[1], /model 3.*weight/)
})

test('text that is not a brush gives no brush', () => {
  assert.equal(parseBrush('this is = = not toml').brush, null)
  assert.equal(parseBrush('spacing = 2').brush, null, 'no name and no models')
  const { brush, errors } = parseBrush("[[model]]\ntype = 'm2:a'\n")
  assert.ok(brush, 'models without a name still import, under a stand-in name')
  assert.match(errors[0], /no name/)
})

test('uniqueName numbers a taken name', () => {
  assert.equal(uniqueName('Bush', []), 'Bush')
  assert.equal(uniqueName('Bush', ['Bush']), 'Bush 2')
  assert.equal(uniqueName('Bush', ['Bush', 'Bush 2']), 'Bush 3')
})

test('candidates thin out toward the edge with the falloff, and never leave the circle', () => {
  const out = new Float32Array(2)
  let inner = 0
  let outer = 0
  let seed = 1
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < 20000; i++) {
    if (!candidate(100, 50, 10, 0.5, 'linear', rand, out)) continue
    const d = Math.hypot(out[0] - 100, out[1] - 50)
    assert.ok(d <= 10 + 1e-5)
    if (d < 5) inner++
    else outer++
  }
  // The band outside half the radius holds three quarters of the uniform points; with the falloff
  // starting there and falling linearly it keeps a third of them, so about 1.33 of the inner count.
  assert.ok(outer < inner * 1.5 && outer > inner * 1.15, `${inner} inside, ${outer} in the falloff band`)
  let kept = 0
  for (let i = 0; i < 1000; i++) if (candidate(0, 0, 10, 0, 'smooth', rand, out)) kept++
  assert.equal(kept, 1000, 'a hard brush keeps every point')
})

test('a model fits where no neighbour is nearer than the spacing allows', () => {
  // One model of footprint 2 at the origin.
  const near = Float32Array.from([0, 0, 2])
  assert.equal(fits(1.5, 0, 2, 1, near, 1), false, 'the two would overlap')
  assert.equal(fits(2.5, 0, 2, 1, near, 1), true, 'side by side')
  assert.equal(fits(2.5, 0, 2, 2, near, 1), false, 'spacing 2 wants a gap')
  assert.equal(fits(1.5, 0, 2, 0.5, near, 1), true, 'spacing 0.5 lets them overlap')
  assert.equal(fits(0, 0, 2, 1, near, 0), true, 'nothing near')
})

test('the attempt rate grows with the brush area', () => {
  assert.equal(attemptRate(10, 1), 60)
  assert.equal(attemptRate(20, 1), 240)
  assert.equal(attemptRate(20, 0.5), 120)
  assert.equal(attemptRate(10, 0), 0)
})

test('a placement on a prop is spaced only against the models on that same prop', () => {
  // Two models of footprint 2: one on prop 7 at (10, 10), one on prop 8 at (10, 10).
  const on = new Float32Array([10, 10, 2, 7, 10, 10, 2, 8])
  assert.equal(fitsOn(11, 10, 2, 1, on, 2, 7), false, 'too close to the model on prop 7')
  assert.equal(fitsOn(11, 10, 2, 1, on, 2, 9), true, 'nothing stands on prop 9')
  assert.equal(fitsOn(12.5, 10, 2, 1, on, 2, 7), true, 'a footprint away fits')
  assert.equal(fitsOn(12.5, 10, 2, 2, on, 2, 7), false, 'spacing 2 wants twice that')
})
