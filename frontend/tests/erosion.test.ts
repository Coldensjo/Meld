// Run with: node --import ./tests/register.mjs --test tests/erosion.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Eroder, talusSlope } from '../src/lib/terrain/erosion.ts'
import { areaVertexWeights, erodePatch } from '../src/lib/terrain/erodeArea.ts'
import { INSIDE } from '../src/lib/terrain/areaShape.ts'

/** A cone `top` cell units high and `r` cells wide in the middle of an n by n patch, with a few bumps so drops find their own ways. */
function cone(n: number, top: number, r: number): Float32Array {
	const hs = new Float32Array(n * n)
	for (let z = 0; z < n; z++) {
		for (let x = 0; x < n; x++) {
			const d = Math.hypot(x - n / 2, z - n / 2) / r
			hs[z * n + x] = Math.max(0, 1 - d) * top + Math.sin(x * 0.7) * Math.cos(z * 0.6) * 0.3
		}
	}
	return hs
}

const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0)

test('the same seed erodes the same way, another seed another way', () => {
	const a = cone(48, 20, 20)
	const b = a.slice()
	const c = a.slice()
	const e = new Eroder()
	e.seed(7)
	e.droplets(a, 48, 48, 2000)
	e.seed(7)
	e.droplets(b, 48, 48, 2000)
	e.seed(8)
	e.droplets(c, 48, 48, 2000)
	assert.deepEqual(a, b)
	assert.notDeepEqual(a, c)
})

test('drops leave flat ground alone and carve a slope without raising its peak', () => {
	const flat = new Float32Array(32 * 32).fill(5)
	const e = new Eroder()
	e.seed(1)
	e.droplets(flat, 32, 32, 500)
	assert.ok(flat.every((v) => v === 5))

	const n = 64
	const hs = cone(n, 30, 20)
	const before = hs.slice()
	e.droplets(hs, n, n, n * n)
	let changed = 0
	let most = 0
	for (let i = 0; i < hs.length; i++) {
		const d = Math.abs(hs[i] - before[i])
		if (d > 1e-4) changed++
		most = Math.max(most, d)
	}
	assert.ok(changed > n * n * 0.3, `changed ${changed}`)
	// Gullies, not a crater: no vertex moves more than half the cone's height.
	assert.ok(most < 15, `most ${most}`)
	const peak = (n / 2) * n + n / 2
	assert.ok(hs[peak] <= before[peak] + 1e-4)
	// What the drops carry they mostly leave on the patch (only the ones that run off take theirs away).
	assert.ok(sum(hs) > sum(before) * 0.8 && sum(hs) <= sum(before) + 1e-3, `volume ${sum(hs)} of ${sum(before)}`)
})

test('drops start only where the spawn weights let them', () => {
	const n = 40
	const hs = cone(n, 20, 18)
	const before = hs.slice()
	const spawn = new Float32Array(n * n)
	const e = new Eroder()
	e.seed(3)
	assert.equal(e.droplets(hs, n, n, 300, spawn), 0)
	assert.deepEqual(hs, before)
})

test('thermal passes slide a spike down to the talus slope and keep its volume', () => {
	const n = 21
	const hs = new Float32Array(n * n)
	hs[10 * n + 10] = 12
	const e = new Eroder()
	const talus = talusSlope(45)
	assert.ok(Math.abs(talus - 1) < 1e-9)
	for (let k = 0; k < 400; k++) e.thermal(hs, n, n, talus, 1)
	assert.ok(Math.abs(sum(hs) - 12) < 1e-3, `volume ${sum(hs)}`)
	let steepest = 0
	for (let z = 0; z < n; z++) for (let x = 0; x + 1 < n; x++) steepest = Math.max(steepest, Math.abs(hs[z * n + x] - hs[z * n + x + 1]))
	assert.ok(steepest <= talus + 0.05, `steepest ${steepest}`)
	assert.ok(hs[10 * n + 10] < 12)
})

test('an area changes only the vertices whose cells are all in it', () => {
	const size = 4
	const cells = new Uint8Array(size * size)
	cells[1 * size + 1] = INSIDE
	cells[1 * size + 2] = INSIDE
	const r = { x0: 0, z0: 0, x1: 4, z1: 4 }
	const out = new Float32Array(25)
	areaVertexWeights(cells, size, r, out)
	// Cells (1,1) and (2,1) are in: no vertex has all four of its cells in.
	assert.equal(out.reduce((a, b) => a + b, 0), 0)
	cells[2 * size + 1] = INSIDE
	cells[2 * size + 2] = INSIDE
	areaVertexWeights(cells, size, r, out)
	// Now the 2x2 block of cells (1..2, 1..2) is in: the one vertex inside it, (2, 2).
	assert.equal(out[2 * 5 + 2], 1)
	assert.equal(out.reduce((a, b) => a + b, 0), 1)
	// The map's own edge counts as in.
	cells.fill(INSIDE)
	areaVertexWeights(cells, size, r, out)
	assert.ok(out.every((v) => v === 1))
	areaVertexWeights(null, size, r, out.fill(0))
	assert.ok(out.every((v) => v === 1))
})

test('the area pass reports its progress to the end, and a cancel stops it at once', async () => {
	const n = 64
	const hs = cone(n, 30, 28)
	const shares: number[] = []
	const o = { density: 1, passes: 3, talus: 40, seed: 1 }
	const turn = () => Promise.resolve()
	assert.equal(await erodePatch(hs, n, n, null, o, (f) => shares.push(f), () => false, 0, turn), true)
	assert.equal(shares.at(-1), 1)
	for (let i = 1; i < shares.length; i++) assert.ok(shares[i] >= shares[i - 1])

	const again = cone(n, 30, 28)
	let turns = 0
	const done = await erodePatch(again, n, n, null, o, () => {}, () => turns > 0, 0, () => {
		turns++
		return Promise.resolve()
	})
	assert.equal(done, false)
	assert.equal(turns, 1)
})
