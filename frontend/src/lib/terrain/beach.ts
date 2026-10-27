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
 * SHELF_DEPTH over the width.
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
	const shelf = -SHELF_DEPTH * Math.min(1, d / width)
	return a >= shelf ? a : shelf + (a - shelf) * t
}

/**
 * Lays beaches `width` yards wide (0 none) along the sea at `sea` yards over heights `h`, `V` vertices
 * a side `cellSize` yards apart, in place: each vertex's distance to the water (or, under it, to the
 * land) from a distance transform, then `beachHeight`. Two V² transforms, no per-vertex allocation.
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
	const ds = squaredDistance(toSea, V)
	const dl = squaredDistance(toLand, V)
	for (let i = 0; i < n; i++) {
		const a = h[i] - sea
		const d = Math.sqrt(a >= 0 ? ds[i] : dl[i]) * cellSize
		h[i] = sea + beachHeight(a, d, width)
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
