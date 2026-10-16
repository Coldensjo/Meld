import { HOLE_BLOCK } from './holes'

// Fit ground to a model (#168), the arithmetic: the ground of a window of the vertex grid is moved to
// a target height under the vertices a model covers (its footprint), and blended back to the old
// ground over a ring around it. The engine casts the rays that give the targets (the model's lowest
// floor for Fit, its underside for Stamp) and records the edit.

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
	/** How far above or below the ground a model's floor may be to count (the engine's rays use it), in yards. */
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

const apply = (mode: FitMode, ground: number, target: number) =>
	mode === 'lower' ? Math.min(ground, target) : mode === 'raise' ? Math.max(ground, target) : target

/** 0 at the footprint to 1 at the ring's edge, eased. */
const ease = (t: number) => t * t * (3 - 2 * t)

/**
 * Fits the ground of a `w` by `h` vertex window to `floor` (one height a vertex, NaN where the model
 * doesn't cover it). The window's first vertex is (`ox`, `oz`) of the map, which places the hole
 * blocks on the map's grid. `cell` is the cell size in yards.
 */
export function fitHeights(ground: Float32Array, floor: Float32Array, w: number, h: number, ox: number, oz: number, cell: number, o: FitOptions): FitResult {
	const n = w * h
	const out = ground.slice()
	const cw = w - 1
	const ch = h - 1
	const holes = new Uint8Array(Math.max(0, cw * ch))
	const target = new Float32Array(n)
	for (let i = 0; i < n; i++) target[i] = floor[i] - o.margin
	const covered = (i: number) => !Number.isNaN(floor[i])

	// Holes: a cell under the model whose ground comes above the floor, grown to its whole block.
	const fixed = new Uint8Array(n)
	let changed = false
	if (o.holes && cw > 0 && ch > 0) {
		for (let z = 0; z < ch; z++) {
			for (let x = 0; x < cw; x++) {
				const a = z * w + x
				const corners = [a, a + 1, a + w, a + w + 1]
				if (!corners.every(covered) || !corners.some((i) => ground[i] > floor[i])) continue
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

	// The distance (yards) from each vertex to the nearest covered one, and that one's target: a
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

	for (let i = 0; i < n; i++) {
		if (fixed[i] || dist[i] === Infinity) continue
		const g = ground[i]
		const fit = apply(o.mode, g, near[i])
		let v: number
		if (dist[i] === 0) v = fit
		else if (o.falloff > 0 && dist[i] < o.falloff) v = fit + (g - fit) * ease(dist[i] / o.falloff)
		else continue
		if (v !== g) {
			out[i] = v
			changed = true
		}
	}
	return { heights: out, holes, changed }
}
