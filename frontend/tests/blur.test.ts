// Run with: bun test tests/blur.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyRect, tentBlur } from '../src/lib/terrain/blur.ts'

test('a flat map stays flat and a spike spreads over the radius, keeping its mass', () => {
	const V = 21
	const h = new Float32Array(V * V)
	const out = new Float32Array(V * V)
	tentBlur(h, V, { x0: 0, z0: 0, x1: V - 1, z1: V - 1 }, 3, out, new Float32Array(0))
	assert.ok(out.every((v) => v === 0))
	h[10 * V + 10] = 160
	tentBlur(h, V, { x0: 0, z0: 0, x1: V - 1, z1: V - 1 }, 3, out, new Float32Array(0))
	// The peak drops to the kernel's centre weight squared, and the ring at the radius still gets some.
	assert.ok(out[10 * V + 10] < 160 * 0.2)
	assert.ok(out[10 * V + 13] > 0)
	assert.equal(out[10 * V + 14], 0)
	const total = out.reduce((a, b) => a + b, 0)
	assert.ok(Math.abs(total - 160) < 1e-3, `mass ${total}`)
})

test('only the rect is written, and the scratch grows when it is too small', () => {
	const V = 9
	const h = Float32Array.from({ length: V * V }, (_, i) => i % V)
	const out = new Float32Array(V * V).fill(-1)
	const tmp = tentBlur(h, V, { x0: 2, z0: 2, x1: 4, z1: 4 }, 1, out, new Float32Array(1))
	assert.ok(tmp.length >= 3 * 5)
	assert.equal(out[0], -1)
	// A slope along x stays the same slope inside, away from the edges.
	assert.ok(Math.abs(out[3 * V + 3] - 3) < 1e-6)
})

test('copyRect copies the rect grown by the margin, clamped to the map, and nothing else', () => {
	const V = 9
	const src = new Float32Array(V * V).map((_, i) => i + 1)
	const dst = new Float32Array(V * V)
	copyRect(src, V, { x0: 0, z0: 3, x1: 2, z1: 4 }, 1, dst)
	for (let z = 0; z < V; z++) {
		for (let x = 0; x < V; x++) {
			const inside = x <= 3 && z >= 2 && z <= 5
			assert.equal(dst[z * V + x], inside ? src[z * V + x] : 0)
		}
	}
})
