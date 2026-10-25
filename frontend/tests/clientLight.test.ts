// Run with: bun test tests/clientLight.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BAND, bandColor, bandFloat, lightAt, lightWeight, newLightAt, sceneFog, type ClientLights } from '../src/lib/wow/clientLight.ts'

// Azeroth's ocean band (LightIntBand 213 in the 1.12 client).
const OCEAN = [
	{ t: 0, v: 0x213e2f },
	{ t: 360, v: 0x213e2f },
	{ t: 720, v: 0x5b4842 },
	{ t: 1440, v: 0x114b59 },
	{ t: 2520, v: 0x5a4846 },
	{ t: 2640, v: 0x213e2f },
]

test("a band reads its key at the key's time, between keys in between, and wraps at midnight", () => {
	const out = new Float32Array(3)
	bandColor(OCEAN, 1440, out, 0)
	assert.deepEqual(
		[...out].map((v) => Math.round(v * 255)),
		[0x11, 0x4b, 0x59],
	)
	bandColor(OCEAN, 1080, out, 0)
	assert.equal(Math.round(out[0] * 255), Math.round((0x5b + 0x11) / 2))
	assert.equal(
		bandFloat(
			[
				{ t: 0, v: 100 },
				{ t: 1440, v: 200 },
			],
			2160,
		),
		150,
	)
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

// Benilla's light/tables.rs tests of the client's walk (0x6d63e0): keys as a cycle in stored order.
test('a band walks its keys as the client does, in stored order', () => {
	const k = (...ts: number[]) => ts.map((t, i) => ({ t, v: i * 100 }))
	// LightParams 8's rows store [720, 1440, 0]: 09:00 sits between 06:00 and noon, 18:00 between noon and midnight.
	assert.equal(bandFloat(k(720, 1440, 0), 1080), 50)
	assert.equal(bandFloat(k(720, 1440, 0), 2160), 150)
	// [2640, 2520, 0, 1440]: the first pair wraps across most of the day and wins.
	const f = (1440 + 2880 - 2640) / 2760
	assert.ok(Math.abs(bandFloat(k(2640, 2520, 0, 1440), 1440) - f * 100) < 1e-9)
	// Keys at 06:00 and 18:00: 03:00 wraps from the last key.
	assert.ok(Math.abs(bandFloat(k(720, 2160), 360) - (100 - ((360 + 2880 - 2160) / 1440) * 100)) < 1e-9)
})

test("the scene's fog ends at the light's end or the far clip, and starts at its share, a storm's below zero", () => {
	const l = newLightAt()
	l.floats[0] = 500 * 36
	l.floats[1] = 0.25
	assert.deepEqual(sceneFog(l, 2000, [0, 0]), [125, 500])
	assert.deepEqual(sceneFog(l, 400, [0, 0]), [100, 400])
	l.floats[1] = -0.5
	assert.deepEqual(sceneFog(l, 2000, [0, 0]), [-250, 500])
})

test("a light's highlightSky blends like its colours", () => {
	const colors = Array.from({ length: 18 }, () => [{ t: 0, v: 0 }])
	const floats = Array.from({ length: 6 }, () => [{ t: 0, v: 0 }])
	const set: ClientLights = {
		lights: [
			{ x: 0, y: 0, z: 0, inner: 0, outer: 0, global: true, params: [1, 0, 0, 0, 0] },
			{ x: 100, y: 0, z: 0, inner: 10, outer: 30, global: false, params: [2, 0, 0, 0, 0] },
		],
		params: {
			1: { waterAlpha: [0.5, 1], oceanAlpha: [0.75, 1], colors, floats },
			2: { highlightSky: true, waterAlpha: [0.5, 1], oceanAlpha: [0.75, 1], colors, floats },
		},
	}
	const out = newLightAt()
	lightAt(set, 0, 0, 0, 12, out)
	assert.equal(out.highlightSky, 0)
	lightAt(set, 80, 0, 0, 12, out)
	assert.equal(out.highlightSky, 0.5)
})

test("the storm blends a light's storm params over its clear ones, and a light without any keeps its clear ones", () => {
	const colors = (v: number) => Array.from({ length: 18 }, () => [{ t: 0, v }])
	const set: ClientLights = {
		lights: [
			{ x: 0, y: 0, z: 0, inner: 0, outer: 0, global: true, params: [1, 0, 3, 0, 0] },
			{ x: 100, y: 0, z: 0, inner: 10, outer: 30, global: false, params: [2, 0, 0, 0, 0] },
		],
		params: {
			1: { waterAlpha: [0.5, 1], oceanAlpha: [0.75, 1], colors: colors(0x000000), floats: [[{ t: 0, v: 0.25 }]] },
			2: { waterAlpha: [0.5, 1], oceanAlpha: [0.75, 1], colors: colors(0x0000ff), floats: [] },
			3: { waterAlpha: [0.5, 1], oceanAlpha: [0.75, 1], colors: colors(0xff0000), floats: [[{ t: 0, v: -0.5 }]] },
		},
	}
	const out = newLightAt()
	lightAt(set, 500, 0, 500, 12, out, 0)
	assert.equal(out.colors[BAND.fog * 3], 0)
	lightAt(set, 500, 0, 500, 12, out, 1)
	assert.equal(out.colors[BAND.fog * 3], 1)
	assert.equal(out.floats[0], -0.5)
	lightAt(set, 500, 0, 500, 12, out, 0.5)
	assert.ok(Math.abs(out.colors[BAND.fog * 3] - 0.5) < 1e-6)
	// Inside the local light, which has no storm params: its clear blue stays in the storm.
	lightAt(set, 100, 0, 0, 12, out, 1)
	assert.equal(out.colors[BAND.fog * 3 + 2], 1)
	assert.equal(out.colors[BAND.fog * 3], 0)
})
