// Run with: bun test tests/chunkPaint.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	CHUNK_CELLS,
	NO_TEXTURE,
	SLOTS,
	acquireSlot,
	acquireSlotCompacting,
	chunkTextures,
	acquireSlotReplacing,
	replaceInChunk,
	removeSlot,
	addWeight,
	chunksPerSide,
	convertGlobalLayers,
	findSlot,
	normalizeTexel,
	packRoles,
	paletteCoverage,
	paletteIndex,
	replacePalette,
	clearPalette,
	compactChunk,
	hasEmptySlot,
} from '../src/lib/terrain/chunkPaint.ts'

test('a chunk takes four textures and refuses a fifth', () => {
	const slots = new Uint8Array(SLOTS).fill(NO_TEXTURE)
	assert.equal(acquireSlot(slots, 0, 7), 0)
	assert.equal(acquireSlot(slots, 0, 9), 1)
	assert.equal(acquireSlot(slots, 0, 7), 0, 'a texture already in the chunk keeps its slot')
	assert.equal(acquireSlot(slots, 0, 3), 2)
	assert.equal(acquireSlot(slots, 0, 4), 3)
	assert.equal(acquireSlot(slots, 0, 5), -1, 'a fifth texture is refused')
	assert.equal(findSlot(slots, 0, 4), 3)
	assert.equal(findSlot(slots, 0, 5), -1)
})

test('chunks do not share slots', () => {
	const slots = new Uint8Array(2 * SLOTS).fill(NO_TEXTURE)
	acquireSlot(slots, 0, 1)
	assert.equal(findSlot(slots, 1, 1), -1)
})

test('adding weight keeps a texel summing to 255', () => {
	const w = new Uint8Array(SLOTS)
	w[0] = 255
	for (let i = 0; i < 200; i++) addWeight(w, 0, (i % 3) + 1, 0.1)
	assert.equal(w[0] + w[1] + w[2] + w[3], 255)
	assert.ok(w[1] > 0 && w[2] > 0 && w[3] > 0)
})

test('adding to an empty texel makes that slot the only one', () => {
	const w = new Uint8Array(SLOTS)
	addWeight(w, 0, 2, 0.5)
	assert.equal(w[2], 255)
	assert.equal(w[0] + w[1] + w[3], 0)
})

test('normalizeTexel fixes rounding without losing weight', () => {
	const w = Uint8Array.from([100, 100, 50, 0])
	normalizeTexel(w, 0)
	assert.equal(w[0] + w[1] + w[2] + w[3], 255)
})

test('packRoles keeps only four textures per chunk and sums each texel to 255', () => {
	const side = 2 // a 16-cell map: two chunks a side
	const res = side * CHUNK_CELLS * 2 // two texels a cell
	const roles = 6
	// Every texel holds all six roles equally, so each chunk must pick four of them.
	const { weights, chunkSlots } = packRoles(side, res, roles, (_x, _z, out) => out.fill(255 / 6))
	for (let c = 0; c < side * side; c++) {
		const used = [...chunkSlots.slice(c * SLOTS, c * SLOTS + SLOTS)].filter((v) => v !== NO_TEXTURE)
		assert.equal(used.length, 4)
		assert.equal(new Set(used).size, 4, 'a chunk never repeats a texture')
	}
	for (let t = 0; t < res * res; t++) {
		let sum = 0
		for (let k = 0; k < SLOTS; k++) sum += weights[t * SLOTS + k]
		assert.equal(sum, 255)
	}
})

test('a chunk nothing was painted in falls back to the first palette entry', () => {
	const side = 1
	const res = CHUNK_CELLS * 2
	const { weights, chunkSlots } = packRoles(side, res, 3, (_x, _z, out) => out.fill(0))
	assert.equal(chunkSlots[0], 0)
	assert.equal(weights[0], 255)
})

test('a format 1 map converts to chunks with the same look where a chunk has few layers', () => {
	const side = 2
	const oldRes = side * CHUNK_CELLS * 2
	const splatA = new Uint8Array(oldRes * oldRes * 4)
	const splatB = new Uint8Array(oldRes * oldRes * 4)
	for (let i = 0; i < splatA.length; i += 4) {
		splatA[i + 2] = 255 // layer 2 everywhere
		splatB[i + 1] = 255 // layer 5 everywhere
	}
	const res = side * CHUNK_CELLS * 4
	const { weights, chunkSlots } = convertGlobalLayers(side, res, oldRes, splatA, splatB)
	for (let c = 0; c < side * side; c++) {
		assert.deepEqual([...chunkSlots.slice(c * SLOTS, c * SLOTS + 2)].sort(), [2, 5])
	}
	// Each texel is an even mix of layers 2 and 5 (127 or 128 each, since 255 is odd).
	const slot2 = findSlot(chunkSlots, 0, 2)
	const slot5 = findSlot(chunkSlots, 0, 5)
	assert.ok(Math.abs(weights[slot2] - 127.5) <= 0.5)
	assert.ok(Math.abs(weights[slot5] - 127.5) <= 0.5)
	assert.equal(weights[slot2] + weights[slot5], 255)
})

test('the chunk count follows the map size', () => {
	assert.equal(chunksPerSide(128), 16)
	assert.equal(chunksPerSide(512), 64)
})

test('coverage counts each palette entry by its weight across the map', () => {
	const side = 1
	const res = CHUNK_CELLS * 2
	const weights = new Uint8Array(res * res * SLOTS)
	const slots = new Uint8Array(SLOTS).fill(NO_TEXTURE)
	slots[0] = 0
	slots[1] = 2
	for (let t = 0; t < res * res; t++) {
		weights[t * SLOTS] = 255 * 0.75
		weights[t * SLOTS + 1] = 255 * 0.25
	}
	const cov = paletteCoverage(weights, slots, res, side, 4)
	assert.ok(Math.abs(cov[0] - 0.75) < 0.01)
	assert.ok(Math.abs(cov[2] - 0.25) < 0.01)
	assert.equal(cov[1], 0)
})

test('paletteIndex ignores case', () => {
	assert.equal(paletteIndex(['#112233', 'Tileset\Elwynn\Dirt.blp'], 'tileset\elwynn\dirt.BLP'), 1)
	assert.equal(paletteIndex(['a'], 'b'), -1)
})

test('a texture swap renames the slot where the target is absent', () => {
	const side = 1
	const res = CHUNK_CELLS * 2
	const slots = new Uint8Array(SLOTS).fill(NO_TEXTURE)
	slots[0] = 0
	slots[1] = 1
	const weights = new Uint8Array(res * res * SLOTS)
	for (let t = 0; t < res * res; t++) {
		weights[t * SLOTS] = 128
		weights[t * SLOTS + 1] = 127
	}
	replacePalette(side, res, slots, weights, 1, 3)
	assert.deepEqual([...slots], [0, 3, NO_TEXTURE, NO_TEXTURE])
	assert.equal(weights[1], 127)
})

test('a texture swap folds the weight into a target the chunk already has', () => {
	const side = 1
	const res = CHUNK_CELLS * 2
	const slots = new Uint8Array(SLOTS).fill(NO_TEXTURE)
	slots[0] = 0
	slots[1] = 1
	slots[2] = 2
	const weights = new Uint8Array(res * res * SLOTS)
	for (let t = 0; t < res * res; t++) {
		weights[t * SLOTS] = 100
		weights[t * SLOTS + 1] = 100
		weights[t * SLOTS + 2] = 55
	}
	replacePalette(side, res, slots, weights, 1, 2)
	assert.equal(slots[1], NO_TEXTURE)
	assert.equal(slots[2], 2)
	assert.equal(weights[0] + weights[1] + weights[2] + weights[3], 255)
	assert.equal(weights[1], 0)
	assert.ok(weights[2] >= 154 && weights[2] <= 156, `merged weight ${weights[2]}`)
})

test('clearing the map leaves one fully painted texture everywhere', () => {
	const side = 2
	const res = side * CHUNK_CELLS * 2
	const slots = new Uint8Array(side * side * SLOTS).fill(1)
	const weights = new Uint8Array(res * res * SLOTS).fill(50)
	clearPalette(side, res, slots, weights, 4)
	for (let c = 0; c < side * side; c++) assert.equal(slots[c * SLOTS], 4)
	assert.equal(weights[0], 255)
	assert.equal(weights[1] + weights[2] + weights[3], 0)
})

test('a slot the chunk no longer paints is freed, and the others move down', () => {
	// One chunk of 2x2 texels: slot 0 is painted away, slots 1 and 2 hold the rest.
	const slots = new Uint8Array([5, 6, 7, NO_TEXTURE])
	const weights = new Uint8Array(4 * SLOTS)
	for (let t = 0; t < 4; t++) weights.set([0, 200, 55, 0], t * SLOTS)
	assert.equal(compactChunk(1, 2, slots, weights, 0), true)
	assert.deepEqual([...slots], [6, 7, NO_TEXTURE, NO_TEXTURE])
	for (let t = 0; t < 4; t++) assert.deepEqual([...weights.subarray(t * SLOTS, t * SLOTS + SLOTS)], [200, 55, 0, 0])
})

test('a chunk with every slot in use is left alone', () => {
	const slots = new Uint8Array([1, 2, NO_TEXTURE, NO_TEXTURE])
	const weights = new Uint8Array(4 * SLOTS)
	for (let t = 0; t < 4; t++) weights.set([100, 155, 0, 0], t * SLOTS)
	assert.equal(compactChunk(1, 2, slots, weights, 0), false)
	assert.deepEqual([...slots], [1, 2, NO_TEXTURE, NO_TEXTURE])
})

test('acquiring a slot in a full chunk frees the textures a stroke has emptied', () => {
	// One chunk: slot 0 is in use, slots 1 to 3 hold textures with no weight left.
	const slots = new Uint8Array([5, 6, 7, 8])
	const weights = new Uint8Array(2 * 2 * SLOTS)
	weights[0] = 255
	assert.equal(acquireSlotCompacting(1, 2, slots, weights, 0, 9), 1)
	assert.deepEqual([...slots], [5, 9, NO_TEXTURE, NO_TEXTURE])
	assert.deepEqual([...weights.slice(0, SLOTS)], [255, 0, 0, 0])
})

test('acquiring a slot in a chunk that really uses four textures still fails', () => {
	const slots = new Uint8Array([5, 6, 7, 8])
	const weights = new Uint8Array(2 * 2 * SLOTS)
	for (let k = 0; k < SLOTS; k++) weights[k * SLOTS + k] = 255
	assert.equal(acquireSlotCompacting(1, 2, slots, weights, 0, 9), -1)
	assert.deepEqual([...slots], [5, 6, 7, 8])
})

test('a chunk lists its textures in slot order with their share of the chunk', () => {
	// One chunk of 1 x 1 texels: the texture shares are the weights over 255.
	const slots = new Uint8Array([4, 7, NO_TEXTURE, NO_TEXTURE])
	const weights = new Uint8Array([64, 191, 0, 0])
	assert.deepEqual(chunkTextures(1, 1, slots, weights, 0, 8), [
		{ slot: 0, tex: 4, share: 64 / 255 },
		{ slot: 1, tex: 7, share: 191 / 255 },
	])
})

test('a chunk leaves out textures past the palette', () => {
	const slots = new Uint8Array([4, 9, NO_TEXTURE, NO_TEXTURE])
	const weights = new Uint8Array([255, 0, 0, 0])
	assert.deepEqual(chunkTextures(1, 1, slots, weights, 0, 8), [{ slot: 0, tex: 4, share: 1 }])
})

test('painting a fifth texture into a full chunk replaces the weakest and keeps every texel at 255', () => {
	// One chunk, 2 x 2 texels: textures 5 to 8 fill the slots, and texture 8 (slot 3) covers the least.
	const slots = new Uint8Array([5, 6, 7, 8])
	const weights = new Uint8Array(2 * 2 * SLOTS)
	weights.set([255, 0, 0, 0], 0)
	weights.set([0, 255, 0, 0], SLOTS)
	weights.set([0, 0, 255, 0], 2 * SLOTS)
	weights.set([100, 0, 0, 155], 3 * SLOTS)
	assert.equal(acquireSlotReplacing(1, 2, slots, weights, 0, 9), 3)
	assert.deepEqual([...slots], [5, 6, 7, 9])
	// The evicted texture's weight went to the texel's strongest other texture, so no texel lost paint.
	assert.deepEqual([...weights.slice(3 * SLOTS, 4 * SLOTS)], [255, 0, 0, 0])
	for (let t = 0; t < 4; t++) assert.equal(weights[t * SLOTS] + weights[t * SLOTS + 1] + weights[t * SLOTS + 2] + weights[t * SLOTS + 3], 255)
})

test("removing a chunk texture gives its weight to each texel's strongest other texture, and the last one leaves the chunk empty", () => {
	// One chunk of 2x2 texels with three textures.
	const slots = new Uint8Array([5, 6, 7, NO_TEXTURE])
	const weights = new Uint8Array([100, 155, 0, 0, 0, 55, 200, 0, 255, 0, 0, 0, 85, 85, 85, 0])
	removeSlot(1, 2, slots, weights, 0, 1)
	assert.deepEqual([...slots], [5, 7, NO_TEXTURE, NO_TEXTURE], 'slot 6 is gone and 7 moved down')
	assert.deepEqual([...weights], [255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 170, 85, 0, 0])
	removeSlot(1, 2, slots, weights, 0, 1)
	removeSlot(1, 2, slots, weights, 0, 0)
	assert.deepEqual([...slots], [NO_TEXTURE, NO_TEXTURE, NO_TEXTURE, NO_TEXTURE], 'the chunk is empty')
	for (let t = 0; t < 4; t++) assert.equal(weights[t * SLOTS] + weights[t * SLOTS + 1] + weights[t * SLOTS + 2] + weights[t * SLOTS + 3], 255)
	assert.equal(acquireSlot(slots, 0, 9), 0, 'an empty chunk takes a texture again')
})

test('replacing a chunk texture renames its slot, or folds into one the chunk already has', () => {
	const slots = new Uint8Array([5, 6, NO_TEXTURE, NO_TEXTURE])
	const weights = new Uint8Array([100, 155, 0, 0])
	replaceInChunk(1, 1, slots, weights, 0, 1, 9)
	assert.deepEqual([...slots], [5, 9, NO_TEXTURE, NO_TEXTURE])
	assert.deepEqual([...weights], [100, 155, 0, 0])
	replaceInChunk(1, 1, slots, weights, 0, 1, 5)
	assert.deepEqual([...slots], [5, NO_TEXTURE, NO_TEXTURE, NO_TEXTURE])
	assert.deepEqual([...weights], [255, 0, 0, 0])
})

test('hasEmptySlot finds a layer with no weight, and not a chunk that is all used or all empty', () => {
	// One chunk of 2x2 texels: slot 0 everywhere, slot 1 named but never painted.
	const slots = new Uint8Array([3, 5, NO_TEXTURE, NO_TEXTURE])
	const weights = new Uint8Array(4 * SLOTS)
	for (let i = 0; i < 4; i++) weights[i * SLOTS] = 255
	assert.equal(hasEmptySlot(1, 2, slots, weights, 0), true)
	weights[0 * SLOTS] = 200
	weights[0 * SLOTS + 1] = 55
	assert.equal(hasEmptySlot(1, 2, slots, weights, 0), false)
	assert.equal(hasEmptySlot(1, 2, slots, new Uint8Array(4 * SLOTS), 0), false)
})

test('a chunk drops its painted layers fainter than the threshold everywhere, never the base', async () => {
	const { dropFaintLayers, faintSlot, NO_TEXTURE: NONE } = await import('../src/lib/terrain/chunkPaint.ts')
	// One chunk of 4x4 texels: base 0, a strong layer 1 in one texel, a faint layer 2 everywhere.
	const side = 1,
		res = 4
	const slots = Uint8Array.from([0, 1, 2, NONE])
	const weights = new Uint8Array(res * res * 4)
	for (let t = 0; t < res * res; t++) {
		weights[t * 4] = 235
		weights[t * 4 + 2] = 20
	}
	weights[0] = 35
	weights[1] = 200
	assert.equal(faintSlot(side, res, slots, weights, 0, 26), 2, 'layer 2 peaks at 20 of 255, under 10%')
	assert.equal(dropFaintLayers(side, res, slots, weights, 0, 26), 1)
	assert.ok(!slots.includes(2), 'its slot is free')
	for (let t = 0; t < res * res; t++) {
		const sum = weights[t * 4] + weights[t * 4 + 1] + weights[t * 4 + 2] + weights[t * 4 + 3]
		assert.equal(sum, 255, `texel ${t} still sums to 255`)
	}
	assert.equal(dropFaintLayers(side, res, slots, weights, 0, 255), 1, 'at 100% the strong layer goes too, the base stays')
	assert.equal(slots[0], 0)
})

test('duplicate textures in a chunk merge into the first slot', async () => {
	const { mergeDuplicateSlots, NO_TEXTURE: NONE } = await import('../src/lib/terrain/chunkPaint.ts')
	const side = 1,
		res = 2
	const slots = Uint8Array.from([5, 7, 5, NONE])
	const weights = Uint8Array.from([100, 55, 100, 0, 255, 0, 0, 0, 0, 0, 255, 0, 50, 50, 155, 0])
	assert.equal(mergeDuplicateSlots(side, res, slots, weights, 0), 1)
	assert.deepEqual([...slots], [5, 7, NONE, NONE])
	assert.deepEqual([...weights], [200, 55, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 205, 50, 0, 0])
	assert.equal(mergeDuplicateSlots(side, res, slots, weights, 0), 0, 'nothing left to merge')
})
