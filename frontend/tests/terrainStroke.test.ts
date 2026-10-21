// Run with: bun test tests/terrainStroke.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TerrainStroke } from '../src/lib/tools/brush.ts'
import type { Terrain } from '../src/lib/terrain/Terrain.ts'

/** A flat map of `size` cells with a paint mask, enough for a stroke that records heights and the mask. */
function fakeTerrain(size: number) {
	const verts = size + 1
	const splatRes = size * 4
	const t = {
		size,
		verts,
		splatRes,
		heights: new Float32Array(verts * verts).fill(10),
		mask: new Uint8Array(splatRes * splatRes),
		maskDirty: [] as unknown[],
		markDirty() {},
		markMaskDirty(r?: unknown) {
			t.maskDirty.push(r)
		},
	}
	return t
}

test('a whole-mask step keeps only the changed corner, and undoes and redoes it', () => {
	const t = fakeTerrain(64)
	const R = t.splatRes
	const all = { x0: 0, z0: 0, x1: R - 1, z1: R - 1 }
	const stroke = new TerrainStroke(t as unknown as Terrain, 'Wand', { mask: true })
	stroke.reserveMask(all)
	for (let z = 10; z <= 19; z++) for (let x = 100; x <= 104; x++) t.mask[z * R + x] = 255
	stroke.touchMask(all)
	const cmd = stroke.finish()
	assert.ok(cmd)
	assert.equal(cmd.bytes, 10 * 5 * 2, 'before and after of the 50 changed texels, not two copies of the mask')
	const after = t.mask.slice()
	cmd.undo()
	assert.ok(t.mask.every((v) => v === 0), 'undo clears what the step set')
	assert.deepEqual(t.maskDirty.at(-1), { x0: 100, z0: 10, x1: 104, z1: 19 }, 'undo uploads the changed rect')
	cmd.redo()
	assert.deepEqual(t.mask, after)
})

test('a heights step keeps the vertices that changed, not the whole reserved rect', () => {
	const t = fakeTerrain(64)
	const V = t.verts
	const stroke = new TerrainStroke(t as unknown as Terrain, 'Erode map', { heights: true })
	const all = { x0: 0, z0: 0, x1: V - 1, z1: V - 1 }
	stroke.reserveHeights(all)
	t.heights[30 * V + 30] = 12
	t.heights[31 * V + 31] = 8
	stroke.touchHeights(all)
	const cmd = stroke.finish()
	assert.ok(cmd)
	assert.equal(cmd.bytes, 2 * 2 * 2 * 4, 'a 2x2 rect of floats, before and after')
	cmd.undo()
	assert.ok(t.heights.every((v) => v === 10))
	cmd.redo()
	assert.equal(t.heights[30 * V + 30], 12)
	assert.equal(t.heights[31 * V + 31], 8)
})
