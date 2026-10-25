// Run with: bun test tests/holes.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HOLE_CELL, HOLE_FIRST, HOLE_NONE, HOLE_SECOND, countHoles, fillHoles, holeTriangle, triangleIsHole, withTriangle, writeCellIndex } from '../src/lib/terrain/holes.ts'

test('a chunk without holes gets two triangles per cell', () => {
	const size = 4
	const holes = new Uint8Array(size * size)
	const idx = new Uint32Array(size * size * 6)
	const n = writeCellIndex(idx, size, size, size + 1, 0, 0, holes, size)
	assert.equal(n, size * size * 6)
	// Every index points at a vertex of the chunk.
	for (let i = 0; i < n; i++) assert.ok(idx[i] < (size + 1) * (size + 1))
})

test('a hole cell is left out of the index', () => {
	const size = 4
	const holes = new Uint8Array(size * size)
	holes[1 * size + 2] = 1
	const idx = new Uint32Array(size * size * 6)
	const n = writeCellIndex(idx, size, size, size + 1, 0, 0, holes, size)
	assert.equal(n, (size * size - 1) * 6)
	// The hole cell's corner vertex (2,1) at index 1*5+2 = 7 is only used by its neighbours, never as cell (2,1)'s own corner.
	const corner = 1 * (size + 1) + 2
	const far = 2 * (size + 1) + 3
	for (let i = 0; i < n; i += 3) {
		const tri = [idx[i], idx[i + 1], idx[i + 2]]
		assert.ok(!(tri.includes(corner) && tri.includes(far)), 'a triangle spans the hole')
	}
})

test('a chunk that starts inside the map reads the holes at its own offset', () => {
	const size = 8
	const holes = new Uint8Array(size * size)
	holes[5 * size + 6] = 1
	const idx = new Uint32Array(16 * 6)
	// The chunk covering cells 4..7 x 4..7 loses one cell; the one covering 0..3 x 0..3 loses none.
	assert.equal(writeCellIndex(idx, 4, 4, 5, 4, 4, holes, size), 15 * 6)
	assert.equal(writeCellIndex(idx, 4, 4, 5, 0, 0, holes, size), 16 * 6)
})

test('fillHoles cuts and fills a rect clipped to the map and counts the changes', () => {
	const size = 8
	const holes = new Uint8Array(size * size)
	assert.equal(fillHoles(holes, size, 6, 6, 10, 10, 1), 4)
	assert.equal(countHoles(holes, size, 0, 0, size, size), 4)
	assert.equal(countHoles(holes, size, 6, 6, 7, 7), 1)
	// Cutting again changes nothing; filling puts it back.
	assert.equal(fillHoles(holes, size, 6, 6, 10, 10, 1), 0)
	assert.equal(fillHoles(holes, size, 0, 0, size, size, 0), 4)
	assert.equal(countHoles(holes, size, 0, 0, size, size), 0)
})

test('a half-cut cell keeps one of its two triangles', () => {
	const size = 2
	const holes = new Uint8Array(size * size)
	const idx = new Uint32Array(size * size * 6)
	// Cell (1,0) is odd: the first triangle holds corner (1,0) = vertex 1, the second the far corner (2,1) = vertex 5.
	holes[0 * size + 1] = HOLE_FIRST
	let n = writeCellIndex(idx, size, size, size + 1, 0, 0, holes, size)
	assert.equal(n, (size * size - 1) * 6 + 3)
	const tris = () => Array.from({ length: n / 3 }, (_, i) => [idx[i * 3], idx[i * 3 + 1], idx[i * 3 + 2]])
	assert.ok(!tris().some((t) => t.includes(1) && t.includes(2) && t.includes(4)), 'the first triangle is cut')
	assert.ok(
		tris().some((t) => t.includes(2) && t.includes(4) && t.includes(5)),
		'the second triangle stays',
	)
	holes[0 * size + 1] = HOLE_SECOND
	n = writeCellIndex(idx, size, size, size + 1, 0, 0, holes, size)
	assert.ok(
		tris().some((t) => t.includes(1) && t.includes(2) && t.includes(4)),
		'the first triangle stays',
	)
	assert.ok(!tris().some((t) => t.includes(2) && t.includes(4) && t.includes(5)), 'the second triangle is cut')
})

test('a point falls in the triangle on its side of the diagonal', () => {
	// Odd cell: the diagonal runs (1,0)-(0,1); the (0,0) corner is in the first triangle.
	assert.equal(holeTriangle(1, 0, 0.1, 0.1), 1)
	assert.equal(holeTriangle(1, 0, 0.9, 0.9), 2)
	// Even cell: the diagonal runs (0,0)-(1,1); the (0,1) corner is in the first triangle.
	assert.equal(holeTriangle(0, 0, 0.1, 0.9), 1)
	assert.equal(holeTriangle(0, 0, 0.9, 0.1), 2)
})

test('cutting and filling triangles composes into the four cell values', () => {
	assert.equal(withTriangle(HOLE_NONE, 1, true), HOLE_FIRST)
	assert.equal(withTriangle(HOLE_FIRST, 2, true), HOLE_CELL)
	assert.equal(withTriangle(HOLE_CELL, 1, false), HOLE_SECOND)
	assert.equal(withTriangle(HOLE_SECOND, 2, false), HOLE_NONE)
	assert.equal(withTriangle(HOLE_CELL, 1, true), HOLE_CELL)
	assert.ok(triangleIsHole(HOLE_CELL, 2) && triangleIsHole(HOLE_SECOND, 2) && !triangleIsHole(HOLE_FIRST, 2))
	// A half-cut cell counts as one hole for the area's count.
	const holes = Uint8Array.of(HOLE_FIRST, HOLE_NONE, HOLE_CELL, HOLE_SECOND)
	assert.equal(countHoles(holes, 2, 0, 0, 2, 2), 3)
})
