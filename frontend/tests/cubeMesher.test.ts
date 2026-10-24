// Run with: bun test tests/cubeMesher.test.ts
// The cube meshes (#30) are ported from crates/client/src/mesher.rs; these are its tests, with the
// same triangle counts, so the editor and the game draw a world alike.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CubeWorld, ROTATION_COUNT, SHAPES, kindId } from '../src/lib/cubes/world.ts'
import { CUBE_HEIGHT, DOWN, FACE_NORMALS, NORTH, UP, fullFaces, hullFaces, shapeFaces, shapeHulls } from '../src/lib/cubes/shapes.ts'
import { CAP_BOTTOM, CAP_TOP, PART_GLOW, PART_LIQUID, PART_SOLID, cubeColour, meshChunk, themeOf, triangles } from '../src/lib/cubes/mesher.ts'

type P = [number, number, number]
const STONE = kindId('stone')
const DIRT = kindId('dirt')
const WATER = kindId('water')
const LAVA = kindId('lava')
const HALF = 1
const SLOPE = 2
const STAIRS = 3
const QUARTER = 4
const LADDER = 6

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: P, b: P): P => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

function area(normal: P, polygon: P[]) {
	const sum: P = [0, 0, 0]
	for (let i = 1; i < polygon.length - 1; i++) {
		const c = cross(sub(polygon[i], polygon[0]), sub(polygon[i + 1], polygon[0]))
		for (let a = 0; a < 3; a++) sum[a] += c[a]
	}
	return dot(sum, normal) * 0.5
}

const tris = (w: CubeWorld, cx: number, cz: number, layer: number, cap?: number) => triangles(meshChunk(w, cx, cz, layer, cap))

test('a full cube has six square faces wound outwards', () => {
	const faces = hullFaces(shapeHulls(0, 0)[0])
	assert.equal(faces.length, 6)
	for (const { normal, polygon } of faces) {
		assert.equal(polygon.length, 4)
		assert.ok(Math.abs(area(normal, polygon) - 1) < 1e-4)
		const centre: P = [0, 0, 0]
		for (const p of polygon) for (let a = 0; a < 3; a++) centre[a] += p[a] / 4
		assert.ok(dot(normal, sub(centre, [0.5, 0.5, 0.5])) > 0)
	}
	const boundaries = shapeFaces(0, 0).map((f) => f.boundary)
	for (let f = 0; f < 6; f++) assert.equal(boundaries.filter((b) => b === f).length, 1)
})

test('every shape and rotation has closed outward faces', () => {
	for (let shape = 0; shape < SHAPES.length; shape++) {
		for (let r = 0; r < ROTATION_COUNT; r++) {
			for (const hull of shapeHulls(shape, r)) {
				const faces = hullFaces(hull)
				assert.ok(faces.length >= 4, `${shape} ${r}`)
				const total: P = [0, 0, 0]
				for (const { normal, polygon } of faces) {
					const a = area(normal, polygon)
					assert.ok(a > 0, `${shape} ${r}`)
					for (let i = 0; i < 3; i++) total[i] += normal[i] * a
				}
				assert.ok(Math.hypot(...total) < 1e-3, `${shape} ${r}: a closed surface's area vectors sum to zero`)
			}
			// Every face a shape covers completely is one of its faces on that boundary.
			for (let f = 0; f < 6; f++) {
				if (!(fullFaces(shape, r) & (1 << f))) continue
				const on = shapeFaces(shape, r)
					.filter((x) => x.boundary === f)
					.reduce((s, x) => s + area(x.normal, x.polygon), 0)
				assert.ok(Math.abs(on - 1) < 1e-3, `${shape} ${r} face ${f}`)
			}
		}
	}
})

test('rotations turn the full faces as the game does', () => {
	// A slope faces north unturned; one quarter turn faces it east, and upside down keeps its back but covers the top.
	assert.equal(fullFaces(SLOPE, 0), (1 << DOWN) | (1 << NORTH))
	assert.equal(fullFaces(SLOPE, 1), (1 << DOWN) | (1 << 1))
	assert.equal(fullFaces(SLOPE, 4), (1 << UP) | (1 << NORTH))
	assert.deepEqual(FACE_NORMALS[NORTH], [0, 0, -1])
})

test('two cubes side by side hide the faces between them', () => {
	const w = new CubeWorld(1, 1)
	w.set(3, 3, 15, STONE)
	assert.equal(tris(w, 0, 0, 15), 12)
	w.set(4, 3, 15, STONE)
	assert.equal(tris(w, 0, 0, 15), 2 * 10)
	// One on top: in the chunk above, and it hides the first's top face.
	w.set(3, 3, 14, STONE)
	assert.equal(tris(w, 0, 0, 15), 4 * 2 + 5 * 2)
	assert.equal(tris(w, 0, 0, 14), 10)
})

test('a buried cube has no faces', () => {
	const w = new CubeWorld(1, 1)
	for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) for (let l = 14; l <= 16; l++) w.set(x, z, l, STONE)
	// The middle layer: the ring's outer side faces only.
	assert.equal(tris(w, 0, 0, 15), 4 * 3 * 2)
})

test('a slope hides only what it covers', () => {
	const w = new CubeWorld(1, 1)
	w.set(5, 5, 9, STONE)
	// Rising towards the wall (facing north): the wall shows 5 faces; the ramp its bottom, its slope and its two triangles.
	w.set(5, 6, 9, DIRT, SLOPE, 0)
	assert.equal(tris(w, 0, 0, 9), 5 * 2 + (2 + 2 + 1 + 1))
	// Turned away (facing south): the wall shows all 6, the ramp its full south face as well.
	w.set(5, 6, 9, DIRT, SLOPE, 2)
	assert.equal(tris(w, 0, 0, 9), 6 * 2 + (2 + 2 + 2 + 1 + 1))
})

test('matching partial faces hide each other', () => {
	const w = new CubeWorld(1, 1)
	// A slope alone: its bottom, its slope, its back and its two triangles.
	w.set(5, 5, 9, DIRT, SLOPE, 0)
	assert.equal(tris(w, 0, 0, 9), 2 + 2 + 2 + 1 + 1)
	// Two side by side facing the same way: the triangles between them are hidden.
	w.set(6, 5, 9, DIRT, SLOPE, 0)
	assert.equal(tris(w, 0, 0, 9), 2 * (2 + 2 + 2 + 1))
	// Facing opposite ways the triangles are mirrored and neither holds the other.
	w.set(6, 5, 9, DIRT, SLOPE, 2)
	assert.equal(tris(w, 0, 0, 9), 2 * (2 + 2 + 2 + 1 + 1))
	// A quarter against the high end of a slope's triangle lies inside it and is hidden.
	w.set(6, 5, 9, DIRT, QUARTER, 0)
	assert.equal(tris(w, 0, 0, 9), 2 + 2 + 2 + 1 + 1 + 5 * 2)
	// A ladder hides nothing: a half against its back keeps its side.
	w.set(5, 5, 9, 0)
	w.set(6, 5, 9, 0)
	w.set(5, 5, 9, STONE, HALF, 0)
	assert.equal(tris(w, 0, 0, 9), 12)
	w.set(5, 6, 9, kindId('wood'), LADDER, 2)
	assert.equal(tris(w, 0, 0, 9), 12 + 12)
})

test('a staircase draws no faces between its steps', () => {
	const w = new CubeWorld(1, 1)
	w.set(5, 5, 9, STONE, STAIRS, 0)
	// 8 boxes of 12 triangles, less each lower step's back against the next step's front.
	assert.equal(tris(w, 0, 0, 9), 8 * 12 - 7 * 2)
	// Two side by side: each step's side against the other's is hidden.
	w.set(6, 5, 9, STONE, STAIRS, 0)
	assert.equal(tris(w, 0, 0, 9), 2 * (8 * 12 - 7 * 2 - 8 * 2))
})

test('liquids hide only their own kind', () => {
	const w = new CubeWorld(1, 1)
	w.set(2, 2, 10, WATER)
	w.set(3, 2, 10, WATER)
	assert.equal(tris(w, 0, 0, 10), 2 * 10)
	// Stone next to water: the stone hides the water's face, the water not the stone's.
	w.set(3, 2, 10, STONE)
	const parts = meshChunk(w, 0, 0, 10)
	assert.equal(parts[PART_LIQUID]!.indices.length / 3, 10)
	assert.equal(parts[PART_SOLID]!.indices.length / 3, 12)
	w.set(5, 5, 10, LAVA)
	assert.equal(meshChunk(w, 0, 0, 10)[PART_GLOW]!.indices.length / 3, 12)
})

test('faces across a chunk border are hidden, and the world edge is drawn', () => {
	const w = new CubeWorld(2, 1)
	w.set(0, 0, 12, DIRT)
	assert.equal(tris(w, 0, 0, 12), 12)
	w.set(15, 3, 12, STONE)
	w.set(16, 3, 12, STONE)
	assert.equal(tris(w, 0, 0, 12), 12 + 10)
	assert.equal(tris(w, 1, 0, 12), 10)
})

test('positions are in metres from the chunk corner', () => {
	const w = new CubeWorld(1, 1)
	w.set(2, 5, 10, STONE)
	const p = meshChunk(w, 0, 0, 10)[PART_SOLID]!.positions
	let min = [Infinity, Infinity, Infinity]
	let max = [-Infinity, -Infinity, -Infinity]
	for (let i = 0; i < p.length; i += 3) {
		min = min.map((m, a) => Math.min(m, p[i + a]))
		max = max.map((m, a) => Math.max(m, p[i + a]))
	}
	assert.deepEqual(min, [6, 0, 15])
	assert.deepEqual(max, [9, CUBE_HEIGHT, 18])
})

test('a slice caps the faces its hidden side covered', () => {
	const w = CubeWorld.create(1, 1, true)
	// Solid dirt and stone: a layer in the middle shows only the world edge's sides.
	assert.equal(tris(w, 0, 0, 16), 4 * 16 * 2)
	// The top of layer 16 under layer 15, and its bottom over layer 17: a whole layer of squares each.
	assert.equal(tris(w, 0, 0, 16, CAP_TOP), 256 * 2)
	assert.equal(tris(w, 0, 0, 16, CAP_BOTTOM), 256 * 2)
	// The ground's top is open sky: nothing to cap. The metal hides the lava floor's bottom, but the
	// lava, a liquid, does not hide the metal's top, which is drawn anyway.
	assert.equal(tris(w, 0, 0, 10, CAP_TOP), 0)
	assert.equal(tris(w, 0, 0, 25, CAP_BOTTOM), 256 * 2)
	assert.equal(tris(w, 0, 0, 26, CAP_TOP), 0)
})

test('a chunk deep in the themed world away from its edge draws nothing', () => {
	const w = CubeWorld.create(3, 3, true)
	assert.equal(tris(w, 1, 1, 17), 0)
	assert.ok(tris(w, 1, 1, 10) > 0)
})

test('colours follow kind and theme', () => {
	assert.notDeepEqual(cubeColour(STONE, 10), cubeColour(STONE, 18))
	assert.notDeepEqual(cubeColour(STONE, 10), cubeColour(DIRT, 10))
	assert.ok(cubeColour(WATER, 10)[3] < 1)
	assert.equal(cubeColour(STONE, 10)[3], 1)
	assert.deepEqual([0, 9, 10, 11, 14, 15, 20, 21, 25, 26, 30].map(themeOf), [0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 5])
})
