// Run with: bun test tests/cubeClip.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CubeWorld, GROUND_LAYER, ROTATION_COUNT, SHAPES, kindId } from '../src/lib/cubes/world.ts'
import { shapeHulls } from '../src/lib/cubes/shapes.ts'
import { CubeChanges, FIRST_METAL_LAYER, MAX_BOX_CUBES, boxOf } from '../src/lib/cubes/edit.ts'
import { boxAt, boxBlock, clipCount, copyBox, emptyBox, moveBox, mirrorClip, moveBoxBy, pasteClip, sameBox, turnClip } from '../src/lib/cubes/clip.ts'

const STONE = kindId('stone')
const WOOD = kindId('wood')
const SLOPE = 2
const UP = GROUND_LAYER - 1

/** A small world with a stone L on the ground: (2, 2), (3, 2) and (2, 3), and a wood slope on (3, 2). */
function lWorld() {
	const w = new CubeWorld(1, 1)
	w.set(2, 2, UP, STONE)
	w.set(3, 2, UP, STONE)
	w.set(2, 3, UP, STONE)
	w.set(3, 2, UP - 1, WOOD, SLOPE, 0)
	return w
}

test('a box copies its cubes, empty ones too, relative to its corner', () => {
	const w = lWorld()
	const box = boxOf({ x: 2, z: 2, layer: UP }, { x: 3, z: 3, layer: UP }, 1)
	assert.deepEqual(box, { x0: 2, x1: 3, z0: 2, z1: 3, top: UP - 1, bottom: UP })
	const c = copyBox(w, box)
	assert.equal(c.w * c.d * c.h, 8)
	assert.equal(clipCount(c), 4)
	// The top layer comes first: the slope at (1, 0) of it.
	assert.equal(c.cubes[1] & 0xff, WOOD)
	assert.equal((c.cubes[1] >> 8) & 0xff, SLOPE)
	assert.equal(c.cubes[4 + 3] & 0xff, 0)
})

test('a paste puts the cubes at the box and leaves the world be where the clip is empty', () => {
	const w = lWorld()
	const clip = copyBox(w, boxOf({ x: 2, z: 2, layer: UP }, { x: 3, z: 3, layer: UP }, 1))
	w.set(11, 11, UP, WOOD)
	const changes = new CubeChanges(w)
	const r = pasteClip(changes, clip, boxAt(10, 10, UP, clip.w, clip.d, clip.h))
	assert.deepEqual(r, { placed: 4, refused: 0 })
	assert.equal(w.get(10, 10, UP).kind, STONE)
	assert.equal(w.get(11, 10, UP - 1).shape, SLOPE)
	// (11, 11) is empty in the clip: the wood stays.
	assert.equal(w.get(11, 11, UP).kind, WOOD)
	changes.undo()
	assert.equal(w.get(10, 10, UP).kind, 0)
	assert.equal(w.get(11, 11, UP).kind, WOOD)
})

test('a paste over the edge or into the metal leaves those cubes out', () => {
	const w = lWorld()
	const clip = copyBox(w, boxOf({ x: 2, z: 2, layer: UP }, { x: 3, z: 3, layer: UP }))
	const r = pasteClip(new CubeChanges(w), clip, boxAt(15, 0, UP, clip.w, clip.d, clip.h))
	// (15, 0) and (15, 1) are in; (16, 0) is outside.
	assert.deepEqual(r, { placed: 2, refused: 1 })
	const m = pasteClip(new CubeChanges(w), clip, boxAt(5, 5, FIRST_METAL_LAYER, clip.w, clip.d, clip.h))
	assert.deepEqual(m, { placed: 0, refused: 3 })
})

test('a quarter turn turns the places and the cubes alike, and four turns are none', () => {
	const w = lWorld()
	const box = boxOf({ x: 2, z: 2, layer: UP }, { x: 3, z: 2, layer: UP }, 1)
	const clip = copyBox(w, box)
	const t = turnClip(clip)
	assert.deepEqual([t.w, t.d, t.h], [1, 2, 2])
	// (x, z) goes to (d - 1 - z, x): the slope at (1, 0) of the top layer goes to (0, 1), turned a quarter.
	const slope = t.cubes[(0 * t.d + 1) * t.w + 0]
	assert.equal(slope & 0xff, WOOD)
	assert.equal((slope >> 16) & 3, 1)
	let back = clip
	for (let i = 0; i < 4; i++) back = turnClip(back)
	assert.deepEqual([back.w, back.d, back.h], [clip.w, clip.d, clip.h])
	assert.deepEqual([...back.cubes], [...clip.cubes])
})

test('a mirrored clip moves the places and every shape stays its own mirror image', () => {
	// Hulls as sorted point strings, so two cubes compare by what they fill.
	const key = (shape: number, rot: number, f: (p: number[]) => number[]) =>
		shapeHulls(shape, rot)
			.map((h) => h.map((p) => f(p).map((v) => v.toFixed(4)).join(',')).sort().join(';'))
			.sort()
			.join('|')
	for (const axis of ['x', 'z'] as const) {
		const mirror = axis === 'x' ? (p: number[]) => [1 - p[0], p[1], p[2]] : (p: number[]) => [p[0], p[1], 1 - p[2]]
		for (let shape = 0; shape < SHAPES.length; shape++) {
			for (let rot = 0; rot < ROTATION_COUNT; rot++) {
				const clip = { w: 1, d: 1, h: 1, cubes: Uint32Array.of(STONE | (shape << 8) | (rot << 16)) }
				const m = mirrorClip(clip, axis).cubes[0]
				assert.equal(m & 0xff, STONE)
				assert.equal(key((m >> 8) & 0xff, (m >> 16) & 0xff, (p) => p), key(shape, rot, mirror), `${SHAPES[shape].name} ${rot} across ${axis}`)
			}
		}
	}
	// Places: a 3 by 2 clip's (0, 0) goes to (2, 0) across x and to (0, 1) across z; twice is no change.
	const c = { w: 3, d: 2, h: 1, cubes: Uint32Array.from([STONE, 0, 0, 0, 0, 0]) }
	assert.equal(mirrorClip(c, 'x').cubes[2], STONE)
	assert.equal(mirrorClip(c, 'z').cubes[3], STONE)
	assert.deepEqual([...mirrorClip(mirrorClip(c, 'z'), 'z').cubes], [...c.cubes])
})

test('a move carries the box and empties where it was, as one undo', () => {
	const w = lWorld()
	const box = boxOf({ x: 2, z: 2, layer: UP }, { x: 3, z: 3, layer: UP }, 1)
	const changes = new CubeChanges(w)
	assert.equal(moveBox(changes, box, 1, 0, 0), '')
	assert.equal(moveBox(changes, moveBoxBy(box, 1, 0, 0), 0, 0, -1), '')
	assert.equal(w.get(2, 2, UP).kind, 0)
	assert.equal(w.get(3, 2, UP - 1).kind, STONE)
	assert.equal(w.get(4, 2, UP - 2).shape, SLOPE)
	changes.undo()
	assert.deepEqual(copyBox(w, box), copyBox(lWorld(), box))
	assert.equal(w.get(4, 2, UP - 2).kind, 0)
})

test('a move that would lose a cube is refused and changes nothing', () => {
	const w = lWorld()
	const box = boxOf({ x: 2, z: 2, layer: UP }, { x: 3, z: 3, layer: UP })
	const changes = new CubeChanges(w)
	assert.match(moveBox(changes, box, -3, 0, 0), /outside the world/)
	assert.match(moveBox(changes, box, 0, 0, FIRST_METAL_LAYER - UP), /metal/)
	assert.equal(changes.size, 0)
	// Empty columns of the box may go over the edge.
	assert.equal(moveBox(changes, boxOf({ x: 0, z: 2, layer: UP }, { x: 3, z: 3, layer: UP }), -2, 0, 0), '')
	assert.equal(w.get(0, 2, UP).kind, STONE)
})

test('emptying a box, and the box size limit', () => {
	const w = lWorld()
	const changes = new CubeChanges(w)
	assert.equal(emptyBox(changes, boxOf({ x: 0, z: 0, layer: UP }, { x: 5, z: 5, layer: UP }, 1)), 4)
	assert.equal(clipCount(copyBox(w, boxAt(0, 0, UP, 6, 6, 2))), 0)
	assert.equal(boxBlock(boxAt(0, 0, 9, 64, 64, 16)), '')
	assert.match(boxBlock(boxAt(0, 0, 9, 64, 64, 17)), new RegExp(`${MAX_BOX_CUBES}`))
	assert.ok(sameBox(boxAt(1, 2, 9, 2, 2, 2), { x0: 1, x1: 2, z0: 2, z1: 3, top: 8, bottom: 9 }))
})
