// Run with: bun test tests/blockSnapshot.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BlockSnapshot } from '../src/lib/tools/blockSnapshot.ts'

/** A W by H grid with `ch` values per cell, each cell holding its own index (plus the channel). */
function grid(W: number, H: number, ch: number) {
	const g = new Uint8Array(W * H * ch)
	for (let i = 0; i < W * H; i++) for (let k = 0; k < ch; k++) g[i * ch + k] = (i * 3 + k) & 255
	return g
}

/** The values a rect of `g` holds now, row-major. */
function slice(g: Uint8Array, W: number, ch: number, r: { x0: number; z0: number; x1: number; z1: number }) {
	const w = r.x1 - r.x0 + 1
	const out = new Uint8Array(w * (r.z1 - r.z0 + 1) * ch)
	for (let z = r.z0; z <= r.z1; z++) out.set(g.subarray((z * W + r.x0) * ch, (z * W + r.x1 + 1) * ch), (z - r.z0) * w * ch)
	return out
}

test('a reserved rect reads back what it held before the write', () => {
	const W = 20,
		H = 12,
		ch = 4
	const g = grid(W, H, ch)
	const before = g.slice()
	const snap = new BlockSnapshot(g, W, H, ch, 8)
	const r = { x0: 5, z0: 3, x1: 13, z1: 9 }
	snap.reserve(r)
	assert.equal(snap.size, 4, 'four 8-cell blocks lie under the rect')
	assert.ok(snap.covers(r))
	g.fill(7)
	assert.deepEqual(snap.extract(r), slice(before, W, ch, r))
})

test('blocks that were never reserved read from the live grid', () => {
	const W = 20,
		H = 12
	const g = grid(W, H, 1)
	const snap = new BlockSnapshot(g, W, H, 1, 8)
	snap.reserve({ x0: 0, z0: 0, x1: 7, z1: 7 }) // the first block only
	g.fill(9)
	const r = { x0: 4, z0: 4, x1: 11, z1: 5 } // straddles the saved block and an unsaved one
	const got = snap.extract(r)
	// Row 4: cells 4..7 from the saved block, 8..11 live.
	assert.deepEqual([...got.subarray(0, 8)], [((4 * W + 4) * 3) & 255, ((4 * W + 5) * 3) & 255, ((4 * W + 6) * 3) & 255, ((4 * W + 7) * 3) & 255, 9, 9, 9, 9])
	assert.equal(snap.covers(r), false)
})

test('reserving twice keeps the first copy, and reserving after a write is too late', () => {
	const W = 8,
		H = 8
	const g = grid(W, H, 1)
	const snap = new BlockSnapshot(g, W, H, 1, 4)
	snap.reserve({ x0: 0, z0: 0, x1: 0, z1: 0 })
	const first = snap.extract({ x0: 0, z0: 0, x1: 3, z1: 3 })
	g.fill(1)
	snap.reserve({ x0: 1, z0: 1, x1: 2, z1: 2 }) // same block: nothing new is copied
	assert.deepEqual(snap.extract({ x0: 0, z0: 0, x1: 3, z1: 3 }), first)
	snap.reserve({ x0: 4, z0: 4, x1: 4, z1: 4 }) // another block, after the write
	assert.deepEqual([...snap.extract({ x0: 4, z0: 4, x1: 5, z1: 4 })], [1, 1])
})

test('rects are clipped to the grid, and the edge blocks may be smaller', () => {
	const W = 10,
		H = 6 // 8-cell blocks: the last column of blocks is 2 wide, the last row 6 tall
	const g = grid(W, H, 2)
	const before = g.slice()
	const snap = new BlockSnapshot(g, W, H, 2, 8)
	snap.reserve({ x0: -3, z0: -3, x1: 50, z1: 50 })
	assert.equal(snap.size, 2)
	g.fill(0)
	const all = { x0: 0, z0: 0, x1: W - 1, z1: H - 1 }
	assert.deepEqual(snap.extract({ x0: -3, z0: -3, x1: 50, z1: 50 }), slice(before, W, 2, all))
	assert.deepEqual(snap.extract({ x0: 6, z0: 5, x1: 9, z1: 5 }), slice(before, W, 2, { x0: 6, z0: 5, x1: 9, z1: 5 }))
	assert.equal(snap.extract({ x0: 20, z0: 0, x1: 25, z1: 0 }).length, 0, 'a rect outside the grid is empty')
	assert.ok(snap.covers({ x0: 20, z0: 0, x1: 25, z1: 0 }), 'nothing outside the grid needs saving')
})

test('float grids keep their values', () => {
	const g = new Float32Array([0.5, 1.5, 2.5, 3.5])
	const snap = new BlockSnapshot(g, 2, 2, 1, 1)
	snap.reserve({ x0: 1, z0: 1, x1: 1, z1: 1 })
	g[3] = 99
	const got = snap.extract({ x0: 0, z0: 0, x1: 1, z1: 1 })
	assert.ok(got instanceof Float32Array)
	assert.deepEqual([...got], [0.5, 1.5, 2.5, 3.5])
	snap.clear()
	assert.equal(snap.size, 0)
})

test('diff keeps only the changed part of each saved block, and its patch undoes and redoes the write', () => {
	const W = 20,
		H = 12,
		ch = 2
	const g = grid(W, H, ch)
	const before = g.slice()
	const snap = new BlockSnapshot(g, W, H, ch, 8)
	const all = { x0: 0, z0: 0, x1: W - 1, z1: H - 1 }
	snap.reserve(all)
	assert.equal(snap.diff(all).size, 0, 'nothing written, nothing kept')
	// Two writes in two blocks: cells (2..3, 1) and the single cell (17, 10) in a narrow edge block.
	g[(1 * W + 2) * ch] = 200
	g[(1 * W + 3) * ch + 1] = 201
	g[(10 * W + 17) * ch] = 202
	const after = g.slice()
	const patch = snap.diff(all)
	assert.equal(patch.size, 2, 'one rect for each block written')
	assert.equal(patch.bytes, (2 + 1) * ch * 2, 'before and after of three cells')
	assert.deepEqual(patch.rect, { x0: 2, z0: 1, x1: 17, z1: 10 })
	patch.apply(g, true)
	assert.deepEqual(g, before)
	patch.apply(g, false)
	assert.deepEqual(g, after)
	assert.equal(snap.diff({ x0: 0, z0: 0, x1: 9, z1: 9 }).size, 1, 'a rect leaves out the changes outside it')
})

test('diff works on float grids', () => {
	const g = new Float32Array(10 * 10).fill(1.5)
	const snap = new BlockSnapshot(g, 10, 10, 1, 4)
	snap.reserve({ x0: 0, z0: 0, x1: 9, z1: 9 })
	g[55] = 3
	const patch = snap.diff({ x0: 0, z0: 0, x1: 9, z1: 9 })
	assert.deepEqual(patch.rect, { x0: 5, z0: 5, x1: 5, z1: 5 })
	assert.equal(patch.bytes, 8)
	patch.apply(g, true)
	assert.equal(g[55], 1.5)
})
