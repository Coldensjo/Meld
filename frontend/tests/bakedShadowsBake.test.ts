// Run with: bun test tests/bakedShadowsBake.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHADOW_PER_CELL, bakeShadows, chunkShadowBits, packShadowBits, unpackShadowBits } from '../src/lib/terrain/bakedShadows.ts'

test('a wall shadows the ground on its far side from the sun', () => {
	const size = 16
	const verts = size + 1
	const heights = new Float32Array(verts * verts)
	// A wall 10 high along x = 8 cells.
	for (let z = 0; z < verts; z++) heights[z * verts + 8] = 10
	const side = size * SHADOW_PER_CELL
	const out = new Uint8Array(side * side)
	// The sun low in the +x: the ground west of the wall (smaller x) is in its shadow.
	const sun = [Math.cos(1), Math.sin(1), 0] // a 10-high wall casts 6.4 yards, 3.2 cells
	const n = bakeShadows(heights, size, 2, sun, { x0: 0, z0: 0, x1: side - 1, z1: side - 1 }, out)
	assert.ok(n > 0)
	const at = (cellX: number) => out[8 * side + Math.floor(cellX * SHADOW_PER_CELL)]
	assert.equal(at(6), 255, 'just west of the wall')
	assert.equal(at(12), 0, 'east of the wall, toward the sun')
	assert.equal(at(1), 0, 'far west, out of reach')
	// A sun at the horizon or below casts nothing.
	bakeShadows(heights, size, 2, [0, -1, 0], { x0: 0, z0: 0, x1: side - 1, z1: side - 1 }, out)
	assert.ok(out.every((v) => v === 0))
})

test('the bits round-trip and a chunk is cut out in the client form', () => {
	const side = 128
	const bytes = new Uint8Array(side * side)
	bytes[0] = 255
	bytes[64 + 3] = 255 // chunk (1, 0), row 0, column 3
	bytes[(64 + 63) * side + 64 + 63] = 255 // chunk (1, 1), the last texel
	assert.deepEqual(unpackShadowBits(packShadowBits(bytes), side), bytes)
	const c10 = chunkShadowBits(bytes, side, 1, 0)
	assert.equal(c10[0], 1 << 3)
	const c11 = chunkShadowBits(bytes, side, 1, 1)
	assert.equal(c11[511], 0x80)
	assert.equal(chunkShadowBits(bytes, side, 0, 0)[0], 1)
})

test('casters shadow the ground behind them, and a ray tests each caster once', () => {
	const size = 16
	const heights = new Float32Array((size + 1) * (size + 1))
	const side = size * SHADOW_PER_CELL
	const out = new Uint8Array(side * side)
	// A post 10 high standing in block (2, 2) (cells 8 to 11); the sun low in the +x.
	const sun = [Math.cos(1), Math.sin(1), 0]
	const tested = new Map<number, number>()
	const casters = {
		raise(blockMax: Float32Array, nb: number) {
			blockMax[2 * nb + 2] = Math.max(blockMax[2 * nb + 2], 10)
		},
		hits(k: number, ray: number, x: number, y: number, z: number, dir: readonly number[]) {
			if (k !== 2 * 4 + 2) return false
			tested.set(ray, (tested.get(ray) ?? 0) + 1)
			// The post: x 19 to 21, z 19 to 21 (yards), 10 high; where the ray crosses x = 19.
			if (x >= 19) return false
			const t = (19 - x) / dir[0]
			const hy = y + dir[1] * t
			const hz = z + dir[2] * t
			return hy <= 10 && hz >= 19 && hz <= 21
		},
	}
	bakeShadows(heights, size, 2, sun, { x0: 0, z0: 0, x1: side - 1, z1: side - 1 }, out, casters)
	const at = (xYards: number, zYards: number) => out[Math.floor((zYards / 2) * SHADOW_PER_CELL) * side + Math.floor((xYards / 2) * SHADOW_PER_CELL)]
	assert.equal(at(16, 20), 255, 'just west of the post')
	assert.equal(at(16, 26), 0, 'beside its shadow')
	assert.equal(at(24, 20), 0, 'east of it, toward the sun')
	assert.ok(
		[...tested.values()].every((n) => n === 1),
		'each ray asks the block once',
	)
})
