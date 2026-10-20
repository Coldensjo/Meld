// Run with: bun test tests/paths.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyPaths, crossWeight, limitGrade, nearestSegment, newPath, pathField, readPaths, samplePath, type MapPath } from '../src/lib/terrain/paths.ts'
import { applyRoad } from '../src/lib/tools/pathApply.ts'
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
	const sm = samplePath([{ x: 0, y: 0, z: 0 }, { x: 50, y: 5, z: 20 }, { x: 100, y: 0, z: 0 }], 1)
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
	const sm = samplePath([{ x: 0, y: 0, z: 0 }, { x: 100, y: 50, z: 0 }], 1)
	limitGrade(sm, 10)
	for (let i = 1; i < sm.n; i++) assert.ok(Math.abs(sm.y[i] - sm.y[i - 1]) <= 0.1 * (sm.s[i] - sm.s[i - 1]) + 1e-4)
	const flat = samplePath([{ x: 0, y: 0, z: 0 }, { x: 100, y: 2, z: 0 }], 1)
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
	const sm = samplePath([{ x: 10, y: 5, z: 20 }, { x: 50, y: 25, z: 20 }], 0.5)
	const f = pathField(sm, 2, 0, 6, 64)!
	const at = (x: number, z: number) => (z / 2 - f.z0) * f.w + (x / 2 - f.x0)
	assert.ok(f.dist[at(30, 20)] < 1e-3)
	assert.ok(Math.abs(f.height[at(30, 20)] - 15) < 0.1)
	assert.ok(Math.abs(f.dist[at(30, 24)] - 4) < 1e-3)
	assert.equal(f.dist[at(4, 14)], Infinity, "the box corner is past the round end")
	assert.equal(pathField(samplePath([], 1), 2, 0, 5, 64), null)
})

test('a click near a control segment finds it', () => {
	const pts = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 10 }]
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
	const r = road([[20, 30, 60], [100, 30, 60]], { width: 8, falloff: 4 })
	const res = applyRoad(t as unknown as Terrain, objects, r, -1)
	assert.ok(res.cmd)
	const at = (x: number, z: number) => t.heights[(z / 2) * t.verts + x / 2]
	assert.ok(Math.abs(at(60, 60) - 30) < 1e-3, 'centre at the road height')
	assert.ok(Math.abs(at(60, 64) - 30) < 1e-3, 'edge of the width too')
	assert.ok(at(60, 66) > 10 && at(60, 66) < 30, 'blending over the falloff')
	assert.equal(at(60, 70), 10, 'untouched past it')
	assert.ok(t.dirty > 0)
	res.cmd!.undo()
	assert.ok(t.heights.every((v) => v === 10), 'undo restores every vertex')
	res.cmd!.redo()
	assert.ok(Math.abs(at(60, 60) - 30) < 1e-3)
})

test('a road paints its texture over the width, and undo takes the paint back', () => {
	const t = fakeTerrain(64, 10)
	const before = t.weights.slice()
	const slotsBefore = t.chunkSlots.slice()
	const r = road([[20, 10, 60], [100, 10, 60]], { width: 8, edge: 0 })
	const res = applyRoad(t as unknown as Terrain, objects, r, 3)
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
	const res = applyRoad(t as unknown as Terrain, objects, road([[4, 1, 4]]), -1)
	assert.equal(res.cmd, null)
})
