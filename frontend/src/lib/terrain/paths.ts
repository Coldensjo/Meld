// Paths (#167): roads, rivers and fences drawn along an editable spline, as Unreal's landscape splines. A path is a list
// of control points the author drops and drags on the ground, and settings saying what it does when
// applied. This module holds the record, the curve through the points (sampled by arc length) and the
// distance field around it that the apply (tools/pathApply.ts) works from. It keeps no editor state.
import * as THREE from 'three'

/** What a path does when it is applied. */
export type PathKind = 'road' | 'river' | 'fence'

export const PATH_KINDS: ReadonlyArray<{ id: PathKind; name: string; tip: string }> = [
	{ id: 'road', name: 'Road', tip: "Level the ground across the width, at the curve's height and grade, and paint a texture along it" },
	{ id: 'river', name: 'River', tip: 'Carve a bed across the width and fill it with a liquid whose surface runs downhill along the curve' },
	{ id: 'fence', name: 'Fence', tip: 'Stand a model end to end along the curve, each turned along it: fences, walls, palisades, lamp posts' },
]

/** A control point on the ground, in world units. */
export interface PathPoint {
	x: number
	y: number
	z: number
}

/** A path as the map file keeps it (`Header.Paths`). */
export interface MapPath {
	/** Unique in the map, for the apply that a re-apply takes back. */
	id: number
	name: string
	kind: PathKind
	points: PathPoint[]
	/** The full width of the levelled or painted part, yards. */
	width: number
	/** The yards beyond each side over which the ground blends back into what was there (a cosine). */
	falloff: number
	/** The steepest the road may climb along its length, in percent (rise per run); 0 for no limit. */
	grade: number
	/** The palette texture painted along it; '' paints none. */
	texture: string
	/** Yards over which the paint fades at each side; 0 is a hard edge. */
	edge: number
	/** A river's bed: how deep below its surface the middle is carved, yards. */
	depth: number
	/** A river's liquid (LiquidType.dbc ID: 1 water, 2 ocean, 3 magma, 4 slime). */
	liquid: number
	/** A fence's model (an object type, `m2:` or `wmo:` and its client path); '' for none yet. */
	model: string
	/** Yards from one fence model to the next; 0 lays them end to end at the model's own length. */
	spacing: number
	/** Degrees each fence model is turned past following the curve (its long side is laid along it). */
	turn: number
}

/** Below this width, in yards, a road is narrower than two cells and looks jagged (1.12 has a cell every 2 yd). */
export const NARROW_WIDTH = 4

export const PATH_DEFAULTS: Omit<MapPath, 'id' | 'name' | 'kind' | 'points' | 'texture'> = {
	width: 8,
	falloff: 4,
	grade: 0,
	edge: 1,
	depth: 3,
	liquid: 1,
	model: '',
	spacing: 0,
	turn: 0,
}

/** A new path of `kind`, with the defaults and no points; `id` and `name` from the paths already there. */
export function newPath(list: readonly MapPath[], kind: PathKind, texture: string): MapPath {
	const id = list.reduce((m, p) => Math.max(m, p.id), 0) + 1
	const label = PATH_KINDS.find((k) => k.id === kind)?.name ?? 'Path'
	let n = 1
	while (list.some((p) => p.name === `${label} ${n}`)) n++
	return { id, name: `${label} ${n}`, kind, points: [], texture, ...PATH_DEFAULTS }
}

export function copyPath(p: MapPath): MapPath {
	return { ...p, points: p.points.map((q) => ({ ...q })) }
}

export function copyPaths(list: readonly MapPath[]): MapPath[] {
	return list.map(copyPath)
}

/** The paths a map file gave, each checked and given defaults for what it lacks; bad entries are dropped. */
export function readPaths(v: unknown): MapPath[] {
	if (!Array.isArray(v)) return []
	const out: MapPath[] = []
	const ids = new Set<number>()
	for (const raw of v) {
		if (!raw || typeof raw !== 'object') continue
		const o = raw as Record<string, unknown>
		const num = (k: string, d: number, lo = -Infinity, hi = Infinity) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? Math.min(hi, Math.max(lo, o[k] as number)) : d)
		const points: PathPoint[] = []
		if (Array.isArray(o.points)) {
			for (const q of o.points as unknown[]) {
				const p = q as Record<string, unknown> | null
				if (p && [p.x, p.y, p.z].every((c) => typeof c === 'number' && Number.isFinite(c))) points.push({ x: p.x as number, y: p.y as number, z: p.z as number })
			}
		}
		let id = Math.round(num('id', 0))
		if (id <= 0 || ids.has(id)) id = Math.max(0, ...ids, ...out.map((p) => p.id)) + 1
		ids.add(id)
		const kind = PATH_KINDS.find((k) => k.id === o.kind)?.id ?? 'road'
		out.push({
			id,
			name: typeof o.name === 'string' && o.name ? o.name : `Path ${id}`,
			kind,
			points,
			width: num('width', PATH_DEFAULTS.width, 0.5, 200),
			falloff: num('falloff', PATH_DEFAULTS.falloff, 0, 200),
			grade: num('grade', PATH_DEFAULTS.grade, 0, 1000),
			texture: typeof o.texture === 'string' ? o.texture : '',
			edge: num('edge', PATH_DEFAULTS.edge, 0, 50),
			depth: num('depth', PATH_DEFAULTS.depth, 0, 100),
			liquid: Math.round(num('liquid', PATH_DEFAULTS.liquid, 1, 1e6)),
			model: typeof o.model === 'string' ? o.model : '',
			spacing: num('spacing', PATH_DEFAULTS.spacing, 0, 500),
			turn: num('turn', PATH_DEFAULTS.turn, -360, 360),
		})
	}
	return out
}

/** A curve sampled at even steps of arc length: positions, and the arc length at each. */
export interface PathSamples {
	n: number
	x: Float32Array
	y: Float32Array
	z: Float32Array
	/** Arc length from the first point, yards. */
	s: Float32Array
	length: number
}

/**
 * Samples the curve through `points` (centripetal Catmull-Rom, which neither loops nor overshoots at
 * sharp turns) about every `step` yards along its length, ends included. Its height runs through the
 * points' heights. One point gives one sample; none gives none.
 */
export function samplePath(points: readonly PathPoint[], step: number): PathSamples {
	const empty = (n: number) => ({ n, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), s: new Float32Array(n), length: 0 })
	if (!points.length) return empty(0)
	if (points.length === 1) {
		const out = empty(1)
		out.x[0] = points[0].x
		out.y[0] = points[0].y
		out.z[0] = points[0].z
		return out
	}
	const curve = new THREE.CatmullRomCurve3(
		points.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
		false,
		'centripetal',
	)
	// The arc length table is what getSpacedPoints spaces by: a few divisions a yard keeps it even.
	let rough = 0
	for (let i = 1; i < points.length; i++) rough += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z)
	curve.arcLengthDivisions = Math.max(200, Math.min(20000, Math.ceil(rough * 2)))
	const length = curve.getLength()
	const segs = Math.max(1, Math.ceil(length / Math.max(0.05, step)))
	const out = empty(segs + 1)
	out.length = length
	const v = new THREE.Vector3()
	for (let i = 0; i <= segs; i++) {
		curve.getPointAt(i / segs, v)
		out.x[i] = v.x
		out.y[i] = v.y
		out.z[i] = v.z
		out.s[i] = (length * i) / segs
	}
	return out
}

/**
 * Limits how steeply the samples' heights climb or fall along the curve to `percent` (rise per 100
 * yd of run), keeping each as close to its own height as the limit allows: a pass each way, after
 * which no step is steeper. 0 or less leaves them alone.
 */
export function limitGrade(sm: PathSamples, percent: number) {
	if (percent <= 0 || sm.n < 2) return
	const g = percent / 100
	const y = sm.y
	for (let i = 1; i < sm.n; i++) {
		const d = g * (sm.s[i] - sm.s[i - 1])
		y[i] = Math.min(y[i - 1] + d, Math.max(y[i - 1] - d, y[i]))
	}
	for (let i = sm.n - 2; i >= 0; i--) {
		const d = g * (sm.s[i + 1] - sm.s[i])
		y[i] = Math.min(y[i + 1] + d, Math.max(y[i + 1] - d, y[i]))
	}
}

/**
 * Makes the samples' heights never rise from the curve's higher end to its lower one, as a river's
 * surface runs downhill: each takes the lowest height between it and the higher end.
 */
export function downhill(sm: PathSamples) {
	if (sm.n < 2) return
	const y = sm.y
	if (y[sm.n - 1] > y[0]) for (let i = sm.n - 2; i >= 0; i--) y[i] = Math.min(y[i], y[i + 1])
	else for (let i = 1; i < sm.n; i++) y[i] = Math.min(y[i], y[i - 1])
}

/** How far above a river's surface its banks are left, so the shore is dry ground, yards. */
export const RIVER_BANK = 0.5

/**
 * The ground height a river's bed takes `d` yards from its middle, where the surface is at `surface`:
 * `depth` below it in the middle, rising as a cosine to RIVER_BANK above it at half the width.
 */
export function riverBed(d: number, half: number, surface: number, depth: number): number {
	const u = Math.min(1, d / half)
	return surface + RIVER_BANK - (depth + RIVER_BANK) * 0.5 * (1 + Math.cos(Math.PI * u))
}

/**
 * How much of the path's effect a spot `d` yards from the curve takes: all of it within `half`, none
 * beyond `half + falloff`, and a cosine between (Unreal's landscape spline falloff).
 */
export function crossWeight(d: number, half: number, falloff: number): number {
	if (d <= half) return 1
	if (falloff <= 0 || d >= half + falloff) return 0
	return 0.5 * (1 + Math.cos((Math.PI * (d - half)) / falloff))
}

/**
 * The nearest point of the curve to each spot of a grid around it: grid index (i, j) is at world
 * (i * spacing + offset, j * spacing + offset), over the rect x0..x0+w-1, z0..z0+h-1. Spots farther
 * than the reach keep Infinity.
 */
export interface PathField {
	x0: number
	z0: number
	w: number
	h: number
	/** Distance to the curve, yards. */
	dist: Float32Array
	/** The curve's height at its nearest point. */
	height: Float32Array
	/** The arc length at the nearest point. */
	along: Float32Array
}

/**
 * The distance field of the sampled curve over the grid spots within `reach` of it, the grid running
 * from index 0 to `last` on both axes. Null when no spot is within reach. Each sample segment fills the
 * spots in its own box, so the work follows the curve's length times its reach, not the map's area.
 */
export function pathField(sm: PathSamples, spacing: number, offset: number, reach: number, last: number): PathField | null {
	if (!sm.n) return null
	let minX = Infinity,
		minZ = Infinity,
		maxX = -Infinity,
		maxZ = -Infinity
	for (let i = 0; i < sm.n; i++) {
		minX = Math.min(minX, sm.x[i])
		maxX = Math.max(maxX, sm.x[i])
		minZ = Math.min(minZ, sm.z[i])
		maxZ = Math.max(maxZ, sm.z[i])
	}
	const lo = (v: number) => Math.max(0, Math.ceil((v - reach - offset) / spacing))
	const hi = (v: number) => Math.min(last, Math.floor((v + reach - offset) / spacing))
	const x0 = lo(minX),
		z0 = lo(minZ),
		x1 = hi(maxX),
		z1 = hi(maxZ)
	if (x1 < x0 || z1 < z0) return null
	const w = x1 - x0 + 1
	const h = z1 - z0 + 1
	const dist = new Float32Array(w * h).fill(Infinity)
	const height = new Float32Array(w * h)
	const along = new Float32Array(w * h)
	const r2 = reach * reach
	const segs = Math.max(1, sm.n - 1)
	for (let k = 0; k < segs; k++) {
		const b = Math.min(k + 1, sm.n - 1)
		const ax = sm.x[k],
			az = sm.z[k],
			bx = sm.x[b],
			bz = sm.z[b]
		const dx = bx - ax,
			dz = bz - az
		const len2 = dx * dx + dz * dz
		const sx0 = Math.max(x0, lo(Math.min(ax, bx))),
			sx1 = Math.min(x1, hi(Math.max(ax, bx)))
		const sz0 = Math.max(z0, lo(Math.min(az, bz))),
			sz1 = Math.min(z1, hi(Math.max(az, bz)))
		for (let j = sz0; j <= sz1; j++) {
			const pz = j * spacing + offset
			for (let i = sx0; i <= sx1; i++) {
				const px = i * spacing + offset
				let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0
				t = t < 0 ? 0 : t > 1 ? 1 : t
				const qx = ax + dx * t - px
				const qz = az + dz * t - pz
				const d2 = qx * qx + qz * qz
				if (d2 > r2) continue
				const idx = (j - z0) * w + (i - x0)
				// The field holds squared distances until the end.
				if (d2 < dist[idx]) {
					dist[idx] = d2
					height[idx] = sm.y[k] + (sm.y[b] - sm.y[k]) * t
					along[idx] = sm.s[k] + (sm.s[b] - sm.s[k]) * t
				}
			}
		}
	}
	for (let i = 0; i < dist.length; i++) if (dist[i] !== Infinity) dist[i] = Math.sqrt(dist[i])
	return { x0, z0, w, h, dist, height, along }
}

/** A model laid along a path: where it stands and its turn about the vertical (an object's `rotY`). */
export interface PathPiece {
	x: number
	z: number
	rotY: number
}

/**
 * Where a fence's models stand: the curve cut into equal spans as near `span` yards long as fits a
 * whole number of them, a model in the middle of each, turned along the span's chord. A model's
 * local +X follows the curve, or its +Z when `alongZ` (a model longer that way), then `turnDeg` more.
 */
export function fencePieces(sm: PathSamples, span: number, alongZ: boolean, turnDeg: number): PathPiece[] {
	if (sm.n < 2 || span <= 0 || sm.length <= 0) return []
	const count = Math.max(1, Math.round(sm.length / span))
	const at = (s: number) => {
		const f = Math.min(sm.n - 1, Math.max(0, (s / sm.length) * (sm.n - 1)))
		const i = Math.min(sm.n - 2, Math.floor(f))
		const t = f - i
		return { x: sm.x[i] + (sm.x[i + 1] - sm.x[i]) * t, z: sm.z[i] + (sm.z[i + 1] - sm.z[i]) * t }
	}
	const turn = (turnDeg * Math.PI) / 180 + (alongZ ? Math.PI / 2 : 0)
	const out: PathPiece[] = []
	for (let k = 0; k < count; k++) {
		const a = at((k * sm.length) / count)
		const b = at(((k + 1) * sm.length) / count)
		const m = at(((k + 0.5) * sm.length) / count)
		// A three.js turn of r about +Y takes +X to (cos r, -sin r) in x, z.
		out.push({ x: m.x, z: m.z, rotY: Math.atan2(-(b.z - a.z), b.x - a.x) + turn })
	}
	return out
}

/**
 * The control segment (from point i to i+1) whose straight line passes nearest (x, z), and how near,
 * for inserting a point into a path where it is clicked.
 */
export function nearestSegment(points: readonly PathPoint[], x: number, z: number): { index: number; dist: number } {
	let best = { index: -1, dist: Infinity }
	for (let i = 0; i + 1 < points.length; i++) {
		const a = points[i],
			b = points[i + 1]
		const dx = b.x - a.x,
			dz = b.z - a.z
		const len2 = dx * dx + dz * dz
		const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0
		const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z)
		if (d < best.dist) best = { index: i, dist: d }
	}
	return best
}
