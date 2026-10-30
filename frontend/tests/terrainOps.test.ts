// Run with: bun test tests/terrainOps.test.ts
// The terrain batch operations (engine/terrainOps.ts, #559) on a small real Terrain: each edits the map
// as one undo step, and undo puts every byte back.
import './runes.ts'
import { expect, test } from 'bun:test'
import { History } from '../src/lib/state/historyCore.ts'
import { Terrain } from '../src/lib/terrain/Terrain.ts'
import { NO_TEXTURE, SLOTS } from '../src/lib/terrain/chunkPaint.ts'
import { INSIDE } from '../src/lib/terrain/areaShape.ts'
import { SHADOW_PER_CELL } from '../src/lib/terrain/bakedShadows.ts'
import { TILE_CELLS, TILE_CHUNKS } from '../src/lib/wow/format.ts'
import type { WorldObject } from '../src/lib/world/ObjectLayer.ts'

const { ObjectLayer } = await import('../src/lib/world/ObjectLayer.ts')
const ops = await import('../src/lib/engine/terrainOps.ts')

/** The map's side in cells (4 paint chunks a side) and a cell's size in yards. */
const SIZE = 32
const CELL = 2
const CUBE = 'helper:cube:4'

/**
 * A gently rolling map with two textures in every chunk (the second on the chunk's first texel only,
 * since a stroke frees the layers left empty), an empty mask and no models.
 */
function world(size = SIZE) {
	const t = new Terrain(size, CELL)
	const V = t.verts
	for (let z = 0; z < V; z++) for (let x = 0; x < V; x++) t.heights[z * V + x] = 10 + Math.sin(x * 0.3) + Math.cos(z * 0.2)
	const side = t.paintChunksPerSide
	const per = t.splatRes / side
	for (let c = 0; c < side * side; c++) {
		t.chunkSlots[c * SLOTS + 1] = 1
		const p = (Math.floor(c / side) * per * t.splatRes + (c % side) * per) * SLOTS
		t.weights[p] = 0
		t.weights[p + 1] = 255
	}
	const objects = new ObjectLayer(t)
	const history = new History({ dirty() {}, sync() {} })
	return { t, objects, history }
}

/** Everything the operations may change, copied. */
function snapshot(t: Terrain) {
	return { heights: t.heights.slice(), weights: t.weights.slice(), chunkSlots: t.chunkSlots.slice(), mask: t.mask.slice(), holes: t.holes.slice(), shadow: t.shadow?.slice() ?? null }
}

/** Undoes the last step and checks that the map is back to `before`, then redoes it. */
function undoRestores(t: Terrain, history: History, before: ReturnType<typeof snapshot>) {
	const after = snapshot(t)
	history.undo()
	expect(snapshot(t)).toEqual(before)
	history.redo()
	expect(snapshot(t)).toEqual(after)
}

test('maskBounds and maskCells find the set texels, and null for an empty mask', () => {
	const { t } = world()
	expect(ops.maskBounds(t)).toBeNull()
	expect(ops.maskCells(t)).toBeNull()
	const R = t.splatRes
	t.mask[5 * R + 9] = 10
	t.mask[20 * R + 3] = 255
	expect(ops.maskBounds(t)).toEqual({ x0: 3, z0: 5, x1: 9, z1: 20 })
	// Four texels a cell: texels 3 to 9 are cells 0 to 2, end-exclusive 3.
	expect(ops.maskCells(t)).toEqual({ x0: 0, z0: 1, x1: 3, z1: 6 })
})

test('fillMask paints the mask texels as one step and does nothing on an empty mask', () => {
	const { t, history } = world()
	expect(ops.fillMask(t, history, 1)).toBeNull()
	expect(history.position).toBe(0)
	const before = snapshot(t)
	const R = t.splatRes
	for (let z = 8; z < 16; z++) for (let x = 8; x < 16; x++) t.mask[z * R + x] = 255
	const masked = snapshot(t)
	expect(ops.fillMask(t, history, 1)).toBe(0)
	const p = (10 * R + 10) * SLOTS
	expect(t.weights[p + 1]).toBe(255)
	expect(t.weights[(30 * R + 30) * SLOTS + 1]).toBe(before.weights[(30 * R + 30) * SLOTS + 1])
	undoRestores(t, history, masked)
})

test('markAreaTexels fills a rect, or only the cells of a shape', () => {
	const { t } = world()
	const R = t.splatRes
	const m = new Uint8Array(R * R)
	ops.markAreaTexels(t, { x0: 1, z0: 1, x1: 3, z1: 2 }, null, m)
	expect(m.reduce((n, v) => n + (v ? 1 : 0), 0)).toBe(2 * 4 * 1 * 4)
	const shape = new Uint8Array(t.size * t.size)
	shape[1 * t.size + 2] = INSIDE
	m.fill(0)
	ops.markAreaTexels(t, { x0: 1, z0: 1, x1: 3, z1: 2 }, shape, m)
	expect(m.reduce((n, v) => n + (v ? 1 : 0), 0)).toBe(16)
	expect(m[4 * R + 8]).toBe(255)
})

test('cutHoles cuts whole 2x2 blocks, counts them in holesInArea, and a second cut changes nothing', () => {
	const { t, history } = world()
	const before = snapshot(t)
	// One cell grows out to its block.
	expect(ops.cutHoles(t, history, { x0: 5, z0: 5, x1: 6, z1: 6 }, null, true)).toBe(4)
	expect(ops.holesInArea(t, { x0: 4, z0: 4, x1: 6, z1: 6 }, null)).toBe(4)
	undoRestores(t, history, before)
	expect(ops.cutHoles(t, history, { x0: 5, z0: 5, x1: 6, z1: 6 }, null, true)).toBe(0)
	expect(ops.cutHoles(t, history, { x0: 4, z0: 4, x1: 6, z1: 6 }, null, false)).toBe(4)
	expect(ops.holesInArea(t, { x0: 0, z0: 0, x1: t.size, z1: t.size }, null)).toBe(0)
})

test('cutHoles with a shape cuts only the blocks holding one of its cells', () => {
	const { t, history } = world()
	const shape = new Uint8Array(t.size * t.size)
	shape[9 * t.size + 9] = INSIDE
	expect(ops.cutHoles(t, history, { x0: 0, z0: 0, x1: 16, z1: 16 }, shape, true)).toBe(4)
	expect(t.holes[8 * t.size + 8]).toBe(1)
	expect(t.holes[0]).toBe(0)
	// holesInArea counts the shape's own cells only.
	expect(ops.holesInArea(t, { x0: 0, z0: 0, x1: 16, z1: 16 }, shape)).toBe(1)
})

test('setHeights replaces every height as one step', () => {
	const { t, history, objects } = world()
	const before = snapshot(t)
	ops.setHeights(t, history, objects, new Float32Array(t.heights.length).fill(3), 'Flat')
	expect(t.heights.every((h) => h === 3)).toBe(true)
	expect(history.peek()?.label).toBe('Flat')
	undoRestores(t, history, before)
})

test('heightRange gives the lowest and highest ground of the map or a rect', () => {
	const { t } = world()
	t.heights[0] = -50
	t.heights[t.verts * 10 + 10] = 99
	expect(ops.heightRange(t)).toEqual([-50, 99])
	const [lo, hi] = ops.heightRange(t, { x0: 5, z0: 5, x1: 12, z1: 12 })
	expect(hi).toBe(99)
	expect(lo).toBeGreaterThan(-50)
	// A rect past the map's edge stops at its last vertex.
	expect(ops.heightRange(t, { x0: 0, z0: 0, x1: 1000, z1: 1000 })).toEqual([-50, 99])
})

test('applyErosion writes the patch back, and with the mask marks where the ground rose', () => {
	const { t, history, objects } = world()
	const before = snapshot(t)
	const r = { x0: 4, z0: 4, x1: 12, z1: 12 }
	const w = r.x1 - r.x0 + 1
	const h = r.z1 - r.z0 + 1
	const work = new Float32Array(w * h)
	const weights = new Float32Array(w * h).fill(1)
	for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) work[z * w + x] = t.heights[(r.z0 + z) * t.verts + r.x0 + x] / CELL
	// Raise the patch's middle vertex 2 yards; one vertex outside the area's weights is left alone.
	const mid = 4 * w + 4
	work[mid] += 2 / CELL
	weights[0] = 0
	work[0] += 5
	const { most, settled } = ops.applyErosion(t, history, objects, r, w, h, work, weights, true, 'Erode map')
	expect(most).toBeCloseTo(2, 4)
	expect(t.heights[8 * t.verts + 8]).toBeCloseTo(before.heights[8 * t.verts + 8] + 2, 4)
	expect(t.heights[4 * t.verts + 4]).toBe(before.heights[4 * t.verts + 4])
	expect(settled).toBeGreaterThan(0)
	expect(t.mask.some((v) => v > 0)).toBe(true)
	undoRestores(t, history, before)
})

test('duplicateModels keeps the first of each place, type, turn, size and parent', () => {
	const o = (id: number, x: number, extra: Partial<WorldObject> = {}): WorldObject => ({ id, type: CUBE, x, z: 5, yOff: 0, rotY: 0, scale: 1, ...extra })
	const objs = [o(1, 5), o(2, 5.001), o(3, 5, { parent: 1 }), o(4, 5, { type: 'helper:cube:2' }), o(5, 6), o(6, 5.004)]
	// 5.001 and 5.004 round to the same hundredth as 5; a parent or another type makes a different model.
	expect(ops.duplicateModels(objs).map((d) => d.id)).toEqual([2, 6])
	expect(ops.duplicateKey(o(7, 5))).toBe(ops.duplicateKey(o(8, 5.002)))
})

test('removeModels removes them as one step, which undo restores', () => {
	const { objects, history } = world()
	const a = objects.add({ type: CUBE, x: 10, z: 10, yOff: 0, rotY: 0, scale: 1 })
	objects.add({ type: CUBE, x: 10, z: 10, yOff: 0, rotY: 0, scale: 1 })
	const dupes = ops.duplicateModels(objects.objects.values())
	expect(dupes.length).toBe(1)
	ops.removeModels(objects, history, dupes, 'Remove duplicates')
	expect([...objects.objects.keys()]).toEqual([a.id])
	expect(history.peek()?.label).toBe('Remove duplicates')
	history.undo()
	expect(objects.objects.size).toBe(2)
})

test('tileAt, tileVerts and tileChunks find a client tile of a two-tile map', () => {
	const t = new Terrain(TILE_CELLS * 2, CELL)
	const yards = TILE_CELLS * CELL
	expect(ops.tileAt(t, -1, 5)).toBeNull()
	expect(ops.tileAt(t, 2 * yards, 5)).toBeNull()
	expect(ops.tileAt(t, yards + 1, 5)).toEqual({ tx: 1, tz: 0, x0: TILE_CELLS, z0: 0, cells: TILE_CELLS })
	expect(ops.tileVerts(t, 1, 1)).toEqual({ x0: TILE_CELLS, z0: TILE_CELLS, x1: 2 * TILE_CELLS, z1: 2 * TILE_CELLS })
	const chunks = ops.tileChunks(t, 1, 0)
	expect(chunks.length).toBe(TILE_CHUNKS * TILE_CHUNKS)
	expect(chunks[0]).toBe(TILE_CHUNKS)
	expect(ops.tileShadowRect(1, 0)).toEqual({ x0: TILE_CELLS * SHADOW_PER_CELL, z0: 0, x1: 2 * TILE_CELLS * SHADOW_PER_CELL - 1, z1: TILE_CELLS * SHADOW_PER_CELL - 1 })
})

test('clearTileHeights levels a one-tile map to 0 as one step', () => {
	const { t, history, objects } = world(TILE_CELLS)
	const before = snapshot(t)
	ops.clearTileHeights(t, history, objects, 0, 0, 'Clear height on tile 0, 0')
	expect(t.heights.every((h) => h === 0)).toBe(true)
	undoRestores(t, history, before)
})

test("tileRoots and withDescendants pick a tile's models and what hangs on them", () => {
	const { t, objects } = world(TILE_CELLS)
	const root = objects.add({ type: CUBE, x: 10, z: 10, yOff: 0, rotY: 0, scale: 1 })
	const kid = objects.add({ type: CUBE, x: 1, z: 1, yOff: 0, rotY: 0, scale: 1, parent: root.id })
	const roots = ops.tileRoots(t, objects, 0, 0)
	expect(roots.map((o) => o.id)).toEqual([root.id])
	expect(ops.withDescendants(objects, roots).map((o) => o.id)).toEqual([root.id, kid.id])
})

test('the chunk edits: clear, set base, merge duplicates, remove empty layers, replace, delete', () => {
	const { t, history } = world()
	const side = t.paintChunksPerSide
	const R = t.splatRes
	const per = R / side
	// Chunk 0 is half texture 1; chunk 1 has texture 1 in two slots.
	for (let z = 0; z < per; z++) {
		for (let x = 0; x < per / 2; x++) {
			const p = (z * R + x) * SLOTS
			t.weights[p] = 0
			t.weights[p + 1] = 255
		}
	}
	t.chunkSlots[1 * SLOTS + 2] = 1
	let before = snapshot(t)
	ops.clearChunkTextures(t, history, [0], 'Clear')
	expect(t.weights[1]).toBe(0)
	expect(t.weights[0]).toBe(255)
	undoRestores(t, history, before)
	history.undo()

	before = snapshot(t)
	ops.setChunkBase(t, history, [0], 3, 'Set base')
	expect([...t.chunkSlots.subarray(0, SLOTS)]).toEqual([3, NO_TEXTURE, NO_TEXTURE, NO_TEXTURE])
	undoRestores(t, history, before)
	history.undo()

	before = snapshot(t)
	expect(ops.mergeChunkDuplicates(t, history, [0, 2], 'Merge')).toBe(0)
	expect(ops.mergeChunkDuplicates(t, history, [0, 1, 2], 'Merge')).toBe(1)
	undoRestores(t, history, before)

	// Texture 2 with no weight in every chunk but 0: an empty layer each.
	const all = ops.allChunks(t)
	expect(all.length).toBe(side * side)
	for (const c of all) if (c) t.chunkSlots[c * SLOTS + 3] = 2
	expect(ops.removeEmptyLayers(t, history, all)).toEqual({ chunks: side * side - 1, layers: side * side - 1 })
	expect(t.chunkSlots[2 * SLOTS + 3]).toBe(NO_TEXTURE)
	expect(ops.removeEmptyLayers(t, history, all)).toEqual({ chunks: 0, layers: 0 })

	before = snapshot(t)
	ops.replaceTextureInChunks(t, history, [0], 1, 4)
	expect(history.peek()?.label).toBe('Replace texture here')
	expect([...t.chunkSlots.subarray(0, SLOTS)]).toContain(4)
	undoRestores(t, history, before)

	before = snapshot(t)
	ops.deleteTextureInChunks(t, history, [0, 2], 1)
	expect(history.peek()?.label).toBe('Delete texture in 2 chunks')
	expect([...t.chunkSlots.subarray(0, SLOTS)]).not.toContain(1)
	undoRestores(t, history, before)

	before = snapshot(t)
	ops.clearChunks(t, history, [3])
	expect([...t.chunkSlots.subarray(3 * SLOTS, 4 * SLOTS)].every((s) => s === NO_TEXTURE)).toBe(true)
	undoRestores(t, history, before)
})

test("chunksInArea takes the chunks a rect touches, or a shape's chunks only", () => {
	const { t } = world()
	const side = t.paintChunksPerSide
	expect(ops.chunksInArea(t, { x0: 0, z0: 0, x1: 0, z1: 4 }, null)).toEqual([])
	expect(ops.chunksInArea(t, { x0: 7, z0: 0, x1: 9, z1: 1 }, null)).toEqual([0, 1])
	const shape = new Uint8Array(t.size * t.size)
	shape[9 * t.size + 9] = INSIDE
	expect(ops.chunksInArea(t, { x0: 0, z0: 0, x1: 16, z1: 16 }, shape)).toEqual([side + 1])
})

test('swapTexture and fillTextures change the whole map as one step', () => {
	const { t, history } = world()
	let before = snapshot(t)
	ops.swapTexture(t, history, 1, 5)
	expect(t.chunkSlots[1]).toBe(5)
	undoRestores(t, history, before)
	before = snapshot(t)
	ops.fillTextures(t, history, 2)
	expect(history.peek()?.label).toBe('Fill map with texture')
	expect(t.chunkSlots[0]).toBe(2)
	undoRestores(t, history, before)
})

test("clearShadowRect lights a rect or a shape's texels, and says when the map has no shadows", () => {
	const { t, history } = world()
	const all = ops.shadowRect(t, null)
	expect(all).toEqual({ x0: 0, z0: 0, x1: t.shadowSide - 1, z1: t.shadowSide - 1 })
	expect(ops.clearShadowRect(t, history, all, null, 'Clear')).toBeNull()
	t.ensureShadow().fill(255)
	const before = snapshot(t)
	const r = ops.shadowRect(t, { x0: 1, z0: 1, x1: 3, z1: 3 })
	expect(r).toEqual({ x0: SHADOW_PER_CELL, z0: SHADOW_PER_CELL, x1: 3 * SHADOW_PER_CELL - 1, z1: 3 * SHADOW_PER_CELL - 1 })
	const shape = new Uint8Array(t.size * t.size)
	shape[1 * t.size + 2] = INSIDE
	expect(ops.clearShadowRect(t, history, r, shape, 'Clear')).toBe(true)
	const side = t.shadowSide
	expect(t.shadow![SHADOW_PER_CELL * side + 2 * SHADOW_PER_CELL]).toBe(0)
	expect(t.shadow![SHADOW_PER_CELL * side + SHADOW_PER_CELL]).toBe(255)
	undoRestores(t, history, before)
	// Lit already: nothing changes and no step.
	ops.clearShadowRect(t, history, all, null, 'Clear')
	expect(ops.clearShadowRect(t, history, all, null, 'Clear')).toBe(false)
})

test('restoreOutsideShape puts back the texels outside a shape and counts the changed ones inside', () => {
	const side = 8
	const data = new Uint8Array(side * side)
	const r = { x0: 0, z0: 0, x1: 7, z1: 7 }
	const kept = ops.shadowTexels(data, side, r)
	data.fill(9)
	// Two cells of four texels a side; the shape holds the first.
	const shape = new Uint8Array([INSIDE, 0, 0, 0])
	expect(ops.restoreOutsideShape(data, side, r, kept, shape, 2, 4)).toBe(16)
	expect(data[0]).toBe(9)
	expect(data[4]).toBe(0)
})

test('regenerateAutoPaint repaints the map as one step', () => {
	const { t, history } = world()
	const before = snapshot(t)
	ops.regenerateAutoPaint(t, history, 0, false)
	expect(history.peek()?.label).toBe('Auto paint')
	undoRestores(t, history, before)
})

test('fitGroundCommand levels the ground under a cube and keeps it in place', () => {
	const { t, objects } = world()
	const o = objects.add({ type: CUBE, x: 30, z: 30, yOff: 0, rotY: 0, scale: 1 })
	objects.group.updateMatrixWorld(true)
	const fit = { margin: 0.5, falloff: 6, mode: 'both' as const, holes: false, reach: 2 }
	const before = snapshot(t)
	const placed = objects.worldPlacement(o).pos.y
	const { cmd, fitted, loading } = ops.fitGroundCommand(t, objects, [o.id], false, fit)
	expect(loading).toBe(0)
	expect(fitted).toBe(1)
	expect(cmd).not.toBeNull()
	expect(objects.worldPlacement(o).pos.y).toBeCloseTo(placed, 3)
	cmd!.undo()
	expect(snapshot(t).heights).toEqual(before.heights)
})
