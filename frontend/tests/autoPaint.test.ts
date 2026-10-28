// Run with: bun test tests/autoPaint.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { generateHeights } from '../src/lib/terrain/generate.ts'
import { autoPaintRoles, AUTO_PAINT_ROLES } from '../src/lib/terrain/autoPaint.ts'
import { CHUNK_CELLS, NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../src/lib/terrain/chunkPaint.ts'
import { SAND_BAND } from '../src/lib/terrain/beach.ts'

const CELL = 1600 / 3 / 128

function paint(kind: 'hills' | 'mountains' | 'island', seed: number, size = 256) {
	const heights = new Float32Array((size + 1) * (size + 1))
	generateHeights(heights, size, CELL, kind, seed)
	const res = size * SPLAT_PER_CELL
	const side = size / CHUNK_CELLS
	const packed = autoPaintRoles({ heights, size, cellSize: CELL, res, side, roles: 8, waterLevel: 0, waterEnabled: kind === 'island', sand: SAND_BAND, seed })
	return { ...packed, res, side, size }
}

/** The role of the texel's heaviest slot. */
function dominant(p: ReturnType<typeof paint>, x: number, z: number): number {
	const per = p.res / p.side
	const c = Math.floor(z / per) * p.side + Math.floor(x / per)
	const base = (z * p.res + x) * SLOTS
	let best = 0
	for (let k = 1; k < SLOTS; k++) if (p.weights[base + k] > p.weights[base + best]) best = k
	return p.chunkSlots[c * SLOTS + best]
}

for (const kind of ['hills', 'mountains', 'island'] as const) {
	test(`a ${kind} world keeps at most three textures in a chunk (#771)`, () => {
		const p = paint(kind, 5)
		for (let c = 0; c < p.side * p.side; c++) {
			let n = 0
			for (let k = 0; k < SLOTS; k++) if (p.chunkSlots[c * SLOTS + k] !== NO_TEXTURE) n++
			assert.ok(n >= 1 && n <= AUTO_PAINT_ROLES, `chunk ${c} has ${n}`)
		}
	})
}

test('a hills world is painted in large areas, not in small patches (#771)', () => {
	const p = paint('hills', 5)
	// Runs of one texture along rows, in yards: the old 30 yd noise blobs gave runs of a few yards.
	let runs = 0
	let changes = 0
	const yards = CELL / SPLAT_PER_CELL
	for (let z = 0; z < p.res; z += 16) {
		let prev = dominant(p, 0, z)
		runs++
		for (let x = 1; x < p.res; x++) {
			const d = dominant(p, x, z)
			if (d !== prev) changes++
			prev = d
		}
	}
	const mean = ((p.res * runs) / (runs + changes)) * yards
	assert.ok(mean > 60, `mean run ${mean.toFixed(1)} yd`)
	// The base ground is most of a hills world.
	let grass = 0
	for (let z = 0; z < p.res; z += 8) for (let x = 0; x < p.res; x += 8) if (dominant(p, x, z) === 0) grass++
	assert.ok(grass / (p.res / 8) ** 2 > 0.4, `grass share ${grass / (p.res / 8) ** 2}`)
})

test('the variation follows the seed (#771)', () => {
	const a = paint('hills', 5, 128)
	const b = paint('hills', 5, 128)
	const c = paint('hills', 6, 128)
	assert.deepEqual(a.weights, b.weights)
	assert.notDeepEqual(a.chunkSlots.join(), c.chunkSlots.join())
})
