// A new world's beaches (#766): a stretch of nearly flat ground along the sea, whatever the height of
// the land behind it, and a gentle shelf under the water off it. Laid over the generated heights
// (generate.ts, after the erosion, which would cut gullies into it) and over the New world page's
// pictures (presets.ts), keyed on the sea level the page sets (#759), not on 0.
import { squaredDistance } from './distance'
import { LAKE_RULES, findLakes } from '../water/lakes'

/** Yards the beach rises from the waterline to its inland edge. */
export const BEACH_RISE = 1.5
/** Yards under the water the shelf off a beach goes down to over the beach's width. */
const SHELF_DEPTH = 3
/** Yards above the sea `Terrain.autoPaint` lays sand: the old shore line's, and a beach's, which covers its whole flat strip. */
export const SAND_BAND = 1.2
export const BEACH_SAND = BEACH_RISE + 0.5

/** The sand band above the sea for a world made with beaches `width` yards wide (0 none). */
export const sandBand = (width: number) => (width > 0 ? BEACH_SAND : SAND_BAND)

const smoothstep = (e0: number, e1: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
	return t * t * (3 - 2 * t)
}

/**
 * The height over the water of ground `d` yards from it, `a` yards over it, for beaches `width` yards
 * wide: up to 60% of the width the ground lies on a slope rising BEACH_RISE over the width, then it
 * comes back to its own height by 160%. It only ever lowers ground, so the coast stays where it was;
 * under the water (`a` < 0, `d` the yards from land) it only raises the seabed, to a shelf going down
 * SHELF_DEPTH over the width. The shelf leaves the waterline as steeply as the beach does, so the
 * ground crosses the sea where it did between a vertex on each side (#1031).
 */
export function beachHeight(a: number, d: number, width: number): number {
	if (width <= 0) return a
	const hi = width * 1.6
	if (d >= hi) return a
	const t = smoothstep(width * 0.6, hi, d)
	if (a >= 0) {
		const flat = BEACH_RISE * Math.min(1, d / width)
		return a <= flat ? a : flat + (a - flat) * t
	}
	const u = Math.min(1, d / width)
	const shelf = -(BEACH_RISE * u + (SHELF_DEPTH - BEACH_RISE) * u * u)
	return a >= shelf ? a : shelf + (a - shelf) * t
}

/**
 * The distance in cells from vertex `i` (x, z) of heights `a` (over the sea), `V` a side, to the
 * waterline, found near `q`, the nearest vertex on the other side of it: the zero crossings on the
 * edges of the cells round `q`, joined cell by cell as marching squares joins them. The waterline
 * then comes out as the smooth line it is, not as the vertices' staircase (#1031). No further than `q`.
 */
function coastDistance(a: Float32Array, V: number, i: number, q: number): number {
	const x = i % V
	const z = (i - x) / V
	const qx = q % V
	const qz = (q - qx) / V
	let best = Math.hypot(qx - x, qz - z)
	const pts = [0, 0, 0, 0, 0, 0, 0, 0]
	for (let cz = Math.max(0, qz - 2); cz <= Math.min(V - 2, qz + 1); cz++) {
		for (let cx = Math.max(0, qx - 2); cx <= Math.min(V - 2, qx + 1); cx++) {
			let n = 0
			// The cell's edges in turn round it: top, right, bottom, left.
			for (let e = 0; e < 4; e++) {
				const x0 = cx + (e === 1 || e === 2 ? 1 : 0)
				const z0 = cz + (e >= 2 ? 1 : 0)
				const x1 = cx + (e === 0 || e === 1 ? 1 : 0)
				const z1 = cz + (e === 1 || e === 2 ? 1 : 0)
				const a0 = a[z0 * V + x0]
				const a1 = a[z1 * V + x1]
				if (a0 < 0 === a1 < 0) continue
				const t = a0 / (a0 - a1)
				pts[n++] = x0 + (x1 - x0) * t
				pts[n++] = z0 + (z1 - z0) * t
			}
			// Two crossings, or four at a saddle, paired in order round the cell.
			for (let k = 0; k + 3 < n; k += 4) best = Math.min(best, segDistance(x, z, pts[k], pts[k + 1], pts[k + 2], pts[k + 3]))
		}
	}
	return best
}

/** The distance from (px, pz) to the segment from (ax, az) to (bx, bz). */
function segDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
	const dx = bx - ax
	const dz = bz - az
	const l2 = dx * dx + dz * dz
	const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0
	return Math.hypot(ax + dx * t - px, az + dz * t - pz)
}

/**
 * Lays beaches `width` yards wide (0 none) along the sea at `sea` yards over heights `h`, `V` vertices
 * a side `cellSize` yards apart, in place: each vertex's distance to the water (or, under it, to the
 * land) from a distance transform, made exact near the coast by `coastDistance`, then `beachHeight`.
 * No vertex changes side of the sea. Two V² transforms.
 */
export function shapeBeaches(h: Float32Array, V: number, cellSize: number, sea: number, width: number) {
	if (width <= 0) return
	const n = V * V
	const INF = 1e20
	const toSea = new Float64Array(n)
	const toLand = new Float64Array(n)
	let wet = 0
	for (let i = 0; i < n; i++) {
		const under = h[i] < sea
		toSea[i] = under ? 0 : INF
		toLand[i] = under ? INF : 0
		if (under) wet++
	}
	if (wet === 0 || wet === n) return
	const nearSea = new Int32Array(n)
	const nearLand = new Int32Array(n)
	const ds = squaredDistance(toSea, V, nearSea)
	const dl = squaredDistance(toLand, V, nearLand)
	const a = new Float32Array(n)
	for (let i = 0; i < n; i++) a[i] = h[i] - sea
	// Past this many cells beachHeight leaves the ground as it is.
	const reach = (width * 1.6) / cellSize + 1
	for (let i = 0; i < n; i++) {
		const land = a[i] >= 0
		const cells = Math.sqrt(land ? ds[i] : dl[i])
		if (cells > reach) continue
		const d = Math.max(1e-3, coastDistance(a, V, i, land ? nearSea[i] : nearLand[i])) * cellSize
		const v = sea + beachHeight(a[i], d, width)
		// A shelf a hair under the sea could round onto it in 32 bits.
		if (land || v < sea) h[i] = v
	}
}

/**
 * Lays beaches `width` yards wide (0 none) round the lakes of heights `h` (#772) as `shapeBeaches` does
 * along the sea, in place: the lakes are found as `planWater` will find them (with `sea` as the sea's
 * level, null for none), and for each lake level the land is brought down to a gentle slope from that
 * level, by its distance to that level's lake. Land only: a lake's own basin and the rim that holds
 * it stay. The caller finds the lakes again on the new ground, since lowering the land beside a low lake
 * can open the rim of a higher one next to it.
 */
export function shapeLakeBeaches(h: Float32Array, V: number, cellSize: number, sea: number | null, width: number) {
	if (width <= 0) return
	const lakes = findLakes(h, V, cellSize, { ...LAKE_RULES, sea })
	const n = V * V
	const byLevel = new Map<number, number[]>()
	for (let i = 0; i < n; i++) {
		if (Number.isNaN(lakes[i])) continue
		const key = Math.round(lakes[i] * 100)
		const list = byLevel.get(key)
		if (list) list.push(i)
		else byLevel.set(key, [i])
	}
	if (!byLevel.size) return
	const INF = 1e20
	const src = new Float64Array(n)
	for (const [key, members] of byLevel) {
		const level = key / 100
		src.fill(INF)
		for (const i of members) src[i] = 0
		const d2 = squaredDistance(src, V)
		const hi2 = (width * 1.6) ** 2 / (cellSize * cellSize)
		for (let i = 0; i < n; i++) {
			// Other lakes' water and the ground under this one are left alone.
			if (d2[i] === 0 || d2[i] >= hi2 || !Number.isNaN(lakes[i])) continue
			const a = h[i] - level
			if (a < 0) continue
			h[i] = level + beachHeight(a, Math.sqrt(d2[i]) * cellSize, width)
		}
	}
}
