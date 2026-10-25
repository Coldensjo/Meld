// Run with: bun test tests/chunkDataStroke.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChunkDataStroke } from '../src/lib/tools/chunkDataStroke.ts'
import { CHUNK_IMPASSABLE } from '../src/lib/terrain/chunkFlags.ts'
import type { Terrain } from '../src/lib/terrain/Terrain.ts'

/** The part of a terrain a Map data stroke reads and writes: 64 cells, 8x8 chunks. */
function terrain() {
	const t = { size: 64, areaIds: new Uint32Array(64), chunkFlags: new Uint8Array(64), noEffect: new Uint8Array(64 * 64), touched: 0, touchChunkData: () => t.touched++ }
	return t
}

test('a stroke undoes and redoes the zones, flags and no-tuft cells it changed', () => {
	const t = terrain()
	t.areaIds[3] = 12
	const s = new ChunkDataStroke(t as unknown as Terrain, 'Paint')
	t.areaIds[3] = 40
	t.chunkFlags[9] = CHUNK_IMPASSABLE
	const r = { x0: 5, z0: 6, x1: 6, z1: 6 }
	s.reserveCells(r)
	t.noEffect[6 * 64 + 5] = 1
	t.noEffect[6 * 64 + 6] = 1
	s.touchCells(r)
	const cmd = s.finish()!
	// Two chunks (areas 4+4 each side, flags 1+1) and a 2x1 cell rect (2 bytes each side).
	assert.equal(cmd.bytes, 2 * 4 * 2 + 2 * 2 + 2 * 2)
	assert.ok(cmd)
	cmd.undo()
	assert.equal(t.areaIds[3], 12)
	assert.equal(t.chunkFlags[9], 0)
	assert.equal(t.noEffect[6 * 64 + 5] + t.noEffect[6 * 64 + 6], 0)
	cmd.redo()
	assert.equal(t.areaIds[3], 40)
	assert.equal(t.chunkFlags[9], CHUNK_IMPASSABLE)
	assert.equal(t.noEffect[6 * 64 + 6], 1)
	assert.ok(t.touched >= 2)
})

test('a stroke that changed nothing is no undo step', () => {
	const t = terrain()
	const s = new ChunkDataStroke(t as unknown as Terrain, 'Paint')
	t.areaIds[1] = 5
	t.areaIds[1] = 0
	const r = { x0: 0, z0: 0, x1: 1, z1: 1 }
	s.reserveCells(r)
	s.touchCells(r)
	assert.equal(s.finish(), null)
})
