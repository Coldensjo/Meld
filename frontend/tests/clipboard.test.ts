// Run with: bun test tests/clipboard.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { MapClip } from '../src/lib/world/clipboard.ts'
import { mirrorClip, rotateClip } from '../src/lib/world/clipRotate.ts'
import { placementEuler } from '../src/lib/world/placement.ts'
import { pastedHeight } from '../src/lib/world/pasteHeight.ts'
import { LiquidMap, copyLiquidCells, pasteLiquidCells, rotateLiquidClip, newLayer, LIQUID_CELLS } from '../src/lib/water/liquids.ts'
import { NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../src/lib/terrain/chunkPaint.ts'

/** A 3 by 2 clip whose heights count up by vertex, with one hole, one painted texel and one model. */
function clip(): MapClip {
	const w = 3
	const h = 2
	const heights = Float32Array.from({ length: (w + 1) * (h + 1) }, (_, i) => i)
	const holes = new Uint8Array(w * h)
	holes[1 * w + 2] = 1 // cell (2, 1)
	const T = SPLAT_PER_CELL
	const weights = new Uint8Array(w * T * h * T * SLOTS)
	const slots = new Uint8Array(weights.length).fill(NO_TEXTURE)
	const texel = (0 * w * T + 1) * SLOTS // texel (1, 0)
	slots[texel] = 0
	weights[texel] = 255
	return { w, h, heights, holes, weights, slots, palette: ['Tileset\\A.blp'], objects: [{ type: 'm2:a', cid: 1, x: 1, z: 0.5, yOff: 0, rotY: 0, scale: 1 }] }
}

test('a quarter turn moves every part of the clip the same way and swaps its sides', () => {
	const c = clip()
	const r = rotateClip(c, 2)
	assert.equal(r.w, 2)
	assert.equal(r.h, 3)
	// Vertex (x, z) lands at (z, w - x): the corner (3, 0) at (0, 0), (0, 0) at (0, 3).
	assert.equal(r.heights[0 * (r.w + 1) + 0], c.heights[0 * (c.w + 1) + 3])
	assert.equal(r.heights[3 * (r.w + 1) + 0], c.heights[0])
	// Cell (2, 1) lands at (1, 0).
	assert.equal(r.holes[0 * r.w + 1], 1)
	assert.equal(
		r.holes.reduce((a, b) => a + b, 0),
		1,
	)
	// Texel (1, 0) of a 12 by 8 texel grid lands at (0, 10).
	const T = SPLAT_PER_CELL
	assert.equal(r.weights[(10 * r.w * T + 0) * SLOTS], 255)
	assert.equal(r.slots[(10 * r.w * T + 0) * SLOTS], 0)
	// The model at (1, 0.5) of a 6-unit-wide clip lands at (0.5, 5) and turns a quarter turn.
	assert.deepEqual([r.objects[0].x, r.objects[0].z, r.objects[0].rotY], [0.5, 5, Math.PI / 2])
	// Four turns bring it back.
	const back = rotateClip(rotateClip(rotateClip(r, 2), 2), 2)
	assert.deepEqual([...back.heights], [...c.heights])
	assert.deepEqual([...back.holes], [...c.holes])
	assert.ok(Math.abs(back.objects[0].x - 1) < 1e-9 && Math.abs(back.objects[0].z - 0.5) < 1e-9)
})

test('liquid cells copy, paste anywhere, and turn with the clip', () => {
	const map = new LiquidMap(16)
	const l = newLayer(2, 5)
	l.cells[0 * LIQUID_CELLS + 1] = 1 // cell (1, 0)
	l.heights[1] = 6 // the (1,0) corner of that cell
	map.set(0, [l])
	const c = copyLiquidCells(map, { x0: 0, z0: 0, x1: 3, z1: 2 })
	assert.equal(c.cells.length, 1)
	assert.deepEqual([c.cells[0].x, c.cells[0].z, c.cells[0].id], [1, 0, 2])
	assert.deepEqual(c.cells[0].heights, [6, 5, 5, 5])
	// Pasted at (9, 9): the cell lands at (10, 9) of chunk (1, 1), and what that chunk held under the rect goes.
	const other = newLayer(1, 1)
	other.cells.fill(1)
	map.set(1 * 2 + 1, [other])
	const reserved: number[] = []
	pasteLiquidCells(map, c, 9, 9, (ch) => reserved.push(ch))
	const layers = map.layers(3)
	assert.ok(reserved.includes(3))
	const water = layers.find((t) => t.id === 1)!
	assert.equal(water.cells[(9 % 8) * 8 + (9 % 8)], 0, 'the rect cleared the cell it covers')
	assert.equal(water.cells[0], 1, 'a cell outside the rect keeps its liquid')
	const ocean = layers.find((t) => t.id === 2)!
	assert.equal(ocean.cells[(9 % 8) * 8 + (10 % 8)], 1)
	assert.equal(ocean.heights[(9 % 8) * 9 + (10 % 8)], 6)
	// The turn: cell (1, 0) of a 3-wide clip lands at (0, 1), its (1,0) corner at (0,0).
	const r = rotateLiquidClip(c)
	assert.deepEqual([r.w, r.h, r.cells[0].x, r.cells[0].z], [2, 3, 0, 1])
	assert.deepEqual(r.cells[0].heights, [5, 5, 6, 5])
})

test('pasted heights: replace, raise only, lower only, and bumps added or subtracted', () => {
	// Ground at 10; a clip vertex at 7 on a clip whose lowest point is 5; offset 1.
	assert.equal(pastedHeight('set', 10, 7, 5, 1), 8)
	assert.equal(pastedHeight('max', 10, 7, 5, 1), 10)
	assert.equal(pastedHeight('max', 6, 7, 5, 1), 8)
	assert.equal(pastedHeight('min', 10, 7, 5, 1), 8)
	assert.equal(pastedHeight('add', 10, 7, 5, 1), 13)
	assert.equal(pastedHeight('subtract', 10, 7, 5, 1), 9)
})

test('a mirror flips every part of the clip across its middle and turns its models to face the mirrored way', () => {
	const c = clip()
	c.objects[0].rotY = 0.3
	c.objects[0].tiltX = 0.1
	c.objects[0].tiltZ = 0.2
	c.liquids = { w: 3, h: 2, cells: [{ x: 0, z: 1, id: 1, heights: [1, 2, 3, 4], depth: [0, 0, 0, 0] }] }
	const m = mirrorClip(c, 'x', 2)
	assert.equal(m.w, 3)
	// Vertex (x, z) lands at (w - x, z); cell (2, 1) at (0, 1); texel (1, 0) of 12 at (10, 0).
	assert.equal(m.heights[0 * 4 + 3], c.heights[0])
	assert.equal(m.holes[1 * 3 + 0], 1)
	const T = SPLAT_PER_CELL
	assert.equal(m.weights[(0 * 3 * T + 10) * SLOTS], 255)
	// The model at x 1 of a 6-wide clip stands at 5, facing pi - yaw, leaning forward the same and
	// rolling the other way, so its up axis is the original's mirrored.
	assert.equal(m.objects[0].x, 5)
	assert.ok(Math.abs(m.objects[0].rotY - (Math.PI - 0.3)) < 1e-9)
	assert.equal(m.objects[0].tiltX, 0.1)
	assert.equal(m.objects[0].tiltZ, -0.2)
	const up = (o: { rotY: number; tiltX?: number; tiltZ?: number }) => new THREE.Vector3(0, 1, 0).applyEuler(placementEuler(new THREE.Euler(), o.rotY, o.tiltX, o.tiltZ))
	const was = up(c.objects[0])
	const now = up(m.objects[0])
	assert.ok(now.distanceTo(new THREE.Vector3(-was.x, was.y, was.z)) < 1e-9)
	// The liquid cell (0, 1) lands at (2, 1) with its corners swapped east to west.
	assert.deepEqual(m.liquids!.cells[0], { x: 2, z: 1, id: 1, heights: [2, 1, 4, 3], depth: [0, 0, 0, 0] })
	// North to south: cell (2, 1) lands at (2, 0), the model at z 0.5 of a 4-deep clip at 3.5 facing -yaw.
	const n = mirrorClip(c, 'z', 2)
	assert.equal(n.holes[0 * 3 + 2], 1)
	assert.equal(n.objects[0].z, 3.5)
	assert.ok(Math.abs(n.objects[0].rotY + 0.3) < 1e-9)
	// Mirrored twice, the clip is the same.
	assert.deepEqual([...mirrorClip(m, 'x', 2).heights], [...c.heights])
})
