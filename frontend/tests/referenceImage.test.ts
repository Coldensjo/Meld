// Run with: bun test tests/referenceImage.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	NONE,
	areasFromImage,
	colourIndices,
	dominantColours,
	dragCorner,
	dragTurn,
	fitPlace,
	heightsFromImage,
	maskFromImage,
	readReference,
	refCorners,
	refHit,
	refUV,
	texturesFromImage,
	type RefPixels,
} from '../src/lib/terrain/referenceImage.ts'
import { NO_TEXTURE, SLOTS } from '../src/lib/terrain/chunkPaint.ts'

/** A w x h image filled by `fn(x, y)` with [r, g, b, a]. */
function image(w: number, h: number, fn: (x: number, y: number) => number[]): RefPixels {
	const data = new Uint8ClampedArray(w * h * 4)
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4)
	return { w, h, data }
}

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

test('a fitted image covers the map by its longer side and keeps its shape', () => {
	assert.deepEqual(fitPlace(200, 100, 64), { x: 32, z: 32, w: 64, h: 32, turn: 0 })
	assert.deepEqual(fitPlace(100, 200, 64), { x: 32, z: 32, w: 32, h: 64, turn: 0 })
})

test('the image frame: row 0 at the top (-z), turned about the centre', () => {
	const uv = [0, 0]
	refUV({ x: 10, z: 10, w: 4, h: 2, turn: 0 }, 8, 9, uv)
	assert.deepEqual(uv, [0, 0])
	// A quarter turn: the image's width now runs along +z.
	refUV({ x: 0, z: 0, w: 4, h: 2, turn: Math.PI / 2 }, 0, 2, uv)
	assert.ok(near(uv[0], 1) && near(uv[1], 0.5))
	const [tl, tr] = refCorners({ x: 0, z: 0, w: 4, h: 2, turn: Math.PI / 2 })
	assert.ok(near(tl[0], 1) && near(tl[1], -2) && near(tr[0], 1) && near(tr[1], 2))
})

test('a press takes a corner near it, the image inside it, nothing outside', () => {
	const p = { x: 10, z: 10, w: 10, h: 10, turn: 0 }
	assert.equal(refHit(p, 5.5, 5.5, 1), 0)
	assert.equal(refHit(p, 15, 15.4, 1), 2)
	assert.equal(refHit(p, 10, 12, 1), 'inside')
	assert.equal(refHit(p, 30, 10, 1), null)
})

test('dragging a corner keeps the opposite one, and the shape unless freed', () => {
	const p = { x: 10, z: 10, w: 10, h: 5, turn: 0.3 }
	const fixed = refCorners(p)[0]
	// The bottom-right corner dragged out along the diagonal to twice the size.
	const far = refCorners({ ...p, x: p.x + (refCorners(p)[2][0] - fixed[0]) / 2, z: p.z + (refCorners(p)[2][1] - fixed[1]) / 2, w: 20, h: 10 })[2]
	const q = dragCorner(p, 2, far[0], far[1], true)
	assert.ok(near(q.w, 20, 1e-6) && near(q.h, 10, 1e-6) && q.turn === p.turn)
	const kept = refCorners(q)[0]
	assert.ok(near(kept[0], fixed[0], 1e-6) && near(kept[1], fixed[1], 1e-6))
	// Freed: the top-right corner dragged along the width alone only widens it, from the bottom-left one.
	const r = dragCorner({ x: 5, z: 5, w: 10, h: 10, turn: 0 }, 1, 14, 0, false)
	assert.deepEqual(r, { x: 7, z: 5, w: 14, h: 10, turn: 0 })
	// Past the fixed corner it stops at the smallest size, never turns inside out.
	assert.ok(dragCorner({ x: 5, z: 5, w: 10, h: 10, turn: 0 }, 2, -20, -20, false).w >= 1)
})

test('turning follows the angle the pointer swept about the centre', () => {
	const q = dragTurn({ x: 0, z: 0, w: 2, h: 2, turn: 0 }, 1, 0, 0, 1)
	assert.ok(near(q.turn, Math.PI / 2))
})

test('the dominant colours ignore the antialiased edge between two flat colours', () => {
	// Red on the left (the larger), blue on the right, a column of purple between them.
	const px = image(21, 10, (x) => (x < 12 ? [255, 0, 0, 255] : x === 12 ? [128, 0, 128, 255] : [0, 0, 255, 255]))
	const cols = dominantColours(px, 12, 0.06)
	assert.equal(cols.length, 2)
	assert.deepEqual([cols[0].r, cols[0].b], [255, 0])
	assert.deepEqual([cols[1].r, cols[1].b], [0, 255])
	const idx = colourIndices(px, cols, 40)
	assert.equal(idx[0], 0)
	assert.equal(idx[20], 1)
	assert.equal(idx[12], NONE)
})

test('transparent pixels are no colour and keep their heights', () => {
	const px = image(2, 1, (x) => (x === 0 ? [255, 255, 255, 255] : [255, 255, 255, 0]))
	assert.equal(dominantColours(px)[0].share, 1)
	assert.equal(colourIndices(px, [{ r: 255, g: 255, b: 255, share: 1 }], 10)[1], NONE)
})

test('brightness becomes heights under the image, the rest keeps its own', () => {
	// A 2x2 map of cells 1 wide (3x3 vertices); a white image over its left half and a little more.
	const heights = new Float32Array(9).fill(5)
	const px = image(4, 4, () => [255, 255, 255, 255])
	const { next, count } = heightsFromImage(heights, 3, 1, px, { x: 0.5, z: 1, w: 1.2, h: 2.2, turn: 0 }, 0, 10, 'set')
	assert.equal(count, 6)
	assert.deepEqual([...next], [10, 10, 5, 10, 10, 5, 10, 10, 5])
	const add = heightsFromImage(
		heights,
		3,
		1,
		image(1, 1, () => [0, 0, 0, 255]),
		{ x: 1, z: 1, w: 4, h: 4, turn: 0 },
		2,
		10,
		'add',
	)
	assert.ok(add.next.every((h) => h === 7))
})

test('each chunk takes the zone most of it is painted in', () => {
	// Two chunks a side, 10 units each; the image's left two thirds red (zone 12), the rest green (zone 40).
	const px = image(3, 1, (x) => (x < 2 ? [255, 0, 0, 255] : [0, 255, 0, 255]))
	const cols = [
		{ r: 255, g: 0, b: 0, share: 0 },
		{ r: 0, g: 255, b: 0, share: 0 },
	]
	const areas = new Uint32Array(4).fill(1)
	const n = areasFromImage(areas, 2, 10, colourIndices(px, cols, 10), px, { x: 10, z: 10, w: 20, h: 20, turn: 0 }, [12, 40])
	assert.equal(n, 4)
	// The right chunk (x 10 to 20) is red only to 13.3: one sample in four, so green wins.
	assert.deepEqual([...areas], [12, 40, 12, 40])
	// A colour with no zone leaves the chunks it covers alone.
	const kept = new Uint32Array(4).fill(1)
	assert.equal(areasFromImage(kept, 2, 10, colourIndices(px, cols, 10), px, { x: 10, z: 10, w: 20, h: 20, turn: 0 }, [0, 40]), 2)
	assert.deepEqual([...kept], [1, 40, 1, 40])
})

test('a chosen colour adds its texels to the mask', () => {
	const px = image(2, 2, (x, y) => (x === 0 && y === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]))
	const cols = [
		{ r: 0, g: 0, b: 0, share: 0 },
		{ r: 255, g: 255, b: 255, share: 0 },
	]
	const mask = new Uint8Array(16)
	const r = maskFromImage(mask, 4, 1, colourIndices(px, cols, 10), px, { x: 2, z: 2, w: 4, h: 4, turn: 0 }, [true, false])
	assert.equal(r.count, 4)
	assert.deepEqual(r.rect, { x0: 0, z0: 0, x1: 1, z1: 1 })
	assert.deepEqual([...mask.slice(0, 4)], [255, 255, 0, 0])
})

test('textures paint whole texels, keep the slots the rest still use, and refuse a fifth', () => {
	// One chunk of 4x4 texels holding texture 9 in slot 0 everywhere.
	const res = 4
	const weights = new Uint8Array(res * res * SLOTS)
	for (let i = 0; i < res * res; i++) weights[i * SLOTS] = 255
	const slots = Uint8Array.from([9, NO_TEXTURE, NO_TEXTURE, NO_TEXTURE])
	// The image's left half is colour 0 (texture 3), the rest no colour.
	const px = image(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 0, 0]))
	const cols = [{ r: 255, g: 0, b: 0, share: 0 }]
	const r = texturesFromImage(weights, slots, res, 1, 1, colourIndices(px, cols, 10), px, { x: 2, z: 2, w: 4, h: 4, turn: 0 }, [3])
	assert.equal(r.painted, 8)
	assert.equal(r.refused, 0)
	assert.deepEqual([...slots], [9, 3, NO_TEXTURE, NO_TEXTURE])
	assert.deepEqual([...weights.slice(0, SLOTS)], [0, 255, 0, 0])
	assert.deepEqual([...weights.slice(2 * SLOTS, 3 * SLOTS)], [255, 0, 0, 0])
	// Covered whole by five colours in a full chunk: the most used get slots, but a refused colour's
	// texels keep their old texture, which keeps its slot, so two colours are refused.
	const w2 = new Uint8Array(res * res * SLOTS)
	for (let i = 0; i < res * res; i++) w2[i * SLOTS] = 255
	const s2 = Uint8Array.from([9, 8, 7, 6])
	const five = image(4, 4, (x, y) => (y < 2 ? [x * 60, 0, 0, 255] : [240, 0, 0, 255]))
	const c5 = [0, 60, 120, 180, 240].map((v) => ({ r: v, g: 0, b: 0, share: 0 }))
	const r2 = texturesFromImage(w2, s2, res, 1, 1, colourIndices(five, c5, 5), five, { x: 2, z: 2, w: 4, h: 4, turn: 0 }, [10, 11, 12, 13, 14])
	assert.equal(r2.refused, 4)
	assert.equal(r2.painted, 12)
	assert.deepEqual(
		[...s2].sort((a, b) => a - b),
		[9, 10, 11, 14],
	)
})

test('a map file record is read back, and a broken one is dropped', () => {
	assert.equal(readReference(null), null)
	assert.equal(readReference({ path: '', w: 5, h: 5 }), null)
	assert.equal(readReference({ path: 'a.png', w: 0, h: 5 }), null)
	assert.deepEqual(readReference({ path: 'a.png', w: 5, h: 6, opacity: 3, mode: 'x' }), { path: 'a.png', mode: 'ground', opacity: 1, shown: true, x: 0, z: 0, w: 5, h: 6, turn: 0 })
})
