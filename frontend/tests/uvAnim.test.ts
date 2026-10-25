// Run with: bun test tests/uvAnim.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { colorAt, colorFades, colorIsStatic, sampleTrack, uvMatrix, type ColorAnimSpec, type UVAnimSpec } from '../src/lib/world/uvAnim.ts'

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

test("a colour's opacity is its alpha times its weight, its tint the RGB; constants are set once", () => {
	const glow: ColorAnimSpec = { rgb: { t: [0], v: [1, 0.5, 0.25], loop: 0 }, a: { t: [0], v: [0.5], loop: 0 } }
	assert.deepEqual(colorAt(glow, 1234, [0, 0, 0, 0]), [1, 0.5, 0.25, 0.5])
	assert.ok(colorIsStatic(glow))
	assert.ok(colorFades(glow))
	// A shimmer: the weight runs 0 to 1 and back over a second.
	const shimmer: ColorAnimSpec = { a: { t: [0], v: [0.5], loop: 0 }, w: { t: [0, 500, 1000], v: [0, 1, 0], loop: 1000 } }
	assert.equal(colorAt(shimmer, 250, [0, 0, 0, 0])[3], 0.25)
	assert.equal(colorAt(shimmer, 1500, [0, 0, 0, 0])[3], 0.5)
	assert.ok(!colorIsStatic(shimmer))
	// A tint alone never fades.
	assert.ok(!colorFades({ rgb: { t: [0], v: [0.2, 0.2, 0.2], loop: 0 } }))
	// The troll gate's hidden twin: alpha -1, drawn at no opacity.
	assert.ok(colorAt({ a: { t: [0], v: [-1], loop: 0 } }, 0, [0, 0, 0, 0])[3] <= 0)
})

test('a stepped track holds its last key from that key to the loop end', () => {
	const tr = { t: [0, 500], v: [1, 2], loop: 1000, step: true }
	const out = [0]
	sampleTrack(tr, 250, 1, out)
	assert.equal(out[0], 1)
	sampleTrack(tr, 500, 1, out)
	assert.equal(out[0], 2, 'at the key')
	sampleTrack(tr, 700, 1, out)
	assert.equal(out[0], 2, 'after the last key')
	sampleTrack(tr, 1200, 1, out)
	assert.equal(out[0], 1, 'the next loop starts over')
	sampleTrack({ ...tr, step: false }, 700, 1, out)
	assert.equal(out[0], 2, 'a lerped one too')
})

test('a track of many keys finds the keys either side of the time, and wraps with the loop (#328)', () => {
	const t = [0, 100, 200, 300, 400, 500, 600, 700]
	const tr = { t, v: t.map((x) => x * 2), loop: 800 }
	const out = [0]
	for (const ms of [0, 50, 100, 150, 399, 650, 700, 750, 850, 1650]) {
		sampleTrack(tr, ms, 1, out)
		const at = ms % 800
		assert.ok(Math.abs(out[0] - Math.min(at, 700) * 2) < 1e-9, `at ${ms}: ${out[0]}`)
	}
})
