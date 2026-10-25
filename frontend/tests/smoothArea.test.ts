// Run with: bun test tests/smoothArea.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fadeFromEdge, smoothPass, smoothPatch } from '../src/lib/terrain/smoothArea.ts'

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
