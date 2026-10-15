// Run with: node --import ./tests/register.mjs --test tests/clientLight.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BAND, bandColor, bandFloat, lightAt, lightWeight, newLightAt, type ClientLights } from '../src/lib/wow/clientLight.ts'

// Azeroth's ocean band (LightIntBand 213 in the 1.12 client).
const OCEAN = [{ t: 0, v: 0x213e2f }, { t: 360, v: 0x213e2f }, { t: 720, v: 0x5b4842 }, { t: 1440, v: 0x114b59 }, { t: 2520, v: 0x5a4846 }, { t: 2640, v: 0x213e2f }]

test('a band reads its key at the key\'s time, between keys in between, and wraps at midnight', () => {
  const out = new Float32Array(3)
  bandColor(OCEAN, 1440, out, 0)
  assert.deepEqual([...out].map((v) => Math.round(v * 255)), [0x11, 0x4b, 0x59])
  bandColor(OCEAN, 1080, out, 0)
  assert.equal(Math.round(out[0] * 255), Math.round((0x5b + 0x11) / 2))
  assert.equal(bandFloat([{ t: 0, v: 100 }, { t: 1440, v: 200 }], 2160), 150)
  assert.equal(bandFloat([{ t: 600, v: 10 }], 100), 10)
})

test('a local light blends over the global one by its distance', () => {
  const colors = (v: number) => Array.from({ length: 18 }, () => [{ t: 0, v }])
  const set: ClientLights = {
    lights: [
      { x: 0, y: 0, z: 0, inner: 0, outer: 0, global: true, params: [1, 0, 0, 0, 0] },
      { x: 100, y: 0, z: 100, inner: 10, outer: 30, global: false, params: [2, 0, 0, 0, 0] },
    ],
    params: {
      1: { waterAlpha: [0.5, 1], oceanAlpha: [0.75, 1], colors: colors(0x000000), floats: [] },
      2: { waterAlpha: [0.2, 0.4], oceanAlpha: [0.75, 1], colors: colors(0xff0000), floats: [] },
    },
  }
  const out = newLightAt()
  assert.ok(lightAt(set, 500, 0, 500, 12, out))
  assert.equal(out.colors[BAND.fog * 3], 0)
  lightAt(set, 100, 0, 105, 12, out)
  assert.equal(out.colors[BAND.fog * 3], 1)
  assert.equal(out.waterAlpha[0], 0.2)
  lightAt(set, 100, 0, 120, 12, out)
  assert.ok(Math.abs(out.colors[BAND.fog * 3] - 0.5) < 1e-6)
  assert.equal(lightWeight(set.lights[1], 31), 0)
})
