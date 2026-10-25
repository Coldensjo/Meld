// Run with: bun test tests/clipChunkData.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyChunkData, pasteChunkData } from '../src/lib/world/clipChunkData.ts'
import { rotateClip } from '../src/lib/world/clipRotate.ts'
import { ChunkDataStroke } from '../src/lib/tools/chunkDataStroke.ts'
import { CHUNK_IMPASSABLE } from '../src/lib/terrain/chunkFlags.ts'
import type { MapClip } from '../src/lib/world/clipboard.ts'
import type { Terrain } from '../src/lib/terrain/Terrain.ts'

/** A 32-cell map: 4x4 paint chunks of 8 cells. */
function terrain() {
	const t = {
		size: 32,
		paintChunksPerSide: 4,
		areaIds: new Uint32Array(16),
		chunkFlags: new Uint8Array(16),
		noEffect: new Uint8Array(32 * 32),
		touched: 0,
		touchChunkData: () => t.touched++,
	}
	return t
}

/** A clip of the given size carrying only chunk data. */
function clipOf(w: number, h: number, chunkData: MapClip['chunkData']): MapClip {
	return { w, h, heights: new Float32Array((w + 1) * (h + 1)), holes: new Uint8Array(w * h), weights: new Uint8Array(0), slots: new Uint8Array(0), palette: [], objects: [], chunkData }
}

test("a copy keeps each cell's zone, flags and no-tuft byte", () => {
	const t = terrain()
	t.areaIds[0] = 12 // chunk (0, 0)
	t.areaIds[1] = 87 // chunk (1, 0)
	t.chunkFlags[1] = CHUNK_IMPASSABLE
	t.noEffect[2 * 32 + 9] = 1
	// Cells 6..10 by 0..3: two of chunk 0's columns, three of chunk 1's.
	const d = copyChunkData(t, { x0: 6, z0: 0, x1: 11, z1: 4 })
	assert.equal(d.areas.length, 5 * 4)
	assert.deepEqual([...d.areas.slice(0, 5)], [12, 12, 87, 87, 87])
	assert.equal(d.flags[2], CHUNK_IMPASSABLE)
	assert.equal(d.noEffect[2 * 5 + 3], 1)
})

test('a paste lays the no-tuft cells and gives a chunk whose centre it covers the zone there, as one undo step', () => {
	const src = terrain()
	src.areaIds.fill(40)
	src.chunkFlags.fill(CHUNK_IMPASSABLE)
	src.noEffect.fill(1)
	// A 12 by 6 copy: pasted at (2, 2), it covers chunk (0, 0)'s centre (4, 4) and chunk (1, 0)'s (12, 4).
	const clip = clipOf(12, 6, copyChunkData(src, { x0: 0, z0: 0, x1: 12, z1: 6 }))
	const t = terrain()
	t.areaIds.fill(12)
	const stroke = new ChunkDataStroke(t as unknown as Terrain, 'Paste')
	pasteChunkData(t, clip, 2, 2, stroke)
	assert.equal(t.areaIds[0], 40)
	assert.equal(t.areaIds[1], 40)
	assert.equal(t.chunkFlags[1], CHUNK_IMPASSABLE)
	// Chunk (2, 0)'s centre (20, 4) is past the paste's last cell (13), so it keeps its zone.
	assert.equal(t.areaIds[2], 12)
	assert.equal(t.chunkFlags[2], 0)
	assert.equal(t.noEffect[2 * 32 + 2], 1)
	assert.equal(t.noEffect[7 * 32 + 13], 1)
	assert.equal(t.noEffect[8 * 32 + 13], 0)
	const cmd = stroke.finish()!
	cmd.undo()
	assert.equal(t.areaIds[0], 12)
	assert.equal(t.chunkFlags[1], 0)
	assert.equal(t.noEffect[2 * 32 + 2], 0)
	cmd.redo()
	assert.equal(t.areaIds[1], 40)
})

test("a clip cell with no zone keeps the chunk's own", () => {
	const clip = clipOf(8, 8, { areas: new Uint32Array(64), flags: new Uint8Array(64), noEffect: new Uint8Array(64) })
	const t = terrain()
	t.areaIds[5] = 87
	t.chunkFlags[5] = CHUNK_IMPASSABLE
	const stroke = new ChunkDataStroke(t as unknown as Terrain, 'Paste')
	pasteChunkData(t, clip, 8, 8, stroke)
	assert.equal(t.areaIds[5], 87)
	assert.equal(t.chunkFlags[5], 0)
})

test('a quarter turn turns the chunk data with the cells', () => {
	const areas = Uint32Array.from({ length: 6 }, (_, i) => i + 1)
	const c = clipOf(3, 2, { areas, flags: new Uint8Array(6), noEffect: Uint8Array.from([0, 0, 0, 0, 0, 1]) })
	const r = rotateClip(c, 2)
	// Cell (x, z) lands at (z, w - 1 - x): (2, 1) at (1, 0), (0, 0) at (0, 2).
	assert.equal(r.chunkData!.noEffect[0 * 2 + 1], 1)
	assert.equal(r.chunkData!.areas[2 * 2 + 0], 1)
	assert.equal(r.chunkData!.areas[0 * 2 + 1], 6)
})
