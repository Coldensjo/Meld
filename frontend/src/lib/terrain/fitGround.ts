import { HOLE_BLOCK } from './holes'

// Fit ground to a model (#168, #208, #210), the arithmetic: under the vertices a model covers (its
// footprint) the ground is levelled to the model's base (its origin, where a building meets the
// ground), never above just under its floor, so a building stands on a flat bed as on a foundation; a
// level apron and then a ring around it blend from that new height back to the ground's own. The engine
// casts the rays that give the floor and underside heights (for Stamp, there is no base and both are
// the underside, so the ground takes its shape) and records the edit.

export type FitMode = 'lower' | 'raise' | 'both'

export interface FitOptions {
	/** How far under the floor the ground goes, in yards. */
	margin: number
	/** The width of the ring over which the ground blends back to its own height, in yards. */
	falloff: number
	/** Whether the ground may only go down, only go up, or both. */
	mode: FitMode
	/**
	 * Cut a hole where the ground stands above the floor instead of lowering it (a cellar, a crypt
	 * entrance), in whole 2x2-cell blocks as the client keeps holes.
	 */
	holes: boolean
	/**
	 * How far above the model's lowest floor a floor, and above its lowest underside an underside, may
	 * be to count (the engine's rays use it), in yards: a hayloft or the eaves don't.
	 */
	reach: number
}

export interface FitResult {
	/** The new heights of the window, `w` by `h` vertices. */
	heights: Float32Array
	/** 1 for each cell of the window (`w - 1` by `h - 1`) to cut as a hole. */
	holes: Uint8Array
	/** Whether any height or hole changed. */
	changed: boolean
}

/** How many times the ring is smoothed, which rounds its edges (#210). */
const SMOOTH_PASSES = 4

/** 0 at the footprint to 1 at the ring's edge, eased. */
const ease = (t: number) => t * t * (3 - 2 * t)

/**
 * Fits the ground of a `w` by `h` vertex window to a model: `floor` is its lowest floor over each
 * vertex and `bottom` its underside (one height a vertex each, NaN where it has none); the vertices
 * with either are its footprint. The ground there goes to `level`, the model's base (or with NaN, to
 * the underside), or to `margin` under the floor where that is lower, within the mode, so a building
 * gets flat ground (#210): its rays alone can't give the base, as a foundation is hollow and its walls
 * fall between the vertices. Around the footprint the ground stays at the
 * nearest fitted height for `apron` yards, then eases back to its own over the falloff beyond that.
 * The window's first vertex is (`ox`, `oz`) of the map, which places the hole blocks on the map's
 * grid. `cell` is the cell size in yards.
 */
export function fitHeights(ground: Float32Array, floor: Float32Array, bottom: Float32Array, w: number, h: number, ox: number, oz: number, cell: number, o: FitOptions, level = NaN, apron = 0): FitResult {
	const n = w * h
	const out = ground.slice()
	const cw = w - 1
	const ch = h - 1
	const holes = new Uint8Array(Math.max(0, cw * ch))
	// Within the mode, a height may only go down, only go up, or either way.
	const allow = (g: number, v: number) => (o.mode === 'lower' ? Math.min(g, v) : o.mode === 'raise' ? Math.max(g, v) : v)
	// The height each covered vertex goes to: the base or the underside, never above just under the floor.
	const target = new Float32Array(n)
	const covered = (i: number) => !Number.isNaN(floor[i]) || !Number.isNaN(bottom[i])
	for (let i = 0; i < n; i++) {
		if (!covered(i)) continue
		// With a base, a floor under it is underground (a sunk footing, a cellar) and leaves the ground
		// level; holes still open over it.
		const hi = Number.isNaN(floor[i]) || floor[i] < level ? Infinity : floor[i] - o.margin
		const base = Number.isNaN(level) ? bottom[i] : level
		target[i] = allow(ground[i], Number.isNaN(base) ? hi : Math.min(base, hi))
	}
	const hasFloor = (i: number) => !Number.isNaN(floor[i])

	// Holes: a cell under the model whose ground comes above the floor, grown to its whole block.
	const fixed = new Uint8Array(n)
	let changed = false
	if (o.holes && cw > 0 && ch > 0) {
		for (let z = 0; z < ch; z++) {
			for (let x = 0; x < cw; x++) {
				const a = z * w + x
				const corners = [a, a + 1, a + w, a + w + 1]
				if (!corners.every(hasFloor) || !corners.some((i) => ground[i] > floor[i])) continue
				const bx = Math.floor((ox + x) / HOLE_BLOCK) * HOLE_BLOCK - ox
				const bz = Math.floor((oz + z) / HOLE_BLOCK) * HOLE_BLOCK - oz
				for (let dz = 0; dz < HOLE_BLOCK; dz++) {
					for (let dx = 0; dx < HOLE_BLOCK; dx++) {
						const cx = bx + dx
						const cz = bz + dz
						if (cx >= 0 && cz >= 0 && cx < cw && cz < ch) holes[cz * cw + cx] = 1
					}
				}
			}
		}
		// The ground around a hole keeps its height, so the hole's edge meets the floor where it was.
		for (let z = 0; z < ch; z++) {
			for (let x = 0; x < cw; x++) {
				if (!holes[z * cw + x]) continue
				changed = true
				const a = z * w + x
				fixed[a] = fixed[a + 1] = fixed[a + w] = fixed[a + w + 1] = 1
			}
		}
	}

	// The distance (yards) from each vertex to the nearest covered one, and that one's height: a
	// two-pass chamfer over the window.
	const dist = new Float32Array(n).fill(Infinity)
	const near = new Float32Array(n)
	for (let i = 0; i < n; i++) {
		if (covered(i)) {
			dist[i] = 0
			near[i] = target[i]
		}
	}
	const diag = cell * Math.SQRT2
	const relax = (i: number, j: number, d: number) => {
		if (dist[j] + d < dist[i]) {
			dist[i] = dist[j] + d
			near[i] = near[j]
		}
	}
	for (let z = 0; z < h; z++) {
		for (let x = 0; x < w; x++) {
			const i = z * w + x
			if (x > 0) relax(i, i - 1, cell)
			if (z > 0) {
				relax(i, i - w, cell)
				if (x > 0) relax(i, i - w - 1, diag)
				if (x < w - 1) relax(i, i - w + 1, diag)
			}
		}
	}
	for (let z = h - 1; z >= 0; z--) {
		for (let x = w - 1; x >= 0; x--) {
			const i = z * w + x
			if (x < w - 1) relax(i, i + 1, cell)
			if (z < h - 1) {
				relax(i, i + w, cell)
				if (x < w - 1) relax(i, i + w + 1, diag)
				if (x > 0) relax(i, i + w - 1, diag)
			}
		}
	}

	// With a base, the distance is to the footprint's convex hull instead (#210): the covered vertices
	// along a wall come and go (under the eaves, a chimney, steps), and the ring rising from each gap
	// drew spikes; the hull gives the pad straight edges and fills those gaps level.
	if (!Number.isNaN(level)) hullDistance(covered, w, h, cell, dist)

	// The fitted height is the base the ring starts from (#210): level over the apron, then eased back
	// over the falloff beyond it. No ring, no apron either.
	const pad = o.falloff > 0 ? apron : 0
	const end = pad + o.falloff
	for (let i = 0; i < n; i++) {
		if (fixed[i] || dist[i] === Infinity) continue
		const g = ground[i]
		const d = dist[i]
		let v: number
		if (d <= pad) v = allow(g, near[i])
		else if (d < end) v = allow(g, near[i] + (g - near[i]) * ease((d - pad) / o.falloff))
		else continue
		if (v !== g) {
			out[i] = v
			changed = true
		}
	}

	// Round the ring's two creases, at the apron and at the hill, with a few 3x3 averaging passes over
	// the apron's outer row, the ring and one cell past it; the footprint, the rest of the apron and a
	// hole's edge stay as they are.
	if (o.falloff > 0) {
		const ring = new Uint8Array(n)
		for (let i = 0; i < n; i++) ring[i] = !fixed[i] && dist[i] > Math.max(0, pad - cell) && dist[i] < end + cell ? 1 : 0
		const prev = new Float32Array(n)
		for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
			prev.set(out)
			for (let z = 0; z < h; z++) {
				for (let x = 0; x < w; x++) {
					const i = z * w + x
					if (!ring[i]) continue
					let sum = 0
					let k = 0
					for (let dz = Math.max(0, z - 1); dz <= Math.min(h - 1, z + 1); dz++) {
						for (let dx = Math.max(0, x - 1); dx <= Math.min(w - 1, x + 1); dx++) {
							sum += prev[dz * w + dx]
							k++
						}
					}
					out[i] = allow(ground[i], sum / k)
				}
			}
		}
		for (let i = 0; i < n && !changed; i++) if (out[i] !== ground[i]) changed = true
	}
	return { heights: out, holes, changed }
}

/**
 * Sets `dist` (yards) to each vertex's distance from the convex hull of the vertices `covered` says
 * are, 0 inside it; leaves it alone when nothing is covered.
 */
function hullDistance(covered: (i: number) => boolean, w: number, h: number, cell: number, dist: Float32Array) {
	const pts: Array<[number, number]> = []
	for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) if (covered(z * w + x)) pts.push([x, z])
	if (!pts.length) return
	// Andrew's monotone chain, counter-clockwise, collinear points dropped.
	pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
	const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
	const lower: Array<[number, number]> = []
	for (const p of pts) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
		lower.push(p)
	}
	const upper: Array<[number, number]> = []
	for (let k = pts.length - 1; k >= 0; k--) {
		const p = pts[k]
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
		upper.push(p)
	}
	const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
	if (!hull.length) hull.push(pts[0])
	const m = hull.length
	for (let z = 0; z < h; z++) {
		for (let x = 0; x < w; x++) {
			// Inside when on the left of every edge (counter-clockwise); a point or a segment has no inside.
			let inside = m >= 3
			let best = Infinity
			for (let k = 0; k < m; k++) {
				const a = hull[k]
				const b = hull[(k + 1) % m]
				if (m >= 3 && cross(a, b, [x, z]) < 0) inside = false
				const ex = b[0] - a[0]
				const ez = b[1] - a[1]
				const len = ex * ex + ez * ez
				const t = len > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / len)) : 0
				best = Math.min(best, Math.hypot(x - a[0] - t * ex, z - a[1] - t * ez))
			}
			dist[z * w + x] = inside ? 0 : best * cell
		}
	}
}
