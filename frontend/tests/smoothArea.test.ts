// Run with: bun test tests/smoothArea.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fadeFromEdge, shapePatch, smoothPass, smoothPatch } from '../src/lib/terrain/smoothArea.ts'

const settings = { strength: 1, passes: 1, falloff: false, width: 0 }

test('a pass matches the brush kernel: each vertex moves toward its 3x3 average, edges included', () => {
	const w = 4
	const h = 3
	const hs = Float32Array.from({ length: w * h }, (_, i) => (i * 7) % 5)
	const before = Float32Array.from(hs)
	const weights = new Float32Array(w * h).fill(1)
	smoothPass(hs, w, h, weights, 0.5, new Float32Array(w * h), new Float32Array(w * h))
	for (let z = 0; z < h; z++) {
		for (let x = 0; x < w; x++) {
			let sum = 0
			let n = 0
			for (let dz = -1; dz <= 1; dz++) {
				for (let dx = -1; dx <= 1; dx++) {
					const xx = x + dx
					const zz = z + dz
					if (xx < 0 || zz < 0 || xx >= w || zz >= h) continue
					sum += before[zz * w + xx]
					n++
				}
			}
			const i = z * w + x
			const want = before[i] + (sum / n - before[i]) * 0.5
			assert.ok(Math.abs(hs[i] - want) < 1e-5, `(${x}, ${z}) ${hs[i]} vs ${want}`)
		}
	}
})

test('vertices with weight 0 keep their height, and a flat patch stays flat', async () => {
	const w = 9
	const hs = Float32Array.from({ length: w * w }, () => Math.random() * 10)
	const weights = new Float32Array(w * w).fill(1)
	for (let i = 0; i < w; i++) weights[i] = weights[i * w] = weights[(w - 1) * w + i] = weights[i * w + w - 1] = 0
	const before = Float32Array.from(hs)
	assert.ok(
		await smoothPatch(
			hs,
			w,
			w,
			weights,
			{ ...settings, passes: 20 },
			() => {},
			() => false,
		),
	)
	for (let i = 0; i < w * w; i++) if (!weights[i]) assert.equal(hs[i], before[i])
	// The noise inside comes out much smoother: the spread between neighbours drops.
	const rough = (a: Float32Array) => {
		let s = 0
		for (let z = 1; z < w - 1; z++) for (let x = 1; x < w - 2; x++) s += Math.abs(a[z * w + x + 1] - a[z * w + x])
		return s
	}
	assert.ok(rough(hs) < rough(before) * 0.5)
	const flat = new Float32Array(25).fill(3)
	await smoothPatch(
		flat,
		5,
		5,
		new Float32Array(25).fill(1),
		{ ...settings, passes: 5 },
		() => {},
		() => false,
	)
	assert.ok(flat.every((v) => Math.abs(v - 3) < 1e-6))
})

test('the edge falloff rises from 0 at the fixed vertices to full at the band', () => {
	const w = 21
	const weights = new Float32Array(w).fill(1)
	weights[0] = 0
	fadeFromEdge(weights, w, 1, 8)
	assert.equal(weights[0], 0)
	assert.ok(weights[1] > 0 && weights[1] < 0.1)
	for (let x = 1; x < 8; x++) assert.ok(weights[x + 1] > weights[x])
	assert.equal(weights[8], 1)
	assert.equal(weights[20], 1)
	// No fixed vertex: nothing to fade from.
	const all = new Float32Array(9).fill(1)
	fadeFromEdge(all, 3, 3, 4)
	assert.ok(all.every((v) => v === 1))
})

test('a cancelled run stops at the next turn and reports progress', async () => {
	const w = 5
	const hs = Float32Array.from({ length: w * w }, (_, i) => i % 3)
	let turns = 0
	let last = -1
	const done = await smoothPatch(
		hs,
		w,
		w,
		new Float32Array(w * w).fill(1),
		{ ...settings, passes: 10 },
		(f) => (last = f),
		() => turns > 0,
		-1,
		async () => {
			turns++
		},
	)
	assert.equal(done, false)
	assert.equal(turns, 1)
	assert.ok(last > 0 && last < 1)
})

test('raise and lower move each vertex by the amount times its weight, and leave weight-0 vertices alone (#721)', () => {
	const w = 3
	const h = 2
	const weights = Float32Array.from([0, 1, 0.5, 1, 0.25, 0])
	for (const mode of ['raise', 'lower'] as const) {
		const hs = Float32Array.from([1, 2, 3, 4, 5, 6])
		shapePatch(hs, w, h, weights, { ...settings, mode, amount: 4 }, 0, 0, 1)
		const sign = mode === 'raise' ? 1 : -1
		for (let i = 0; i < w * h; i++) assert.ok(Math.abs(hs[i] - (i + 1 + sign * 4 * weights[i])) < 1e-5, `${mode} ${i}`)
	}
})

test('flatten levels the weighted vertices to their mean, or to a height (#721)', () => {
	const weights = Float32Array.from([1, 1, 0, 0.5])
	const hs = Float32Array.from([2, 4, 100, 9])
	const target = shapePatch(hs, 2, 2, weights, { ...settings, mode: 'flatten' as const, flatten: 'average' as const }, 0, 0, 1)
	assert.equal(target, 5)
	assert.deepEqual([...hs], [5, 5, 100, 7])
	const hs2 = Float32Array.from([2, 4, 100, 9])
	shapePatch(hs2, 2, 2, weights, { ...settings, mode: 'flatten' as const, flatten: 'height' as const, height: -1 }, 0, 0, 1)
	assert.deepEqual([...hs2], [-1, -1, 100, 4])
})

test('roughen adds bumps within the amplitude, the same for the same seed and spot, and none where the weight is 0 (#721)', () => {
	const w = 32
	const h = 32
	const weights = new Float32Array(w * h).fill(1)
	weights[0] = 0
	const o = { ...settings, mode: 'roughen' as const, amount: 2, scale: 8, seed: 3 }
	const a = new Float32Array(w * h)
	shapePatch(a, w, h, weights, o, 10, 20, 2)
	assert.equal(a[0], 0)
	let moved = 0
	for (const v of a) {
		assert.ok(Math.abs(v) <= 2 + 1e-5)
		if (Math.abs(v) > 0.05) moved++
	}
	assert.ok(moved > w * h * 0.5, `${moved} moved`)
	// The noise is in world space: the patch one vertex over reads the same bumps shifted.
	const b = new Float32Array(w * h)
	shapePatch(b, w, h, weights, o, 11, 20, 2)
	assert.ok(Math.abs(b[5] - a[6]) < 1e-5)
	const c = new Float32Array(w * h)
	shapePatch(c, w, h, weights, { ...o, seed: 4 }, 10, 20, 2)
	assert.notDeepEqual([...c], [...a])
})
