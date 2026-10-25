// Run with: bun test tests/restorePaint.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PALETTE, NO_TEXTURE, SLOTS } from '../src/lib/terrain/chunkPaint.ts'
import { planRestore, restoreChunk } from '../src/lib/terrain/restorePaint.ts'

// Two paint chunks a side, two texels a chunk: a 4x4 splat.
const side = 2
const res = 4

function arrays() {
	const weights = new Uint8Array(res * res * SLOTS)
	for (let i = 0; i < weights.length; i += SLOTS) weights[i] = 255
	const chunkSlots = new Uint8Array(side * side * SLOTS).fill(NO_TEXTURE)
	for (let c = 0; c < side * side; c++) chunkSlots[c * SLOTS] = 0
	return { weights, chunkSlots }
}

/** Sets texel (x, z) to weights w. */
function texel(a: { weights: Uint8Array }, x: number, z: number, w: number[]) {
	a.weights.set(w, (z * res + x) * SLOTS)
}

test('restoring remaps the client textures to the map palette and adds the missing ones', () => {
	const basePalette = ['grass.blp', 'rock.blp', 'sand.blp']
	const base = arrays()
	// Chunk 1 (texels x 2-3, z 0-1): rock over sand.
	base.chunkSlots.set([1, 2, NO_TEXTURE, NO_TEXTURE], SLOTS)
	texel(base, 2, 0, [200, 55, 0, 0])
	texel(base, 3, 1, [0, 255, 0, 0])
	const target = arrays()
	const palette = ['ROCK.blp', 'grass.blp']
	// The map painted chunk 1 over with its texture 1 (grass).
	target.chunkSlots.set([1, NO_TEXTURE, NO_TEXTURE, NO_TEXTURE], SLOTS)
	const plan = planRestore(target, palette, base, basePalette, [0, 1, 2, 3], side, res)
	assert.ok(!('full' in plan))
	assert.deepEqual(plan.palette, ['ROCK.blp', 'grass.blp', 'sand.blp'])
	// Every chunk differs: the others name the map's index 0, rock, where the client has grass (index 1).
	assert.deepEqual(plan.changed, [0, 1, 2, 3])
	for (const c of plan.changed) restoreChunk(target, base, plan.remap, c, side, res)
	assert.deepEqual([...target.chunkSlots.subarray(SLOTS, 2 * SLOTS)], [0, 2, NO_TEXTURE, NO_TEXTURE])
	assert.deepEqual([...target.chunkSlots.subarray(0, SLOTS)], [1, NO_TEXTURE, NO_TEXTURE, NO_TEXTURE])
	assert.deepEqual([...target.weights], [...base.weights])
	// Restored, nothing differs any more.
	const again = planRestore(target, plan.palette, base, basePalette, [0, 1, 2, 3], side, res)
	assert.ok(!('full' in again))
	assert.deepEqual(again.changed, [])
	assert.deepEqual(again.palette, plan.palette)
})

test('restoring only touches the chunks asked for', () => {
	const basePalette = ['grass.blp', 'rock.blp']
	const base = arrays()
	base.chunkSlots.set([0, 1, NO_TEXTURE, NO_TEXTURE], 3 * SLOTS)
	texel(base, 3, 3, [100, 155, 0, 0])
	const target = arrays()
	texel(target, 0, 0, [0, 255, 0, 0])
	target.chunkSlots.set([0, 1, NO_TEXTURE, NO_TEXTURE], 0)
	const plan = planRestore(target, ['grass.blp', 'rock.blp'], base, basePalette, [3], side, res)
	assert.ok(!('full' in plan))
	assert.deepEqual(plan.changed, [3])
	restoreChunk(target, base, plan.remap, 3, side, res)
	// Chunk 0's painting stays.
	assert.deepEqual([...target.weights.subarray(0, SLOTS)], [0, 255, 0, 0])
	assert.deepEqual([...target.weights.subarray((3 * res + 3) * SLOTS, (3 * res + 3) * SLOTS + SLOTS)], [100, 155, 0, 0])
})

test('a full palette refuses the restore and names the textures', () => {
	const palette = Array.from({ length: MAX_PALETTE }, (_, i) => `t${i}.blp`)
	const base = arrays()
	const plan = planRestore(arrays(), palette, base, ['new.blp'], [0, 1], side, res)
	assert.deepEqual(plan, { full: ['new.blp'] })
})
