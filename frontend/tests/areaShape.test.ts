// Run with: bun test tests/areaShape.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INSIDE, cellsInRect, combineArea, fillsRect, insideDistance, mirrorCells, rasterPolygon, rectCells, rotateCells, shapeBounds } from '../src/lib/terrain/areaShape.ts'
import type { MapClip } from '../src/lib/world/clipboard.ts'
import { mirrorClip, rotateClip } from '../src/lib/world/clipRotate.ts'
import { LiquidMap, LIQUID_CELLS, newLayer, pasteLiquidCells } from '../src/lib/water/liquids.ts'
import { SLOTS, SPLAT_PER_CELL } from '../src/lib/terrain/chunkPaint.ts'

const count = (c: Uint8Array) => c.reduce((n, v) => n + (v ? 1 : 0), 0)

test('a polygon takes the cells whose centres are inside it', () => {
	const size = 16
	const out = new Uint8Array(size * size)
	// A square from (2, 2) to (10, 6) in world units, cells of 2: cells 1..4 by 1..2.
	assert.equal(rasterPolygon([2, 2, 10, 2, 10, 6, 2, 6], 2, size, out), 8)
	assert.deepEqual(shapeBounds(out, size), { x0: 1, z0: 1, x1: 5, z1: 3 })
	assert.equal(out[1 * size + 1], INSIDE)
	assert.equal(out[1 * size + 5], 0)
	// A right triangle over an 8 by 8 cell square: the half under the diagonal, centres on it left out.
	const n = rasterPolygon([0, 0, 16, 0, 0, 16], 2, size, out)
	assert.equal(n, 28)
	assert.equal(out[0 * size + 6], INSIDE)
	assert.equal(out[0 * size + 7], 0)
	assert.equal(out[7 * size + 0], 0)
	// Too few points, and a polygon off the map, take nothing.
	assert.equal(rasterPolygon([0, 0, 4, 4], 2, size, out), 0)
	assert.equal(rasterPolygon([-20, -20, -10, -20, -10, -10], 2, size, out), 0)
	assert.equal(shapeBounds(out, size), null)
})

test('a polygon that crosses itself fills by the even-odd rule', () => {
	const size = 8
	const out = new Uint8Array(size * size)
	// A bow tie: two triangles meeting in the middle.
	const n = rasterPolygon([0, 0, 16, 16, 16, 0, 0, 16], 2, size, out)
	assert.ok(n > 0)
	// A triangle on the left and one on the right, meeting in the middle; the top and bottom middles are out.
	assert.equal(out[4 * size + 0], INSIDE)
	assert.equal(out[4 * size + 7], INSIDE)
	assert.equal(out[1 * size + 0], INSIDE)
	assert.equal(out[0 * size + 3], 0)
	assert.equal(out[7 * size + 4], 0)
})

test('a rect fills its bounds; a shape with a gap does not', () => {
	const size = 8
	const r = { x0: 1, z0: 2, x1: 4, z1: 5 }
	const c = rectCells(r, size)
	assert.equal(count(c), 9)
	assert.ok(fillsRect(c, size, r))
	c[3 * size + 2] = 0
	assert.ok(!fillsRect(c, size, r))
	const local = cellsInRect(c, size, r)
	assert.deepEqual([...local], [1, 1, 1, 1, 0, 1, 1, 1, 1])
})

test('distance from the shape edge, half a cell for an edge cell', () => {
	// A 5 by 5 block: the centre is 2.5 cells from the edge, the rim 0.5.
	const inside = new Uint8Array(25).fill(1)
	const d = insideDistance(inside, 5, 5)
	assert.equal(d[0], 0.5)
	assert.equal(d[2 * 5 + 2], 2.5)
	assert.equal(d[1 * 5 + 2], 1.5)
	// A cell outside counts as an edge for its neighbours, and is 0 itself.
	inside[2 * 5 + 2] = 0
	const e = insideDistance(inside, 5, 5)
	assert.equal(e[2 * 5 + 2], 0)
	assert.equal(e[2 * 5 + 1], 0.5)
})

test('a clip turns and mirrors its shape with its cells', () => {
	const w = 3
	const h = 2
	const T = SPLAT_PER_CELL
	const clip: MapClip = {
		w,
		h,
		heights: new Float32Array((w + 1) * (h + 1)),
		holes: new Uint8Array(w * h),
		weights: new Uint8Array(w * T * h * T * SLOTS),
		slots: new Uint8Array(w * T * h * T * SLOTS),
		palette: [],
		objects: [],
		cells: Uint8Array.from([1, 0, 0, 1, 1, 0]),
	}
	clip.holes[1 * w + 0] = 1
	// The shape lands where the holes land, so the two keep matching.
	const r = rotateClip(clip, 2)
	assert.deepEqual([...r.cells!], [...rotateCells(clip.cells!, w, h)])
	assert.equal(r.cells![[...r.holes].indexOf(1)], 1)
	const m = mirrorClip(clip, 'x', 2)
	assert.deepEqual([...m.cells!], [...mirrorCells(clip.cells!, w, h, 'x')])
	assert.deepEqual([...m.cells!], [0, 0, 1, 0, 1, 1])
})

test('a liquid paste with a shape clears and lays only the shape', () => {
	const map = new LiquidMap(16)
	const l = newLayer(1, 5)
	l.cells.fill(1)
	map.set(0, [l])
	// Paste an empty 2 by 1 clip whose shape is its first cell only: that cell dries, the other keeps its water.
	pasteLiquidCells(map, { w: 2, h: 1, cells: [] }, 0, 0, undefined, Uint8Array.from([1, 0]))
	const after = map.layers(0)[0]
	assert.equal(after.cells[0], 0)
	assert.equal(after.cells[1], 1)
	assert.equal(after.cells[1 * LIQUID_CELLS], 1)
})

test('a rect adds to, takes from or replaces the area there is (#712)', () => {
	const size = 8
	const first = rectCells({ x0: 0, z0: 0, x1: 4, z1: 4 }, size)
	const second = rectCells({ x0: 2, z0: 2, x1: 6, z1: 6 }, size)
	// Shift: the union of two overlapping 4 by 4 rects, 16 + 16 - 4 cells, and no longer a plain rect.
	const union = combineArea(first, second, 'add')
	assert.equal(count(union), 28)
	assert.deepEqual(shapeBounds(union, size), { x0: 0, z0: 0, x1: 6, z1: 6 })
	assert.equal(fillsRect(union, size, { x0: 0, z0: 0, x1: 6, z1: 6 }), false)
	// Ctrl: a rect inside it cut out.
	const cut = combineArea(union, rectCells({ x0: 1, z0: 1, x1: 3, z1: 3 }, size), 'subtract')
	assert.equal(count(cut), 24)
	assert.equal(cut[1 * size + 1], 0)
	assert.equal(cut[0], INSIDE)
	// The inputs are left alone.
	assert.equal(count(first), 16)
	assert.equal(count(union), 28)
	// A plain drag replaces; adding to nothing is the rect; taking from nothing is nothing.
	assert.deepEqual(combineArea(union, second, 'replace'), second)
	assert.deepEqual(combineArea(null, second, 'add'), second)
	assert.equal(count(combineArea(null, second, 'subtract')), 0)
})
