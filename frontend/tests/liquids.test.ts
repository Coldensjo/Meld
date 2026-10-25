// Run with: bun test tests/liquids.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { LiquidMap, OCEAN_OPACITY, RIVER_OPACITY, cropLiquids, decodeLiquids, encodeLiquids, liquidsFromAdt, liquidsToAdt, paintLiquid, raycastLiquids, regenOpacity, type LiquidBrush } from '../src/lib/water/liquids.ts'
import { LiquidStroke } from '../src/lib/water/liquidStroke.ts'

/** A flat map of `cells` cells a side, 1 yard a cell, with the ground at `h`. */
function ground(cells: number, h = -2) {
	const verts = cells + 1
	return { size: cells, verts, cellSize: 1, heights: new Float32Array(verts * verts).fill(h) }
}

function brush(over: Partial<LiquidBrush>): LiquidBrush {
	return {
		x: 4,
		y: 0,
		z: 4,
		radius: 1.5,
		id: 1,
		add: true,
		angle: 0,
		orientation: 0,
		lock: true,
		origin: { x: 0, y: 5, z: 0 },
		overrideHeight: true,
		overrideId: true,
		opacity: RIVER_OPACITY,
		...over,
	}
}

const covered = (m: LiquidMap, c: number) => m.layers(c).reduce((n, l) => n + l.cells.reduce((a, b) => a + b, 0), 0)

test('a dab covers the cells it reaches, at the locked height, with depth from the ground', () => {
	const g = ground(16)
	const m = new LiquidMap(16)
	paintLiquid(m, g, brush({}))
	const [l] = m.layers(0)
	assert.equal(l.id, 1)
	// Cells whose square lies within 1.5 of (4, 4): columns and rows 2 to 5 around it, less the far corners.
	assert.equal(l.cells[4 * 8 + 4], 1)
	assert.equal(l.cells[0], 0)
	assert.equal(l.heights[4 * 9 + 4], 5)
	// (5 - (-2) + 1) * 0.0337
	assert.ok(Math.abs(l.depth[4 * 9 + 4] - 8 * RIVER_OPACITY) < 1e-6)
	assert.ok(m.dirty.has(0))
})

test('a dab reaches every chunk under it', () => {
	const m = new LiquidMap(16)
	paintLiquid(m, ground(16), brush({ x: 8, z: 8, radius: 2 }))
	for (const c of [0, 1, 2, 3]) assert.ok(covered(m, c) > 0, `chunk ${c}`)
})

test('removing clears the cells, and an empty chunk keeps no layer', () => {
	const g = ground(16)
	const m = new LiquidMap(16)
	paintLiquid(m, g, brush({}))
	paintLiquid(m, g, brush({ add: false, radius: 6 }))
	assert.equal(m.layers(0).length, 0)
	assert.ok(m.empty)
})

test('unlocked, the surface is at the cursor; angled, it rises toward the orientation', () => {
	const g = ground(16)
	const m = new LiquidMap(16)
	paintLiquid(m, g, brush({ lock: false, y: 2, angle: Math.PI / 4, orientation: 0, radius: 3 }))
	const [l] = m.layers(0)
	// tan(45°) = 1: one yard up per yard east of the cursor at x = 4.
	assert.ok(Math.abs(l.heights[4 * 9 + 4] - 2) < 1e-5)
	assert.ok(Math.abs(l.heights[4 * 9 + 6] - 4) < 1e-5)
	assert.ok(Math.abs(l.heights[6 * 9 + 4] - 2) < 1e-5)
})

test('without override height, water already there keeps its height', () => {
	const g = ground(16)
	const m = new LiquidMap(16)
	paintLiquid(m, g, brush({}))
	paintLiquid(m, g, brush({ origin: { x: 0, y: 9, z: 0 }, overrideHeight: false }))
	assert.equal(m.layers(0)[0].heights[4 * 9 + 4], 5)
	paintLiquid(m, g, brush({ origin: { x: 0, y: 9, z: 0 } }))
	assert.equal(m.layers(0)[0].heights[4 * 9 + 4], 9)
})

test('painting another liquid takes the cells under the brush from the one there', () => {
	const g = ground(16)
	const m = new LiquidMap(16)
	paintLiquid(m, g, brush({ radius: 4 }))
	paintLiquid(m, g, brush({ id: 3, radius: 1 }))
	const layers = m.layers(0)
	assert.deepEqual(layers.map((l) => l.id).sort(), [1, 3])
	const water = layers.find((l) => l.id === 1)!
	const lava = layers.find((l) => l.id === 3)!
	assert.equal(water.cells[4 * 8 + 4], 0)
	assert.equal(lava.cells[4 * 8 + 4], 1)
})

test('crop removes the cells under the ground', () => {
	const g = ground(16)
	const m = new LiquidMap(16)
	paintLiquid(m, g, brush({ radius: 3 }))
	// Raise the ground of the chunk's west half over the water.
	for (let z = 0; z <= 16; z++) for (let x = 0; x <= 4; x++) g.heights[z * 17 + x] = 10
	const changed = cropLiquids(m, g)
	assert.deepEqual(changed, [0])
	const [l] = m.layers(0)
	assert.equal(l.cells[4 * 8 + 3], 0)
	assert.equal(l.cells[4 * 8 + 4], 1)
})

test("regenerating the opacity uses each liquid's own factor in auto", () => {
	const g = ground(16)
	const m = new LiquidMap(16)
	paintLiquid(m, g, brush({ id: 2, opacity: 0.5 }))
	regenOpacity(m, g, null)
	assert.ok(Math.abs(m.layers(0)[0].depth[4 * 9 + 4] - 8 * OCEAN_OPACITY) < 1e-6)
})

test('a stroke undoes and redoes the chunks it changed, and records nothing when nothing changed', () => {
	const g = ground(16)
	const m = new LiquidMap(16)
	const s = new LiquidStroke(m, 'Paint water')
	paintLiquid(m, g, brush({}), s.reserve)
	const cmd = s.finish()!
	assert.ok(cmd)
	cmd.undo()
	assert.ok(m.empty)
	cmd.redo()
	assert.ok(covered(m, 0) > 0)
	const again = new LiquidStroke(m, 'Paint water')
	paintLiquid(m, g, brush({}), again.reserve)
	assert.equal(again.finish(), null)
})

test('the map file blob round-trips', () => {
	const g = ground(32)
	const m = new LiquidMap(32)
	paintLiquid(m, g, brush({ x: 20, z: 12, radius: 5, angle: 0.2, orientation: 1 }))
	paintLiquid(m, g, brush({ id: 4 }))
	const back = new LiquidMap(32)
	decodeLiquids(back, encodeLiquids(m))
	for (let c = 0; c < 16; c++) {
		const a = m.layers(c)
		const b = back.layers(c)
		assert.equal(a.length, b.length)
		a.forEach((l, i) => {
			assert.equal(l.id, b[i].id)
			assert.deepEqual(Array.from(l.cells), Array.from(b[i].cells))
			assert.deepEqual(Array.from(l.heights), Array.from(b[i].heights))
			l.depth.forEach((d, k) => assert.ok(Math.abs(d - b[i].depth[k]) <= 0.5 / 255))
		})
	}
})

test("the Go side's layers place by chunk, in a block or a tile of it", () => {
	const g = ground(32)
	const m = new LiquidMap(32)
	paintLiquid(m, g, brush({ x: 28, z: 20, radius: 1 }))
	const all = liquidsToAdt(m)
	assert.deepEqual(
		all.map((l) => [l.indexX, l.indexY]),
		[[3, 2]],
	)
	// The tile of 2x2 chunks starting at chunk (2, 2) has it at (1, 0).
	assert.deepEqual(
		liquidsToAdt(m, 2, 2, 2).map((l) => [l.indexX, l.indexY]),
		[[1, 0]],
	)
	const back = new LiquidMap(32)
	liquidsFromAdt(back, all)
	assert.equal(covered(back, 2 * 4 + 3), covered(m, 2 * 4 + 3))
})

test('a ray stops on the surface', () => {
	const m = new LiquidMap(16)
	paintLiquid(m, ground(16), brush({}))
	const ray = new THREE.Ray(new THREE.Vector3(4.2, 50, 4.3), new THREE.Vector3(0, -1, 0))
	const out = new THREE.Vector3()
	assert.ok(raycastLiquids(m, 1, ray, out))
	assert.ok(Math.abs(out.y - 5) < 1e-5)
	assert.equal(raycastLiquids(m, 1, new THREE.Ray(new THREE.Vector3(12, 50, 12), new THREE.Vector3(0, -1, 0)), out), false)
})
