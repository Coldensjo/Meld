// Run with: bun test tests/terrainStroke.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TerrainStroke } from '../src/lib/tools/brush.ts'
import { ShadowStroke } from '../src/lib/tools/shadowStroke.ts'
import { NO_TEXTURE, SLOTS } from '../src/lib/terrain/chunkPaint.ts'
import type { Terrain } from '../src/lib/terrain/Terrain.ts'

const SIZE = 16 // cells: 2x2 paint chunks of 8 cells
const VERTS = SIZE + 1
const RES = SIZE * 4
const SIDE = SIZE / 8
const PER = RES / SIDE // texels a chunk side

/** The part of a terrain the strokes read and write. */
function fakeTerrain() {
	const chunkSlots = new Uint8Array(SIDE * SIDE * SLOTS).fill(NO_TEXTURE)
	for (let c = 0; c < SIDE * SIDE; c++) {
		chunkSlots[c * SLOTS] = 0
		chunkSlots[c * SLOTS + 1] = 1
	}
	const weights = new Uint8Array(RES * RES * SLOTS)
	for (let p = 0; p < RES * RES; p++) weights[p * SLOTS] = 255
	const shadowSide = SIZE * 8
	const t = {
		size: SIZE,
		verts: VERTS,
		splatRes: RES,
		paintChunksPerSide: SIDE,
		shadowSide,
		heights: new Float32Array(VERTS * VERTS).fill(10),
		weights,
		chunkSlots,
		mask: new Uint8Array(RES * RES),
		holes: new Uint8Array(SIZE * SIZE),
		shadow: null as Uint8Array | null,
		dirty: 0,
		splatDirty: 0,
		maskDirty: 0,
		holesTouched: 0,
		shadowTouched: 0,
		markDirty() {
			t.dirty++
		},
		markSplatDirty() {
			t.splatDirty++
		},
		markMaskDirty() {
			t.maskDirty++
		},
		touchHoles() {
			t.holesTouched++
		},
		touchShadow() {
			t.shadowTouched++
		},
		ensureShadow() {
			if (!t.shadow) t.shadow = new Uint8Array(shadowSide * shadowSide)
			return t.shadow
		},
		setShadow(b: Uint8Array | null) {
			t.shadow = b
		},
	}
	return t
}

const asTerrain = (t: ReturnType<typeof fakeTerrain>) => t as unknown as Terrain

function snapshot(t: ReturnType<typeof fakeTerrain>) {
	return {
		heights: t.heights.slice(),
		weights: t.weights.slice(),
		slots: t.chunkSlots.slice(),
		mask: t.mask.slice(),
		holes: t.holes.slice(),
	}
}

test('a stroke over heights, paint, mask and holes undoes to the exact start and redoes to the exact end', () => {
	const t = fakeTerrain()
	const s = new TerrainStroke(asTerrain(t), 'Test', { heights: true, splat: true, mask: true, holes: true })
	const start = snapshot(t)

	const h = { x0: 2, z0: 3, x1: 6, z1: 5 }
	s.reserveHeights(h)
	for (let z = h.z0; z <= h.z1; z++) for (let x = h.x0; x <= h.x1; x++) t.heights[z * VERTS + x] = 25 + x
	s.touchHeights(h)

	const px = { x0: 4, z0: 4, x1: 9, z1: 8 }
	s.reserveTexels(px)
	for (let z = px.z0; z <= px.z1; z++) {
		for (let x = px.x0; x <= px.x1; x++) {
			t.weights[(z * RES + x) * SLOTS] = 100
			t.weights[(z * RES + x) * SLOTS + 1] = 155
			t.mask[z * RES + x] = 200
		}
	}
	s.touchSplat(px)
	s.touchMask(px)

	const c = { x0: 10, z0: 10, x1: 11, z1: 11 }
	s.reserveHoles(c)
	for (let z = c.z0; z <= c.z1; z++) for (let x = c.x0; x <= c.x1; x++) t.holes[z * SIZE + x] = 1
	s.touchHoles(c)

	const end = snapshot(t)
	const cmd = s.finish()!
	assert.ok(cmd)
	assert.ok(cmd.bytes! > 0)
	assert.notDeepEqual(end.heights, start.heights)

	cmd.undo()
	assert.deepEqual(snapshot(t), start)
	cmd.redo()
	assert.deepEqual(snapshot(t), end)
	cmd.undo()
	assert.deepEqual(snapshot(t), start)
})

test('a stroke that wrote nothing returns no command', () => {
	const t = fakeTerrain()
	const s = new TerrainStroke(asTerrain(t), 'Nothing', { heights: true, splat: true, mask: true, holes: true })
	assert.equal(s.finish(), null)
})

test('a layer the stroke does not record is left alone by undo', () => {
	const t = fakeTerrain()
	const s = new TerrainStroke(asTerrain(t), 'Heights', { heights: true })
	const r = { x0: 0, z0: 0, x1: 1, z1: 1 }
	s.reserveHeights(r)
	t.heights[0] = 99
	s.touchHeights(r)
	t.mask[5] = 7
	s.reserveMask(r) // not recorded: no mask snapshot
	const cmd = s.finish()!
	cmd.undo()
	assert.equal(t.heights[0], 10)
	assert.equal(t.mask[5], 7)
})

test('settling slots grows the splat rect to whole chunks and undo restores the slots and weights', () => {
	const t = fakeTerrain()
	// Chunk 0 uses slot 1 on one texel and slot 2 (texture 5) on another, far from the first.
	t.chunkSlots[2] = 5
	t.weights[(2 * RES + 2) * SLOTS] = 0
	t.weights[(2 * RES + 2) * SLOTS + 1] = 255
	t.weights[(20 * RES + 20) * SLOTS] = 0
	t.weights[(20 * RES + 20) * SLOTS + 2] = 255
	const s = new TerrainStroke(asTerrain(t), 'Paint', { splat: true })
	const start = snapshot(t)
	const px = { x0: 2, z0: 2, x1: 2, z1: 2 }
	s.reserveSplat(px)
	// Paint the texel back to slot 0: slot 1 has no weight left in chunk 0, so slot 2 moves down into it.
	t.weights[(2 * RES + 2) * SLOTS] = 255
	t.weights[(2 * RES + 2) * SLOTS + 1] = 0
	s.touchSplat(px)
	const cmd = s.finish()!
	assert.ok(cmd)
	assert.equal(t.chunkSlots[1], 5)
	assert.equal(t.chunkSlots[2], NO_TEXTURE)
	// The texel the stroke never touched was reordered, so it moved to slot 1.
	assert.equal(t.weights[(20 * RES + 20) * SLOTS + 1], 255)
	assert.equal(t.weights[(20 * RES + 20) * SLOTS + 2], 0)
	// The rect grew to chunk 0 whole (PER x PER texels of SLOTS bytes, before and after), not one texel.
	assert.ok(cmd.bytes! > PER * SLOTS)
	const end = snapshot(t)
	cmd.undo()
	assert.deepEqual(snapshot(t), start)
	cmd.redo()
	assert.deepEqual(snapshot(t), end)
})

test('a write that was not reserved first still records, and warns', () => {
	const t = fakeTerrain()
	const s = new TerrainStroke(asTerrain(t), 'Late', { heights: true })
	const r = { x0: 1, z0: 1, x1: 2, z1: 2 }
	const warns: string[] = []
	const orig = console.warn
	console.warn = (...a: unknown[]) => void warns.push(a.join(' '))
	try {
		t.heights[VERTS + 1] = 40 // written before the reserve: this one is lost to undo
		s.touchHeights(r)
	} finally {
		console.warn = orig
	}
	assert.equal(warns.length, 1)
	assert.match(warns[0], /heights written before they were reserved/)
	t.heights[VERTS + 2] = 41
	// The rest of the stroke records: a later write inside the (now saved) block undoes.
	const cmd = s.finish()
	assert.ok(cmd, 'the stroke still produces a step')
	cmd.undo()
	assert.equal(t.heights[VERTS + 2], 10)
	cmd.redo()
	assert.equal(t.heights[VERTS + 2], 41)
})

test('a reserved write does not warn', () => {
	const t = fakeTerrain()
	const s = new TerrainStroke(asTerrain(t), 'Fine', { heights: true })
	const r = { x0: 1, z0: 1, x1: 2, z1: 2 }
	const warns: unknown[] = []
	const orig = console.warn
	console.warn = (...a: unknown[]) => void warns.push(a)
	try {
		s.reserveHeights(r)
		s.touchHeights(r)
	} finally {
		console.warn = orig
	}
	assert.equal(warns.length, 0)
})

test('ShadowStroke undoes a first shadow edit back to a map with no shadows, and redoes it', () => {
	const t = fakeTerrain()
	assert.equal(t.shadow, null)
	const s = new ShadowStroke(asTerrain(t), 'Shadow')
	const r = { x0: 3, z0: 4, x1: 10, z1: 6 }
	s.reserve(r)
	const side = t.shadowSide
	for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) t.shadow![z * side + x] = 255
	s.touch(r)
	const written = t.shadow!.slice()
	const cmd = s.finish()!
	assert.ok(cmd)
	cmd.undo()
	assert.equal(t.shadow, null)
	cmd.redo()
	assert.deepEqual(t.shadow, written)
	cmd.undo()
	assert.equal(t.shadow, null)
})

test('ShadowStroke on a map with shadows restores only the changed texels, and a no-op leaves none behind', () => {
	const t = fakeTerrain()
	const side = t.shadowSide
	t.ensureShadow()[5] = 77
	const s = new ShadowStroke(asTerrain(t), 'Shadow')
	const r = { x0: 0, z0: 0, x1: 7, z1: 0 }
	s.reserve(r)
	t.shadow![2] = 255
	s.touch(r)
	const cmd = s.finish()!
	cmd.undo()
	assert.equal(t.shadow![2], 0)
	assert.equal(t.shadow![5], 77)
	assert.equal(t.shadow!.length, side * side)
	cmd.redo()
	assert.equal(t.shadow![2], 255)

	const fresh = fakeTerrain()
	const noop = new ShadowStroke(asTerrain(fresh), 'Nothing')
	noop.reserve(r)
	noop.touch(r)
	assert.equal(noop.finish(), null)
	assert.equal(fresh.shadow, null)
})

/** A flat map of `size` cells with a paint mask, enough for a stroke that records heights and the mask. */
function maskTerrain(size: number) {
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
	const t = maskTerrain(64)
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
	assert.ok(
		t.mask.every((v) => v === 0),
		'undo clears what the step set',
	)
	assert.deepEqual(t.maskDirty.at(-1), { x0: 100, z0: 10, x1: 104, z1: 19 }, 'undo uploads the changed rect')
	cmd.redo()
	assert.deepEqual(t.mask, after)
})

test('a heights step keeps the vertices that changed, not the whole reserved rect', () => {
	const t = maskTerrain(64)
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

test('a stroke leaves the ground of a tile the map leaves out of its square as it was (#737), and undo keeps to the rest', () => {
	const t = fakeTerrain()
	// The east half (cells 8 and up) is left out. The vertex column 8 touches a present cell, so it is kept.
	const off = (cx: number) => cx >= 8
	Object.assign(t, {
		tileMask: new Uint8Array([1, 0]),
		tileOff: (cx: number) => off(cx),
		vertexOff: (vx: number) => off(vx - 1) && off(vx),
		texelOff: (tx: number) => off(Math.floor(tx / 4)),
	})
	const s = new TerrainStroke(asTerrain(t), 'Test', { heights: true, splat: true, mask: true, holes: true })
	const start = snapshot(t)
	const hr = { x0: 5, z0: 3, x1: 12, z1: 5 }
	s.reserveHeights(hr)
	for (let z = hr.z0; z <= hr.z1; z++) for (let x = hr.x0; x <= hr.x1; x++) t.heights[z * VERTS + x] = 99
	s.touchHeights(hr)
	const tr = { x0: 20, z0: 4, x1: 50, z1: 6 }
	s.reserveTexels(tr)
	for (let z = tr.z0; z <= tr.z1; z++)
		for (let x = tr.x0; x <= tr.x1; x++) {
			t.weights[(z * RES + x) * SLOTS] = 0
			t.mask[z * RES + x] = 200
		}
	s.touchSplat(tr)
	s.touchMask(tr)
	const cmd = s.finish()!
	for (let z = hr.z0; z <= hr.z1; z++) {
		for (let x = hr.x0; x <= hr.x1; x++) {
			assert.equal(t.heights[z * VERTS + x], x <= 8 ? 99 : 10, `vertex ${x},${z}`)
		}
	}
	for (let z = tr.z0; z <= tr.z1; z++) {
		for (let x = tr.x0; x <= tr.x1; x++) {
			const off32 = x >= 32
			assert.equal(t.mask[z * RES + x], off32 ? 0 : 200)
			assert.equal(t.weights[(z * RES + x) * SLOTS], off32 ? 255 : 0)
		}
	}
	cmd.undo()
	const after = snapshot(t)
	assert.deepEqual(after.heights, start.heights)
	assert.deepEqual(after.weights, start.weights)
	assert.deepEqual(after.mask, start.mask)
})
