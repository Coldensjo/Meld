// Joined cubes and attached objects in the editor (#32): attaching doors, windows, levers, buttons,
// teleporters and torches to the faces of cubes, linking an object to what it acts on (a lever to its door, a
// teleporter to the pad it leads to), joining cubes into groups and splitting them, each as one History
// step, and where an object is drawn in its cube (Object::extent, ported from crates/world/src/object.rs).
// The rules are those of the game's reader (worldfile.checkJoinsAndObjects, World::attach, World::join):
// a group has two cubes or more and a cube is in one group at most, ids are unique (a new one is the
// highest plus one), an object never acts on itself or on one twice. Pure data, with no three.js, so it
// runs in the unit tests.

import { FIRE_COLOURS, OBJECT_KINDS, SHAPES, type CubeWorld, type SpawnPoint, type WorldJoin, type WorldMonster, type WorldObject, type WorldProp } from './world'
import { DOWN, EAST, NORTH, SOUTH, UP, WEST, opposite, rotatePoint, normalizeRotation, shapeHulls } from './shapes'
import { GENERATED_SHAPES, type GeneratedHole } from './shapes.generated'
import { SOLID } from './mesher'
import { editBlock } from './edit'
import type { CubeAt } from './pick'
import type { CubeBox } from './clip'
import type { Command } from '../state/historyCore'

export const DOOR = 0
export const WINDOW = 1
export const LEVER = 2
export const BUTTON = 3
export const TELEPORTER = 4
export const TORCH = 5
/** Each kind's colour, by object kind id: door, window, lever, button, teleporter, torch (the marks in the world and the palette's tiles). */
export const OBJECT_COLOURS = [0x8a5a2b, 0x9fd8ff, 0xc8c8c8, 0xd04040, 0xb060ff, 0xff9a30]

/** Each fire colour's colour, by FIRE_COLOURS id: orange, green, blue, purple (a torch's mark in the world). */
export const FIRE_MARK_COLOURS = [0xff9a30, 0x5cff3a, 0x4a9aff, 0xb060ff]

/** Faces by id, in words (crates/world Face). */
export const FACE_WORDS = ['north', 'east', 'south', 'west', 'top', 'bottom'] as const

/** Shape ids of the openings (world.ts SHAPES). */
const DOORWAY_SHAPE = SHAPES.findIndex((s) => s.name === 'doorway')
const WINDOW_SHAPE = SHAPES.findIndex((s) => s.name === 'window')

/** An object in words: its kind and id. */
export const objectWords = (o: WorldObject) => `${o.kind === TORCH && o.colour ? `${FIRE_COLOURS[o.colour] ?? 'strange'} ` : ''}${OBJECT_KINDS[o.kind] ?? 'object'} ${o.id}`

const samePos = (a: SpawnPoint, b: CubeAt) => a.x === b.x && a.z === b.z && a.layer === b.layer

/** The objects on cube `at`, in the world's order. */
export function objectsOn(world: CubeWorld, at: CubeAt): WorldObject[] {
	return world.objects.filter((o) => samePos(o.pos, at))
}

/** The object a click on `face` of cube `at` means: the one on that face, else the first on the cube, else null. */
export function objectAt(world: CubeWorld, at: CubeAt, face: number): WorldObject | null {
	const on = objectsOn(world, at)
	return on.find((o) => o.face === face) ?? on[0] ?? null
}

/** The group cube `at` is in, or null. */
export function groupOf(world: CubeWorld, at: CubeAt): WorldJoin | null {
	return world.joins.find((j) => j.cubes.some((c) => samePos(c, at))) ?? null
}

/** A new id for one of `items`: the highest plus one. */
export const nextId = (items: { id: number }[]) => items.reduce((m, it) => Math.max(m, it.id + 1), 1)

/**
 * Attaches an object of `kind` to `face` of cube `at`, off (closed): a teleporter always goes on the
 * top, and a torch burns fire colour `colour` (FIRE_COLOURS; the other kinds ignore it). Returns the
 * new object, or why it cannot be: the cube is empty or not editable, or that face has an object
 * already.
 */
export function attachObject(world: CubeWorld, kind: number, at: CubeAt, face: number, colour = 0): WorldObject | string {
	if (!(kind >= 0 && kind < OBJECT_KINDS.length)) return `unknown object kind ${kind}`
	const why = editBlock(world, at.x, at.z, at.layer)
	if (why) return `nothing is attached ${why}`
	if (world.get(at.x, at.z, at.layer).kind === 0) return 'objects are attached to cubes, and that cell is empty'
	if (kind === TELEPORTER) face = UP
	if (!(face >= 0 && face < FACE_WORDS.length)) return 'point at a face of the cube'
	const there = world.objects.find((o) => samePos(o.pos, at) && o.face === face)
	if (there) return `the ${FACE_WORDS[face]} of that cube has ${objectWords(there)} already`
	const o: WorldObject = { id: nextId(world.objects), kind, face, pos: { x: at.x, z: at.z, layer: at.layer }, targets: [], state: 0, colour: kind === TORCH && colour >= 0 && colour < FIRE_COLOURS.length ? colour : 0 }
	world.objects.push(o)
	return o
}

/** Makes torch `id` burn fire colour `colour` (FIRE_COLOURS). Returns why not, or null. */
export function setFireColour(world: CubeWorld, id: number, colour: number): string | null {
	const o = world.objects.find((it) => it.id === id)
	if (!o) return 'no such object'
	if (o.kind !== TORCH) return 'only a torch burns a colour'
	if (!(colour >= 0 && colour < FIRE_COLOURS.length)) return `unknown fire colour ${colour}`
	o.colour = colour
	return null
}

/** Removes object `id`, and drops it from what the others act on (World::detach). Returns whether it was there. */
export function detachObject(world: CubeWorld, id: number): boolean {
	const i = world.objects.findIndex((o) => o.id === id)
	if (i < 0) return false
	world.objects.splice(i, 1)
	for (const o of world.objects) {
		const t = o.targets.indexOf(id)
		if (t >= 0) o.targets.splice(t, 1)
	}
	return true
}

/**
 * Makes object `from` act on `to`, or stops it when it already does. A teleporter leads to one other
 * teleporter, so linking it replaces where it led; the other kinds act on doors, windows, levers and
 * buttons, never a teleporter (it has no state to change). A torch neither acts nor is acted on.
 * Returns what happened, or why not.
 */
export function toggleLink(world: CubeWorld, from: number, to: number): { linked: boolean } | string {
	const a = world.objects.find((o) => o.id === from)
	const b = world.objects.find((o) => o.id === to)
	if (!a || !b) return 'no such object'
	if (a.id === b.id) return 'an object cannot act on itself'
	const i = a.targets.indexOf(b.id)
	if (i >= 0) {
		a.targets.splice(i, 1)
		return { linked: false }
	}
	if (a.kind === TORCH || b.kind === TORCH) return 'a torch only burns: it acts on nothing, and nothing acts on it'
	if (a.kind === TELEPORTER) {
		if (b.kind !== TELEPORTER) return 'a teleporter leads to another teleporter'
		a.targets = [b.id]
		return { linked: true }
	}
	if (b.kind === TELEPORTER) return `a ${OBJECT_KINDS[a.kind]} cannot act on a teleporter, which has nothing to switch`
	a.targets.push(b.id)
	return { linked: true }
}

/** The cubes of a box that are not empty and can be edited. */
export function cubesIn(world: CubeWorld, box: CubeBox): CubeAt[] {
	const out: CubeAt[] = []
	for (let layer = box.top; layer <= box.bottom; layer++) {
		for (let z = box.z0; z <= box.z1; z++) {
			for (let x = box.x0; x <= box.x1; x++) {
				if (!editBlock(world, x, z, layer) && world.get(x, z, layer).kind !== 0) out.push({ x, z, layer })
			}
		}
	}
	return out
}

/** Takes cubes out of whatever groups they are in, dropping a group left with fewer than two. */
export function unjoin(world: CubeWorld, cubes: CubeAt[]) {
	const taken = new Set(cubes.map((c) => `${c.x},${c.z},${c.layer}`))
	for (const j of world.joins) j.cubes = j.cubes.filter((c) => !taken.has(`${c.x},${c.z},${c.layer}`))
	world.joins = world.joins.filter((j) => j.cubes.length >= 2)
}

/**
 * Joins `cubes` into one new group, taking them out of the groups they were in (World::join refuses a
 * cube already joined; here the newer group wins). Returns the group, or why not: fewer than two cubes.
 */
export function joinCubes(world: CubeWorld, cubes: CubeAt[]): WorldJoin | string {
	if (cubes.length < 2) return 'a group needs two cubes or more that are not empty'
	unjoin(world, cubes)
	const j: WorldJoin = { id: nextId(world.joins), cubes: cubes.map((c) => ({ x: c.x, z: c.z, layer: c.layer })) }
	world.joins.push(j)
	return j
}

/** Splits every group that has a cube among `cubes` (World::split). Returns how many there were. */
export function splitCubes(world: CubeWorld, cubes: CubeAt[]): number {
	const taken = new Set(cubes.map((c) => `${c.x},${c.z},${c.layer}`))
	const before = world.joins.length
	world.joins = world.joins.filter((j) => !j.cubes.some((c) => taken.has(`${c.x},${c.z},${c.layer}`)))
	return before - world.joins.length
}

/** The groups with a cube in `box`. */
export function groupsIn(world: CubeWorld, box: CubeBox): WorldJoin[] {
	const inside = (c: SpawnPoint) => c.x >= box.x0 && c.x <= box.x1 && c.z >= box.z0 && c.z <= box.z1 && c.layer >= box.top && c.layer <= box.bottom
	return world.joins.filter((j) => j.cubes.some(inside))
}

/** Splits every group with a cube in `box`. Returns how many there were. */
export function splitBox(world: CubeWorld, box: CubeBox): number {
	const gone = new Set(groupsIn(world, box))
	world.joins = world.joins.filter((j) => !gone.has(j))
	return gone.size
}

/** A copy of a world's groups, objects, monster spawn points and props (#177), to undo an edit of them. */
export interface ObjectsSnapshot {
	joins: WorldJoin[]
	objects: WorldObject[]
	monsters: WorldMonster[]
	props: WorldProp[]
}

export function snapshotObjects(from: ObjectsSnapshot): ObjectsSnapshot {
	return {
		joins: from.joins.map((j) => ({ id: j.id, cubes: j.cubes.map((c) => ({ ...c })) })),
		objects: from.objects.map((o) => ({ ...o, pos: { ...o.pos }, targets: [...o.targets] })),
		monsters: from.monsters.map((m) => ({ kind: m.kind, pos: { ...m.pos } })),
		props: from.props.map((p) => ({ ...p })),
	}
}

export function restoreObjects(world: CubeWorld, s: ObjectsSnapshot) {
	const copy = snapshotObjects(s)
	world.joins = copy.joins
	world.objects = copy.objects
	world.monsters = copy.monsters
	world.props = copy.props
}

/**
 * Runs `edit` on the world's groups and objects as one History step: a copy before and after, the undo
 * and redo putting one back and calling `changed` (to redraw them). Returns `edit`'s result; nothing
 * is recorded when it changed nothing.
 */
export function editObjects<T>(world: CubeWorld, history: { push(cmd: Command): void }, label: string, changed: () => void, edit: () => T): T {
	const before = snapshotObjects(world)
	const out = edit()
	const after = snapshotObjects(world)
	if (JSON.stringify(before) === JSON.stringify(after)) return out
	changed()
	history.push({
		label,
		bytes: JSON.stringify(after).length * 4,
		undo: () => {
			restoreObjects(world, before)
			changed()
		},
		redo: () => {
			restoreObjects(world, after)
			changed()
		},
	})
	return out
}

// Where an object is in its cube (Object::extent), as (min, max) corners in cube unit space.

/** How long a torch's stick is (TORCH_LENGTH). */
const TORCH_LENGTH = 0.2

/** How thick a door or a window is (PANE_DEPTH). */
const PANE_DEPTH = 0.05

type V3 = [number, number, number]

/** The axes of a box against `face`: the face's own, then the two along it (face_axes). */
function faceAxes(face: number): [number, number, number] {
	if (face === NORTH || face === SOUTH) return [2, 0, 1]
	if (face === EAST || face === WEST) return [0, 2, 1]
	return [1, 0, 2]
}

/** Whether a face's outward normal points along its axis's positive direction. */
const facePositive = (face: number) => face === EAST || face === SOUTH || face === UP

/** The box against `face`: `depth` from the face into the cube (negative is out of it), `across` and `up` along it (on_face). */
function onFace(face: number, depth: [number, number], across: [number, number], up: [number, number]): [V3, V3] {
	const [a, b, c] = faceAxes(face)
	const min: V3 = [0, 0, 0]
	const max: V3 = [0, 0, 0]
	if (facePositive(face)) {
		min[a] = 1 - depth[1]
		max[a] = 1 - depth[0]
	} else {
		min[a] = depth[0]
		max[a] = depth[1]
	}
	min[b] = across[0]
	max[b] = across[1]
	min[c] = up[0]
	max[c] = up[1]
	return [min, max]
}

type Opening = 'doorway' | 'window'

/** An opening's hole unturned, from the north face to the south (Hole::bounds). */
function holeBox(hole: GeneratedHole): [V3, V3] {
	return [
		[0.5 - hole.width / 2, hole.bottom, 0],
		[0.5 + hole.width / 2, hole.top, 1],
	]
}

/** The hole of the opening's own shape, the doorway's or the window's (Opening::hole). */
const OPENING_HOLES: Record<Opening, GeneratedHole> = {
	doorway: GENERATED_SHAPES[DOORWAY_SHAPE].hole!,
	window: GENERATED_SHAPES[WINDOW_SHAPE].hole!,
}

/** The hole a door or window on `face` of a cube shuts, as its (across, up) ranges (hole): the cube's own when its shape has a hole for that opening through `face`, else the opening's own hole cut through that face. Then whether the cube's own hole has its corners cut off (Hole::cut_corners). */
function hole(opening: Opening, shape: number, rotation: number, kind: number, face: number): [[number, number], [number, number], boolean] {
	const [a, b, c] = faceAxes(face)
	const turned = (h: GeneratedHole, r: number): [V3, V3] => {
		const [lo, hi] = holeBox(h)
		const p = rotatePoint(r, lo)
		const q = rotatePoint(r, hi)
		return [[0, 1, 2].map((i) => Math.min(p[i], q[i])) as V3, [0, 1, 2].map((i) => Math.max(p[i], q[i])) as V3]
	}
	const own = GENERATED_SHAPES[shape]?.hole
	if (kind !== 0 && own && own.opening === opening) {
		const [min, max] = turned(own, normalizeRotation(shape, rotation))
		if (max[a] - min[a] > 0.99) return [[min[b], max[b]], [min[c], max[c]], own.cutCorners]
	}
	if (face < 4) {
		const [min, max] = turned(OPENING_HOLES[opening], face)
		return [[min[b], max[b]], [min[c], max[c]], false]
	}
	const [min, max] = holeBox(OPENING_HOLES[opening])
	const w = max[0] - min[0]
	const h = max[1] - min[1]
	return [[0.5 - w / 2, 0.5 + w / 2], [0.5 - h / 2, 0.5 + h / 2], false]
}

type Plane = [V3, number]

/** The planes bounding the convex hull of `points`, (normal, d) with the hull where normal · p <= d (hull_planes). */
function hullPlanes(points: readonly (readonly number[])[]): Plane[] {
	const EPS = 1e-5
	const out: Plane[] = []
	const n = points.length
	for (let i = 0; i < n; i++) {
		const p = points[i]
		for (let j = i + 1; j < n; j++) {
			for (let k = j + 1; k < n; k++) {
				const e = [points[j][0] - p[0], points[j][1] - p[1], points[j][2] - p[2]]
				const f = [points[k][0] - p[0], points[k][1] - p[1], points[k][2] - p[2]]
				let normal: V3 = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]]
				const len = Math.hypot(normal[0], normal[1], normal[2])
				if (len < EPS) continue
				normal = [normal[0] / len, normal[1] / len, normal[2] / len]
				const side = (s: readonly number[]) => normal[0] * (s[0] - p[0]) + normal[1] * (s[1] - p[1]) + normal[2] * (s[2] - p[2])
				const dot = (m: V3) => m[0] * p[0] + m[1] * p[1] + m[2] * p[2]
				if (points.every((s) => side(s) <= EPS)) out.push([normal, dot(normal)])
				else if (points.every((s) => side(s) >= -EPS)) {
					const flipped: V3 = [-normal[0], -normal[1], -normal[2]]
					out.push([flipped, dot(flipped)])
				}
			}
		}
	}
	return out
}

/** Where a ray along axis `a` through (u, v) on axes b and c first meets the solid bounded by `planes`, as a depth in from the face (ray_depth); null if it misses. */
function rayDepth(planes: Plane[], a: number, b: number, c: number, positive: boolean, u: number, v: number): number | null {
	const EPS = 1e-5
	let lo = -Infinity
	let hi = Infinity
	for (const [normal, d] of planes) {
		const rest = d - normal[b] * u - normal[c] * v
		if (Math.abs(normal[a]) < EPS) {
			if (rest < -EPS) return null
		} else if (normal[a] > 0) hi = Math.min(hi, rest / normal[a])
		else lo = Math.max(lo, rest / normal[a])
	}
	if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi + EPS) return null
	return positive ? 1 - hi : lo
}

/** How far in from `face` the cube's surface lies that an object spanning `across` and `up` on that face stands on (surface_depth): the nearest hull behind the object's middle, else the nearest of all; 0 without hulls. A box hull counts by its box; any other (an angled panel) where rays along the face's normal through the object's middle and back corners first meet it, so the object, square to the face, is pushed in until it touches. */
function surfaceDepth(shape: number, rotation: number, kind: number, face: number, across: [number, number], up: [number, number]): number {
	if (!SOLID[kind]) return 0
	const [a, b, c] = faceAxes(face)
	const u = (across[0] + across[1]) / 2
	const v = (up[0] + up[1]) / 2
	const positive = facePositive(face)
	let behind = Infinity
	let nearest = Infinity
	for (const hull of shapeHulls(shape, rotation)) {
		const min = [Infinity, Infinity, Infinity]
		const max = [-Infinity, -Infinity, -Infinity]
		for (const p of hull) {
			for (let i = 0; i < 3; i++) {
				min[i] = Math.min(min[i], p[i])
				max[i] = Math.max(max[i], p[i])
			}
		}
		const depth = positive ? 1 - max[a] : min[a]
		nearest = Math.min(nearest, depth)
		const isBox = hull.every((p) => [0, 1, 2].every((i) => p[i] === min[i] || p[i] === max[i])) && hull.length >= 8
		if (isBox) {
			if (u >= min[b] && u <= max[b] && v >= min[c] && v <= max[c]) behind = Math.min(behind, depth)
			continue
		}
		const planes = hullPlanes(hull)
		if (rayDepth(planes, a, b, c, positive, u, v) === null) continue
		for (const [pu, pv] of [[u, v], [across[0], up[0]], [across[0], up[1]], [across[1], up[0]], [across[1], up[1]]]) {
			const hit = rayDepth(planes, a, b, c, positive, pu, pv)
			if (hit !== null) behind = Math.min(behind, hit)
		}
	}
	const depth = Number.isFinite(behind) ? behind : nearest
	return Number.isFinite(depth) ? Math.max(depth, 0) : 0
}

/** The box object `o` fills in its cube in its state, (min, max) in cube unit space (Object::extent): against its face, or against the surface behind it where the shape stands back from the face (a thin wall's far side). */
export function objectExtent(world: CubeWorld, o: WorldObject): [V3, V3] {
	const on = o.state === 1
	const face = o.face
	const cube = world.get(o.pos.x, o.pos.z, o.pos.layer)
	const sunk = (across: [number, number], up: [number, number]) => surfaceDepth(cube.shape, cube.rotation, cube.kind, face, across, up)
	if (o.kind === DOOR || o.kind === WINDOW) {
		const [across, up, cutCorners] = hole(o.kind === WINDOW ? 'window' : 'doorway', cube.shape, cube.rotation, cube.kind, face)
		const d = sunk(across, up)
		if (on) {
			// Swung into the cube on whichever side of its hinge it has room.
			const width = across[1] - across[0]
			const swing: [number, number] = d + width <= 1 ? [d, d + width] : [d - width, d]
			return onFace(face, swing, [across[0], across[0] + PANE_DEPTH], up)
		}
		if (cutCorners) {
			// In the middle of the wall, where the corners cut off the hole hide the pane's.
			const back = 1 - surfaceDepth(cube.shape, cube.rotation, cube.kind, opposite(face), across, up)
			const front = (d + back - PANE_DEPTH) / 2
			return onFace(face, [front, front + PANE_DEPTH], across, up)
		}
		return onFace(face, [d, d + PANE_DEPTH], across, up)
	}
	let depth: [number, number]
	let across: [number, number]
	let up: [number, number]
	if (o.kind === LEVER) [depth, across, up] = [[-0.06, 0], [0.46, 0.54], on ? [0.42, 0.56] : [0.3, 0.44]]
	else if (o.kind === BUTTON) [depth, across, up] = [[on ? -0.01 : -0.03, 0], [0.46, 0.54], [0.36, 0.44]]
	else if (o.kind === TORCH && (face === UP || face === DOWN)) [depth, across, up] = [[-TORCH_LENGTH, 0], [0.48, 0.52], [0.48, 0.52]]
	else if (o.kind === TORCH) [depth, across, up] = [[-0.12, 0], [0.47, 0.53], [0.5, 0.5 + TORCH_LENGTH]]
	else [depth, across, up] = [[-0.01, 0], [0.15, 0.85], [0.15, 0.85]]
	const d = sunk(across, up)
	return onFace(face, [depth[0] + d, depth[1] + d], across, up)
}

/** Face ids by name, for the tests and the probes. */
export const FACES = { NORTH, EAST, SOUTH, WEST, UP, DOWN }
