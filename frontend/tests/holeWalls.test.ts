// Run with: bun test tests/holeWalls.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WALL_FADE_FAR, WALL_FADE_NEAR, bandOf, findWalls, revealRadius, wallFade } from '../src/lib/terrain/holes.ts'

test('a square hole has four walls, one per side', () => {
	const size = 8
	const holes = new Uint8Array(size * size)
	for (let z = 2; z < 5; z++) for (let x = 3; x < 6; x++) holes[z * size + x] = 1
	const walls = findWalls(holes, size).sort((a, b) => a.axis.localeCompare(b.axis) || a.line - b.line)
	assert.deepEqual(walls, [
		{ axis: 'x', line: 3, from: 2, to: 5, side: 1 }, // the hole is at x >= 3
		{ axis: 'x', line: 6, from: 2, to: 5, side: -1 }, // the hole is at x < 6
		{ axis: 'z', line: 2, from: 3, to: 6, side: 1 },
		{ axis: 'z', line: 5, from: 3, to: 6, side: -1 },
	])
})

test('a hole at the map edge has no wall there, and a notch splits a wall', () => {
	const size = 6
	const holes = new Uint8Array(size * size)
	for (let x = 0; x < 3; x++) holes[0 * size + x] = 1 // top-left strip touching two map edges
	holes[0 * size + 1] = 0 // a notch in it
	const walls = findWalls(holes, size)
	// No walls along x = 0 or z = 0 (the map's edge); the strip's bottom edge is two runs around the notch.
	assert.ok(walls.every((w) => w.line > 0))
	const bottom = walls.filter((w) => w.axis === 'z' && w.line === 1).sort((a, b) => a.from - b.from)
	assert.deepEqual(bottom, [
		{ axis: 'z', line: 1, from: 0, to: 1, side: -1 },
		{ axis: 'z', line: 1, from: 2, to: 3, side: -1 },
	])
})

test('the band across a wall goes into the ground outward and into the hole inward, clipped to the map', () => {
	// The hole is at x < 6 along z 2..4.
	const w = { axis: 'x' as const, line: 6, from: 2, to: 5, side: -1 as const }
	assert.deepEqual(bandOf(w, 2, true, 8), { x0: 6, z0: 2, x1: 7, z1: 4 })
	assert.deepEqual(bandOf(w, 1, false, 8), { x0: 5, z0: 2, x1: 5, z1: 4 })
	assert.deepEqual(bandOf(w, 5, true, 8), { x0: 6, z0: 2, x1: 7, z1: 4 }, 'clipped at the map edge')
	// The hole is at z >= 2 along x 3..5: outward is -z.
	const n = { axis: 'z' as const, line: 2, from: 3, to: 6, side: 1 as const }
	assert.deepEqual(bandOf(n, 1, true, 8), { x0: 3, z0: 1, x1: 5, z1: 1 })
	assert.deepEqual(bandOf(n, 3, true, 8), { x0: 3, z0: 0, x1: 5, z1: 1 })
	assert.equal(bandOf(n, 0, true, 8), null)
})

test('the walls fade out with the camera distance, but show round the cursor at any distance (#249)', () => {
	const r = revealRadius(1000)
	assert.equal(r, 120)
	assert.equal(revealRadius(10), 16)
	// Near the camera: whole, wherever the cursor is.
	assert.equal(wallFade(WALL_FADE_NEAR - 1, null, r), 1)
	assert.equal(wallFade(20, 5000, r), 1)
	// Across the map: gone, unless the cursor points near the wall.
	assert.equal(wallFade(WALL_FADE_FAR + 1, null, r), 0)
	assert.equal(wallFade(1000, 5000, r), 0)
	assert.equal(wallFade(1000, r * 0.5, r), 1)
	assert.equal(wallFade(1000, r * 1.5, r), 0)
	// In between, a smooth fade.
	const mid = wallFade((WALL_FADE_NEAR + WALL_FADE_FAR) / 2, null, r)
	assert.ok(mid > 0.4 && mid < 0.6, String(mid))
})
