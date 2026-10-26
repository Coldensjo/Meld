// Run with: bun test tests/worldLiquid.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIQUID_LAYER_BYTES, liquidMesh, parseLiquids, type TileLiquid } from '../src/lib/world/worldLiquid.ts'
import { TILE_YARDS } from '../src/lib/wow/format.ts'

const CELL = TILE_YARDS / 128

/** A /wow/groundliquids reply (wow.EncodeLiquids) of `layers`. */
function reply(layers: TileLiquid[]): ArrayBuffer {
	const buf = new ArrayBuffer(6 + layers.length * LIQUID_LAYER_BYTES)
	const u = new Uint8Array(buf)
	const v = new DataView(buf)
	u.set([...'LIQD'].map((c) => c.charCodeAt(0)))
	v.setUint16(4, layers.length, true)
	layers.forEach((l, k) => {
		const at = 6 + k * LIQUID_LAYER_BYTES
		u.set([l.indexX, l.indexY, l.type], at)
		l.heights.forEach((h, i) => v.setFloat32(at + 4 + i * 4, h, true))
		u.set(l.depth, at + 4 + 81 * 4)
		u.set(l.cells, at + 4 + 81 * 5)
	})
	return buf
}

/** A layer of chunk (x, y) at height `h`, its depth the vertex number, covering the cells `on` says. */
function layer(x: number, y: number, type: number, h: number, on: (c: number) => boolean): TileLiquid {
	return {
		indexX: x,
		indexY: y,
		type,
		heights: new Float32Array(81).map((_, i) => h + i * 0.01),
		depth: new Uint8Array(81).map((_, i) => i),
		cells: new Uint8Array(64).map((_, c) => (on(c) ? 1 : 0)),
	}
}

test('a liquids reply reads back as its layers, and a bad one is refused', () => {
	const a = layer(3, 7, 1, 10, (c) => c === 0 || c === 63)
	const b = layer(15, 0, 2, -2, () => true)
	const got = parseLiquids(reply([a, b]))
	assert.equal(got.length, 2)
	assert.deepEqual([got[0].indexX, got[0].indexY, got[0].type], [3, 7, 1])
	assert.equal(got[0].heights[40], Math.fround(10.4))
	assert.equal(got[0].depth[80], 80)
	assert.deepEqual([got[0].cells[0], got[0].cells[1], got[0].cells[63]], [1, 0, 1])
	assert.equal(got[1].type, 2)
	assert.deepEqual(parseLiquids(reply([])), [])
	assert.throws(() => parseLiquids(new ArrayBuffer(12)))
	assert.throws(() => parseLiquids(reply([a, b]).slice(0, 6 + LIQUID_LAYER_BYTES)))
})

test("a tile's liquids mesh at each chunk's place in the tile, two triangles a covered cell", () => {
	const l = layer(2, 5, 3, 7, (c) => c === 9)
	const m = liquidMesh([l], 1, (t) => t * 10)!
	assert.equal(m.index.length, 6)
	// Vertex 0 at the chunk's corner, vertex 80 at its far corner.
	assert.deepEqual([...m.positions.subarray(0, 3)], [2 * 8 * CELL, Math.fround(7), 5 * 8 * CELL].map(Math.fround))
	assert.equal(m.positions[80 * 3], Math.fround((2 * 8 + 8) * CELL))
	assert.equal(m.positions[80 * 3 + 2], Math.fround((5 * 8 + 8) * CELL))
	assert.equal(m.depth[80], Math.fround(80 / 255))
	assert.equal(m.kind[0], 30)
	// Cell 9 is row 1, column 1: corners 10, 19, 20 and 11.
	assert.deepEqual([...m.index], [10, 19, 20, 20, 11, 10])
	assert.equal(
		liquidMesh([layer(0, 0, 1, 0, () => false)], 1, () => 0),
		null,
	)
})

test('a far stride draws a block the layer covers whole as one quad and keeps the cells of a block with a dry cell', () => {
	const sea = layer(0, 0, 2, 0, () => true)
	assert.equal(liquidMesh([sea], 1, () => 1)!.index.length / 3, 128)
	assert.equal(liquidMesh([sea], 2, () => 1)!.index.length / 3, 32)
	const four = liquidMesh([sea], 4, () => 1)!
	assert.equal(four.index.length / 3, 8)
	// The first block's quad runs from vertex 0 to vertex 4 rows and 4 columns on.
	assert.deepEqual([...four.index.subarray(0, 6)], [0, 36, 40, 40, 4, 0])
	// One dry cell keeps its block's other 15 cells, and the other three blocks are a quad each.
	const shore = layer(0, 0, 2, 0, (c) => c !== 0)
	assert.equal(liquidMesh([shore], 4, () => 1)!.index.length / 3, 15 * 2 + 3 * 2)
})
