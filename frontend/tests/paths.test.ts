// Run with: bun test tests/paths.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RIVER_BANK, copyPaths, crossWeight, downhill, fencePieces, limitGrade, riverBed, nearestSegment, newPath, pathField, readPaths, samplePath, type MapPath } from '../src/lib/terrain/paths.ts'
import { applyPath } from '../src/lib/tools/pathApply.ts'
import { LiquidMap } from '../src/lib/water/liquids.ts'
import { NO_TEXTURE, SLOTS } from '../src/lib/terrain/chunkPaint.ts'
import type { Terrain } from '../src/lib/terrain/Terrain.ts'
import type { ObjectLayer } from '../src/lib/world/ObjectLayer.ts'

/** A flat map of `size` cells (2 yd each) at height `h`, painted all over with palette texture 0. */
function fakeTerrain(size: number, h = 10) {
	const verts = size + 1
	const splatRes = size * 4
	const side = size / 8
	const chunkSlots = new Uint8Array(side * side * SLOTS).fill(NO_TEXTURE)
	for (let c = 0; c < side * side; c++) chunkSlots[c * SLOTS] = 0
	const weights = new Uint8Array(splatRes * splatRes * SLOTS)
	for (let p = 0; p < splatRes * splatRes; p++) weights[p * SLOTS] = 255
	const t = {
		size,
		verts,
		cellSize: 2,
		worldSize: size * 2,
		splatRes,
		paintChunksPerSide: side,
		heights: new Float32Array(verts * verts).fill(h),
		chunkSlots,
		weights,
		dirty: 0,
		markDirty() {
			t.dirty++
		},
		markSplatDirty() {},
		heightAt(x: number, z: number) {
			const i = Math.round(z / 2) * verts + Math.round(x / 2)
			return t.heights[i]
		},
	}
	return t
}

const objects = { markRegionDirty() {} } as unknown as ObjectLayer

function road(points: Array<[number, number, number]>, over: Partial<MapPath> = {}): MapPath {
	const p = newPath([], 'road', 'tex')
	p.points = points.map(([x, y, z]) => ({ x, y, z }))
	return { ...p, ...over }
}

test('the curve runs through every point and is sampled evenly along its length', () => {
	const sm = samplePath(
		[
			{ x: 0, y: 0, z: 0 },
			{ x: 50, y: 5, z: 20 },
			{ x: 100, y: 0, z: 0 },
		],
		1,
	)
	assert.ok(sm.length > 100)
	assert.deepEqual([sm.x[0], sm.z[0]], [0, 0])
	assert.ok(Math.abs(sm.x[sm.n - 1] - 100) < 1e-3 && Math.abs(sm.z[sm.n - 1]) < 1e-3)
	const steps = Array.from({ length: sm.n - 1 }, (_, i) => Math.hypot(sm.x[i + 1] - sm.x[i], sm.y[i + 1] - sm.y[i], sm.z[i + 1] - sm.z[i]))
	assert.ok(Math.max(...steps) - Math.min(...steps) < 0.05, 'spacing is even')
	// The middle point is on the curve.
	let near = Infinity
	for (let i = 0; i < sm.n; i++) near = Math.min(near, Math.hypot(sm.x[i] - 50, sm.z[i] - 20))
	assert.ok(near < 1)
	assert.equal(samplePath([], 1).n, 0)
	assert.equal(samplePath([{ x: 3, y: 4, z: 5 }], 1).n, 1)
})

test('the grade limit keeps every step within the percent and leaves gentle runs alone', () => {
	const sm = samplePath(
		[
			{ x: 0, y: 0, z: 0 },
			{ x: 100, y: 50, z: 0 },
		],
		1,
	)
	limitGrade(sm, 10)
	for (let i = 1; i < sm.n; i++) assert.ok(Math.abs(sm.y[i] - sm.y[i - 1]) <= 0.1 * (sm.s[i] - sm.s[i - 1]) + 1e-4)
	const flat = samplePath(
		[
			{ x: 0, y: 0, z: 0 },
			{ x: 100, y: 2, z: 0 },
		],
		1,
	)
	const before = flat.y.slice()
	limitGrade(flat, 10)
	assert.deepEqual([...flat.y], [...before])
})

test('the cross profile is full inside the width, a cosine over the falloff and nothing past it', () => {
	assert.equal(crossWeight(3, 4, 2), 1)
	assert.equal(crossWeight(4, 4, 2), 1)
	assert.ok(Math.abs(crossWeight(5, 4, 2) - 0.5) < 1e-9)
	assert.equal(crossWeight(6, 4, 2), 0)
	assert.equal(crossWeight(4.1, 4, 0), 0)
})

test('the distance field finds the nearest point of the curve and its height', () => {
	const sm = samplePath(
		[
			{ x: 10, y: 5, z: 20 },
			{ x: 50, y: 25, z: 20 },
		],
		0.5,
	)
	const f = pathField(sm, 2, 0, 6, 64)!
	const at = (x: number, z: number) => (z / 2 - f.z0) * f.w + (x / 2 - f.x0)
	assert.ok(f.dist[at(30, 20)] < 1e-3)
	assert.ok(Math.abs(f.height[at(30, 20)] - 15) < 0.1)
	assert.ok(Math.abs(f.dist[at(30, 24)] - 4) < 1e-3)
	assert.equal(f.dist[at(4, 14)], Infinity, 'the box corner is past the round end')
	assert.equal(pathField(samplePath([], 1), 2, 0, 5, 64), null)
})

test('a click near a control segment finds it', () => {
	const pts = [
		{ x: 0, y: 0, z: 0 },
		{ x: 10, y: 0, z: 0 },
		{ x: 10, y: 0, z: 10 },
	]
	assert.deepEqual(nearestSegment(pts, 11, 5), { index: 1, dist: 1 })
	assert.equal(nearestSegment(pts.slice(0, 1), 1, 1).index, -1)
})

test('paths read back from a file get defaults and unique ids, and bad entries go', () => {
	const read = readPaths([{ id: 2, name: 'Old road', kind: 'road', points: [{ x: 1, y: 2, z: 3 }, { x: 'no' }], width: 1000 }, null, { id: 2, points: [] }])
	assert.equal(read.length, 2)
	assert.equal(read[0].points.length, 1)
	assert.equal(read[0].width, 200)
	assert.equal(read[0].falloff, 4)
	assert.notEqual(read[1].id, 2)
	assert.deepEqual(readPaths(undefined), [])
	const a = newPath(read, 'road', '')
	assert.ok(!read.some((p) => p.id === a.id || p.name === a.name))
	const copy = copyPaths(read)
	copy[0].points[0].x = 99
	assert.equal(read[0].points[0].x, 1)
})

test('a road levels the ground to its height across the width and blends back over the falloff', () => {
	const t = fakeTerrain(64, 10)
	const r = road(
		[
			[20, 30, 60],
			[100, 30, 60],
		],
		{ width: 8, falloff: 4 },
	)
	const res = applyPath({ terrain: t as unknown as Terrain, objects, liquids: new LiquidMap(t.size) }, r, -1)
	assert.ok(res.cmd)
	assert.ok(res.cmd!.bytes! > 0, 'the step reports the heights it holds')
	const at = (x: number, z: number) => t.heights[(z / 2) * t.verts + x / 2]
	assert.ok(Math.abs(at(60, 60) - 30) < 1e-3, 'centre at the road height')
	assert.ok(Math.abs(at(60, 64) - 30) < 1e-3, 'edge of the width too')
	assert.ok(at(60, 66) > 10 && at(60, 66) < 30, 'blending over the falloff')
	assert.equal(at(60, 70), 10, 'untouched past it')
	assert.ok(t.dirty > 0)
	res.cmd!.undo()
	assert.ok(
		t.heights.every((v) => v === 10),
		'undo restores every vertex',
	)
	res.cmd!.redo()
	assert.ok(Math.abs(at(60, 60) - 30) < 1e-3)
})

test('a road paints its texture over the width, and undo takes the paint back', () => {
	const t = fakeTerrain(64, 10)
	const before = t.weights.slice()
	const slotsBefore = t.chunkSlots.slice()
	const r = road(
		[
			[20, 10, 60],
			[100, 10, 60],
		],
		{ width: 8, edge: 0 },
	)
	const res = applyPath({ terrain: t as unknown as Terrain, objects, liquids: new LiquidMap(t.size) }, r, 3)
	const R = t.splatRes
	const texel = (x: number, z: number) => (Math.floor(z / 0.5) * R + Math.floor(x / 0.5)) * SLOTS
	const chunk = (x: number, z: number) => Math.floor(z / 16) * t.paintChunksPerSide + Math.floor(x / 16)
	const slot = (x: number, z: number) => [...t.chunkSlots.slice(chunk(x, z) * SLOTS, chunk(x, z) * SLOTS + SLOTS)].indexOf(3)
	const k = slot(60, 60)
	assert.ok(k >= 0, 'the chunk took the texture')
	assert.equal(t.weights[texel(60, 60) + k], 255)
	assert.equal(t.weights[texel(60, 63) + k], 255)
	assert.equal(t.weights[texel(60, 65) + 0], 255, 'outside the width keeps its base')
	res.cmd!.undo()
	assert.deepEqual([...t.weights], [...before])
	assert.deepEqual([...t.chunkSlots], [...slotsBefore])
})

test('a road needs two points', () => {
	const t = fakeTerrain(16)
	const res = applyPath({ terrain: t as unknown as Terrain, objects, liquids: new LiquidMap(t.size) }, road([[4, 1, 4]]), -1)
	assert.equal(res.cmd, null)
})

test('a river surface only runs downhill, from whichever end is higher', () => {
	const sm = samplePath(
		[
			{ x: 0, y: 10, z: 0 },
			{ x: 50, y: 14, z: 0 },
			{ x: 100, y: 2, z: 0 },
		],
		1,
	)
	downhill(sm)
	for (let i = 1; i < sm.n; i++) assert.ok(sm.y[i] <= sm.y[i - 1] + 1e-6)
	assert.equal(sm.y[0], 10)
	const up = samplePath(
		[
			{ x: 0, y: 2, z: 0 },
			{ x: 100, y: 9, z: 0 },
		],
		1,
	)
	downhill(up)
	for (let i = 1; i < up.n; i++) assert.ok(up.y[i] >= up.y[i - 1] - 1e-6)
})

test('the river bed is the depth below the surface in the middle and a bank above it at the sides', () => {
	assert.ok(Math.abs(riverBed(0, 6, 20, 3) - 17) < 1e-9)
	assert.ok(Math.abs(riverBed(6, 6, 20, 3) - (20 + RIVER_BANK)) < 1e-9)
	assert.ok(riverBed(3, 6, 20, 3) > 17 && riverBed(3, 6, 20, 3) < 20)
})

test('a river carves its bed and fills it with its liquid, whose surface slopes down the curve, and undo takes both back', () => {
	const t = fakeTerrain(64, 10)
	const liquids = new LiquidMap(64)
	const r = road(
		[
			[10, 9, 60],
			[118, 5, 60],
		],
		{ kind: 'river', width: 12, falloff: 4, depth: 3, liquid: 1 },
	)
	const res = applyPath({ terrain: t as unknown as Terrain, objects, liquids }, r, -1)
	assert.ok(res.cmd)
	assert.ok(res.cmd!.bytes! > 0, 'the step reports the heights and the liquid it holds')
	const at = (x: number, z: number) => t.heights[(z / 2) * t.verts + x / 2]
	assert.ok(Math.abs(at(64, 60) - (7 - 3)) < 0.1, `bed ${at(64, 60)}`)
	assert.equal(at(64, 80), 10, 'untouched beyond the falloff')
	// The cell at (64, 60): chunk 2,1 of the 4x4 chunks (16 yd each), local cell 0, 6.
	const surfaceAt = (x: number, z: number) => {
		const gx = Math.floor(x / 2),
			gz = Math.floor(z / 2)
		const c = Math.floor(gz / 8) * liquids.side + Math.floor(gx / 8)
		const l = liquids.layers(c).find((q) => q.cells[(gz % 8) * 8 + (gx % 8)])
		return l ? l.heights[(gz % 8) * 9 + (gx % 8)] : null
	}
	const upstream = surfaceAt(20, 60)
	const down = surfaceAt(100, 60)
	assert.ok(upstream !== null && down !== null, 'liquid along the river')
	assert.ok(upstream! > down!, 'downhill')
	assert.equal(surfaceAt(64, 76), null, 'none beyond the width')
	res.cmd!.undo()
	assert.ok(liquids.empty)
	assert.ok(t.heights.every((v) => v === 10))
	res.cmd!.redo()
	assert.ok(!liquids.empty)
})

test('fence pieces split the curve into equal spans near the model length, each turned along its span', () => {
	const sm = samplePath(
		[
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: 0, z: 31 },
		],
		0.5,
	)
	const pieces = fencePieces(sm, 4, false, 0)
	assert.equal(pieces.length, 8)
	assert.ok(Math.abs(pieces[0].z - 31 / 16) < 1e-3 && Math.abs(pieces[0].x) < 1e-6)
	// Along +z: a turn that takes the model's +X there, (cos r, -sin r) = (0, 1).
	assert.ok(Math.abs(Math.cos(pieces[0].rotY)) < 1e-6 && Math.abs(-Math.sin(pieces[0].rotY) - 1) < 1e-6)
	const z = fencePieces(sm, 4, true, 0)
	assert.ok(Math.abs(z[0].rotY - pieces[0].rotY - Math.PI / 2) < 1e-6, 'a model long in Z turns a quarter more')
	const turned = fencePieces(sm, 4, false, 90)
	assert.ok(Math.abs(turned[0].rotY - pieces[0].rotY - Math.PI / 2) < 1e-6)
	assert.deepEqual(fencePieces(sm, 0, false, 0), [])
})

test('a fence stands its model along the path, one undo step removing them all', () => {
	const t = fakeTerrain(64, 10)
	const placed = new Map<number, { id: number; type: string; x: number; z: number; rotY: number }>()
	let next = 1
	const layer = {
		add(o: { id?: number; type: string; x: number; z: number; rotY: number }) {
			const p = { ...o, id: o.id ?? next++ }
			placed.set(p.id, p)
			return p
		},
		remove(id: number) {
			placed.delete(id)
		},
		markRegionDirty() {},
	} as unknown as ObjectLayer
	const f = road(
		[
			[10, 10, 20],
			[70, 10, 20],
		],
		{ kind: 'fence', model: 'm2:fence.m2', spacing: 0 },
	)
	const res = applyPath({ terrain: t as unknown as Terrain, objects: layer, liquids: new LiquidMap(64) }, f, -1, { length: 6, alongZ: false })
	assert.ok(res.cmd)
	assert.equal(placed.size, 10)
	assert.ok([...placed.values()].every((o) => o.type === 'm2:fence.m2' && Math.abs(o.z - 20) < 1e-3 && Math.abs(o.rotY) < 1e-6))
	assert.ok(
		t.heights.every((v) => v === 10),
		'the ground stays',
	)
	res.cmd!.undo()
	assert.equal(placed.size, 0)
	res.cmd!.redo()
	assert.equal(placed.size, 10)
	const none = applyPath({ terrain: t as unknown as Terrain, objects: layer, liquids: new LiquidMap(64) }, { ...f, model: '' }, -1)
	assert.equal(none.cmd, null)
	const spaced = applyPath({ terrain: t as unknown as Terrain, objects: layer, liquids: new LiquidMap(64) }, { ...f, spacing: 20 }, -1)
	assert.ok(spaced.message.includes('3 models'))
})
