// The geometry of the cube shapes: their hulls and full faces in every rotation generated from
// crates/world/src/shape.rs (shapes.generated.ts), the rotations ported from it, and the hulls' faces
// and which neighbours hide them ported from crates/client/src/mesher.rs, so a world looks alike in the
// editor and the game. Points are in the cube's own unit space, [x, y, z] each in 0..1, y up, before
// scaling by CUBE_SIZE. Keep the ported parts in step with the Rust.

import { SHAPES, ROTATION_COUNT } from './world'
import { GENERATED_SHAPES } from './shapes.generated'

/** The width and depth of a cube in metres (crates/world CUBE_SIZE). */
export const CUBE_SIZE = 3

/**
 * The height of a cube in metres, so of a layer (3dgame #221): set apart from its width, so a storey can
 * be taller than a cube is wide. The shapes are made in a unit cube and stretch to it, so a slope or a
 * stair gets steeper and a door or a window taller. The game still makes cubes CUBE_SIZE tall until it
 * follows (#222), so a prop's height in metres reads differently in the two until then.
 */
export const CUBE_HEIGHT = 5

/** A cube's size in metres along x, y and z. */
export const CUBE_DIMS = [CUBE_SIZE, CUBE_HEIGHT, CUBE_SIZE] as const

/** Face ids, as crates/world's `Face`: north -z, east +x, south +z, west -x, up +y, down -y. */
export const NORTH = 0
export const EAST = 1
export const SOUTH = 2
export const WEST = 3
export const UP = 4
export const DOWN = 5

/** Each face's outward direction. */
export const FACE_NORMALS: readonly (readonly [number, number, number])[] = [
	[0, 0, -1],
	[1, 0, 0],
	[0, 0, 1],
	[-1, 0, 0],
	[0, 1, 0],
	[0, -1, 0],
]

/** The face on the other side of the cube. */
export const opposite = (face: number) => (face < 4 ? (face + 2) % 4 : face === UP ? DOWN : UP)

type Point = [number, number, number]

/** `rotation` with the parts that do not change `shape` dropped (Shape::normalize). */
export function normalizeRotation(shape: number, rotation: number) {
	const s = SHAPES[shape]
	return (s.turns ? rotation & 3 : 0) | (s.flips ? rotation & 4 : 0)
}

/** Where an unrotated shape's `face` ends up under `rotation` (Rotation::face). */
export function rotateFace(rotation: number, face: number) {
	if (face >= 4) return rotation & 4 ? opposite(face) : face
	return (face + (rotation & 3)) % 4
}

/** Where an unrotated shape's point ends up (Rotation::point): upside down, then quarter turns clockwise seen from above. */
export function rotatePoint(rotation: number, [x0, y0, z0]: Point): Point {
	const y = rotation & 4 ? 1 - y0 : y0
	let x = x0
	let z = z0
	for (let i = 0; i < (rotation & 3); i++) [x, z] = [1 - z, x]
	return [x, y, z]
}

/**
 * One face of a shape's hull: its outward normal, its corners (counter-clockwise from outside) and the
 * cube face it lies on, or -1. `hiddenBy[shape * ROTATION_COUNT + rotation]` is 1 where a neighbour of
 * that shape and rotation across `boundary` hides it (covers in the client's mesher): with a face it
 * covers completely, or with a face of its own there that holds all of this one; a ladder only with
 * a full face. All 0 for a face inside the cube.
 */
export interface ShapeFace {
	boundary: number
	normal: Point
	polygon: Point[]
	hiddenBy: Uint8Array
	/** The cube face whose paint it shows (paintSideOf). */
	paintFace: number
}

const EPS = 1e-4
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Point, b: Point): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/**
 * The faces of the convex hull of `points` (hull_faces in the client's mesher): each face's outward
 * normal and its corners in counter-clockwise order seen from outside. Brute force over every plane
 * through three points, quick for the few corners a shape's hull has.
 */
export function hullFaces(points: Point[]): { normal: Point; polygon: Point[] }[] {
	const pts: Point[] = []
	for (const p of points) if (!pts.some((q) => dist(q, p) < EPS)) pts.push(p)
	const faces: { normal: Point; polygon: Point[] }[] = []
	for (let i = 0; i < pts.length; i++) {
		for (let j = i + 1; j < pts.length; j++) {
			for (let k = j + 1; k < pts.length; k++) {
				const c = cross(sub(pts[j], pts[i]), sub(pts[k], pts[i]))
				const len = Math.hypot(c[0], c[1], c[2])
				if (len < 1e-12) continue
				let normal: Point = [c[0] / len, c[1] / len, c[2] / len]
				const side = (p: Point) => dot(normal, sub(p, pts[i]))
				if (pts.every((p) => side(p) <= EPS)) {
					// outward already
				} else if (pts.every((p) => side(p) >= -EPS)) {
					normal = [-normal[0], -normal[1], -normal[2]]
				} else continue
				const offset = dot(normal, pts[i])
				if (faces.some((f) => dot(f.normal, normal) > 1 - EPS && Math.abs(dot(f.normal, f.polygon[0]) - offset) < EPS)) continue
				const polygon = pts.filter((p) => Math.abs(dot(normal, p) - offset) < EPS)
				const centre: Point = [0, 0, 0]
				for (const p of polygon) for (let a = 0; a < 3; a++) centre[a] += p[a] / polygon.length
				const u0 = sub(polygon[0], centre)
				const ul = Math.hypot(u0[0], u0[1], u0[2])
				const u: Point = [u0[0] / ul, u0[1] / ul, u0[2] / ul]
				const v = cross(normal, u)
				const angle = (p: Point) => Math.atan2(dot(sub(p, centre), v), dot(sub(p, centre), u))
				polygon.sort((a, b) => angle(a) - angle(b))
				faces.push({ normal, polygon })
			}
		}
	}
	return faces
}

/** The cube face a hull face lies on, or -1 when it lies inside the cube (boundary_face). */
function boundaryFace(normal: Point, polygon: Point[]) {
	for (let f = 0; f < 6; f++) {
		const n = FACE_NORMALS[f]
		const plane = n[0] + n[1] + n[2] > 0 ? 1 : 0
		const abs: Point = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])]
		if (dot(normal, n as Point) > 1 - EPS && polygon.every((p) => Math.abs(dot(p, abs) - plane) < EPS)) return f
	}
	return -1
}

/**
 * The cube face whose paint a shape's face shows (paint_face in the client's mesher): the one it lies
 * on, or for a face inside the cube the one its normal points most towards, up or down when that ties
 * with a side (a slope's slope is its top).
 */
export function paintSideOf(boundary: number, n: Point) {
	if (boundary >= 0) return boundary
	const x = Math.abs(n[0])
	const y = Math.abs(n[1])
	const z = Math.abs(n[2])
	if (y >= x - EPS && y >= z - EPS) return n[1] > 0 ? UP : DOWN
	if (x >= z) return n[0] > 0 ? EAST : WEST
	return n[2] > 0 ? SOUTH : NORTH
}

/** Whether the convex polygon of `outer` holds every one of `points`, which lie in its plane (holds). */
function holds(outer: { normal: Point; polygon: Point[] }, points: Point[]) {
	const poly = outer.polygon
	return points.every((q) => poly.every((a, i) => dot(cross(sub(poly[(i + 1) % poly.length], a), sub(q, a)), outer.normal) >= -EPS))
}

/** Whether `face`, inside the cube, lies against a face of another of the shape's hulls facing the other way that holds all of it (against_another_hull). */
function againstAnotherHull(face: { boundary: number; normal: Point; polygon: Point[] }, faces: { normal: Point; polygon: Point[] }[]) {
	return face.boundary < 0 && faces.some((o) => dot(o.normal, face.normal) < -1 + EPS && Math.abs(dot(o.normal, sub(face.polygon[0], o.polygon[0]))) < EPS && holds(o, face.polygon))
}

/** Every shape's faces in every rotation, built once: `[shape id][rotation id]`, less those inside the cube against another of its hulls (a staircase's steps). */
const SHAPE_FACES: ShapeFace[][][] = GENERATED_SHAPES.map((g) => {
	const byRotation: ShapeFace[][] = []
	for (let r = 0; r < ROTATION_COUNT; r++) {
		const faces: ShapeFace[] = []
		for (const hull of g.hulls[r]) {
			for (const { normal, polygon } of hullFaces(hull)) {
				const boundary = boundaryFace(normal, polygon)
				faces.push({ boundary, normal, polygon, hiddenBy: new Uint8Array(SHAPES.length * ROTATION_COUNT), paintFace: paintSideOf(boundary, normal) })
			}
		}
		byRotation.push(faces.filter((f) => !againstAnotherHull(f, faces)))
	}
	return byRotation
})

/** The faces covered completely, as bits by face id, `[shape id * ROTATION_COUNT + rotation id]`. */
const FULL_FACES = new Uint8Array(SHAPES.length * ROTATION_COUNT)
for (let shape = 0; shape < SHAPES.length; shape++) {
	for (let r = 0; r < ROTATION_COUNT; r++) FULL_FACES[shape * ROTATION_COUNT + r] = GENERATED_SHAPES[shape].fullFaces[r]
}

// Which neighbours hide each boundary face: one with a full face there, or (but for a climbable shape,
// a ladder, whose rungs have gaps) one with a face of its own there that holds it, in the neighbour's unit space,
// moved one cube across the boundary.
for (let sa = 0; sa < SHAPES.length; sa++) {
	for (let ra = 0; ra < ROTATION_COUNT; ra++) {
		for (const face of SHAPE_FACES[sa][ra]) {
			const side = face.boundary
			if (side < 0) continue
			const touching = opposite(side)
			const n = FACE_NORMALS[side]
			const moved = face.polygon.map((p): Point => [p[0] - n[0], p[1] - n[1], p[2] - n[2]])
			for (let sb = 0; sb < SHAPES.length; sb++) {
				for (let rb = 0; rb < ROTATION_COUNT; rb++) {
					const full = (FULL_FACES[sb * ROTATION_COUNT + rb] & (1 << touching)) !== 0
					const held = !GENERATED_SHAPES[sb].climbable && SHAPE_FACES[sb][rb].some((o) => o.boundary === touching && holds(o, moved))
					face.hiddenBy[sb * ROTATION_COUNT + rb] = full || held ? 1 : 0
				}
			}
		}
	}
}

/** The faces of `shape` turned by `rotation`. */
export const shapeFaces = (shape: number, rotation: number): readonly ShapeFace[] => SHAPE_FACES[shape][rotation]

/** The faces `shape` turned by `rotation` covers completely, as bits by face id. */
export const fullFaces = (shape: number, rotation: number) => FULL_FACES[shape * ROTATION_COUNT + rotation]

/** The hulls of `shape` turned by `rotation`, for tests. */
export const shapeHulls = (shape: number, rotation: number): Point[][] => GENERATED_SHAPES[shape].hulls[rotation]
