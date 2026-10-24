// Picking cubes under the cursor (#31): a ray walked through the world's grid of cubes, one cell at a
// time (Amanatides and Woo's traversal), to the first cube that is not empty in a layer the layer
// slice shows. A cube is picked by its whole cell whatever its shape, as the builder aims at cubes,
// not at faces of a slope. Pure data, with no three.js, so it runs in the unit tests.

import { GROUND_LAYER, LAYER_COUNT, type CubeWorld } from './world'
import { CUBE_DIMS, CUBE_SIZE, shapeFaces } from './shapes'
import { layerBottom } from './mesher'

/** A cube's place: its column (x, z) and its layer. */
export interface CubeAt {
	x: number
	z: number
	layer: number
}

/** What the ray found: the cube it met (null on the fallback floor) and the cell a placed cube goes in (null when there is none). */
export interface CubePick {
	cube: CubeAt | null
	place: CubeAt | null
	/** The distance along the ray, in metres. */
	t: number
	/** The face of `cube` the ray came in through (shapes.ts NORTH..DOWN), -1 when it started inside the cube or met the floor. */
	face: number
}

/** A ray: its origin and direction (need not be unit length; `t` is then in its units). */
export interface Ray3 {
	ox: number
	oy: number
	oz: number
	dx: number
	dy: number
	dz: number
}

/** Whether a layer is shown, so its cubes can be picked: every layer, or those the layer slice leaves. */
export type LayerShown = (layer: number) => boolean

/** The layers the slice shows (ui.cubeSlice). */
export function sliceShows(slice: { mode: 'off' | 'above' | 'below'; layer: number }): LayerShown {
	if (slice.mode === 'off') return () => true
	const n = slice.layer
	return slice.mode === 'below' ? (l) => l >= n : (l) => l <= n
}

/**
 * Where `ray` first meets the shape of the cube at `cell` (x, y cell index, z) from outside: the
 * distance along the ray and the cube face whose paint that shape face shows, or null when the ray
 * passes through the cell without touching the shape (over a slope's open side, say).
 */
function shapeHit(world: CubeWorld, ray: Ray3, cell: number[], layer: number): { t: number; face: number } | null {
	const c = world.get(cell[0], cell[2], layer)
	// The ray in the cube's unit space, which a cube's height stretches apart from its width.
	const [sx, sy, sz] = CUBE_DIMS
	const o = [(ray.ox - cell[0] * sx) / sx, (ray.oy - layerBottom(layer)) / sy, (ray.oz - cell[2] * sz) / sz]
	const d = [ray.dx / sx, ray.dy / sy, ray.dz / sz]
	let best: { t: number; face: number } | null = null
	for (const f of shapeFaces(c.shape, c.rotation)) {
		const n = f.normal
		const denom = n[0] * d[0] + n[1] * d[1] + n[2] * d[2]
		if (denom >= -1e-9) continue
		const a = f.polygon[0]
		const t = ((a[0] - o[0]) * n[0] + (a[1] - o[1]) * n[1] + (a[2] - o[2]) * n[2]) / (n[0] * d[0] + n[1] * d[1] + n[2] * d[2])
		if (best && t >= best.t) continue
		const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]
		const poly = f.polygon
		let inside = true
		for (let i = 0; i < poly.length && inside; i++) {
			const u = poly[i]
			const v = poly[(i + 1) % poly.length]
			const e = [v[0] - u[0], v[1] - u[1], v[2] - u[2]]
			const w = [p[0] - u[0], p[1] - u[1], p[2] - u[2]]
			const cx = e[1] * w[2] - e[2] * w[1]
			const cy = e[2] * w[0] - e[0] * w[2]
			const cz = e[0] * w[1] - e[1] * w[0]
			if (cx * n[0] + cy * n[1] + cz * n[2] < -1e-6) inside = false
		}
		if (inside) best = { t, face: f.paintFace }
	}
	return best
}

/** The cell index along y of a layer: the ground layer's is 0, each layer up adds one. */
const cellY = (layer: number) => GROUND_LAYER - layer

/**
 * The first shown, not empty cube along `ray` within `maxT`, and the cell beside it across the face
 * the ray came in through, where a placed cube goes (null outside the world, or when the ray starts
 * inside the cube). With nothing met, the ray's meeting with the bottom of `floorLayer` inside the
 * world gives the cell there to place in, so an empty world can be built on. Null when neither.
 * With `byShape` (Paint mode) a cube counts only where the ray meets its shape, and `face` is the
 * cube face whose paint the shape face shows (ShapeFace.paintFace) rather than the cell face entered.
 */
export function pickCube(world: CubeWorld, ray: Ray3, shown: LayerShown, maxT: number, floorLayer = GROUND_LAYER, byShape = false): CubePick | null {
	// A cell's size along each axis: a cube's height stands apart from its width.
	const s = CUBE_DIMS
	const min = [0, cellY(LAYER_COUNT - 1) * s[1], 0]
	const max = [world.sizeX * s[0], (cellY(0) + 1) * s[1], world.sizeZ * s[2]]
	const o = [ray.ox, ray.oy, ray.oz]
	const d = [ray.dx, ray.dy, ray.dz]
	// The ray's span inside the world's box, and the axis it entered across.
	let t0 = 0
	let t1 = maxT
	let enterAxis = -1
	for (let a = 0; a < 3; a++) {
		if (d[a] === 0) {
			if (o[a] < min[a] || o[a] > max[a]) return floorPick(world, ray, maxT, floorLayer)
			continue
		}
		let ta = (min[a] - o[a]) / d[a]
		let tb = (max[a] - o[a]) / d[a]
		if (ta > tb) [ta, tb] = [tb, ta]
		if (ta > t0) {
			t0 = ta
			enterAxis = a
		}
		if (tb < t1) t1 = tb
	}
	if (t0 > t1) return floorPick(world, ray, maxT, floorLayer)

	// The cell the ray is in at t0, nudged inside along the ray.
	const cell = [0, 0, 0]
	const cellMax = [world.sizeX - 1, cellY(0), world.sizeZ - 1]
	const cellMin = [0, cellY(LAYER_COUNT - 1), 0]
	const step = [0, 0, 0]
	const tMax = [Infinity, Infinity, Infinity]
	const tDelta = [Infinity, Infinity, Infinity]
	for (let a = 0; a < 3; a++) {
		const p = o[a] + d[a] * t0
		let c = Math.floor(p / s[a])
		if (a === enterAxis) c = d[a] > 0 ? Math.round(p / s[a]) : Math.round(p / s[a]) - 1
		cell[a] = Math.max(cellMin[a], Math.min(cellMax[a], c))
		if (d[a] !== 0) {
			step[a] = d[a] > 0 ? 1 : -1
			const edge = (cell[a] + (d[a] > 0 ? 1 : 0)) * s[a]
			tMax[a] = (edge - o[a]) / d[a]
			tDelta[a] = s[a] / Math.abs(d[a])
		}
	}
	// The axis last stepped across: the face the ray came into the cell through (-1: it started there).
	let axis = enterAxis
	let t = t0
	for (let guard = 0; guard < 4096; guard++) {
		const layer = GROUND_LAYER - cell[1]
		const filled = shown(layer) && world.get(cell[0], cell[2], layer).kind !== 0
		const hit = filled && byShape ? shapeHit(world, ray, cell, layer) : null
		if (filled && (!byShape || hit)) {
			const cube = { x: cell[0], z: cell[2], layer }
			let place: CubeAt | null = null
			if (axis >= 0) {
				const back = [cell[0], cell[1], cell[2]]
				back[axis] -= step[axis]
				const p = { x: back[0], z: back[2], layer: GROUND_LAYER - back[1] }
				if (world.contains(p.x, p.z, p.layer)) place = p
			}
			return { cube, place, t: hit ? hit.t : t, face: hit ? hit.face : entryFace(axis, step[axis]) }
		}
		axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2
		t = tMax[axis]
		if (t > t1) break
		cell[axis] += step[axis]
		if (cell[axis] < cellMin[axis] || cell[axis] > cellMax[axis]) break
		tMax[axis] += tDelta[axis]
	}
	return floorPick(world, ray, maxT, floorLayer)
}

/** The cell of `floorLayer` where the ray meets that layer's bottom, inside the world and within `maxT`. */
function floorPick(world: CubeWorld, ray: Ray3, maxT: number, floorLayer: number): CubePick | null {
	if (ray.dy === 0) return null
	const t = (layerBottom(floorLayer) - ray.oy) / ray.dy
	if (!(t > 0) || t > maxT) return null
	const x = Math.floor((ray.ox + ray.dx * t) / CUBE_SIZE)
	const z = Math.floor((ray.oz + ray.dz * t) / CUBE_SIZE)
	if (!world.contains(x, z, floorLayer)) return null
	return { cube: null, place: { x, z, layer: floorLayer }, t, face: -1 }
}

/**
 * The face a ray stepping along grid `axis` (0 x, 1 the cell's y, up, 2 z) by `step` came into a cell
 * through: going east it came in through the west face, going up through the bottom. -1 for no axis.
 */
function entryFace(axis: number, step: number): number {
	if (axis === 0) return step > 0 ? 3 : 1
	if (axis === 1) return step > 0 ? 5 : 4
	if (axis === 2) return step > 0 ? 0 : 2
	return -1
}
