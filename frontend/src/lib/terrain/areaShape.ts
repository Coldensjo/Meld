// Free-form area selections (#183): the Select tool's lasso and polygon make a set of cells, kept as a
// byte per cell of the map (255 inside), with the selection rect as its bounds. Kept free of three.js
// so it can be tested on its own.
import { combineMask, type MaskOp } from './maskSelect'

/** A cell rect: x0..x1 and z0..z1 are vertex corners, so the cells are x0 to x1 - 1. */
export interface CellRect {
	x0: number
	z0: number
	x1: number
	z1: number
}

/** The value of a selected cell. */
export const INSIDE = 255

/**
 * Marks in `out` (size by size cells, cleared first) every cell whose centre is inside the polygon
 * `points` (world x, z pairs, closed back to the first), by the even-odd rule. Returns how many.
 */
export function rasterPolygon(points: ArrayLike<number>, cellSize: number, size: number, out: Uint8Array): number {
	out.fill(0)
	const n = points.length >> 1
	if (n < 3) return 0
	let zmin = Infinity
	let zmax = -Infinity
	for (let i = 0; i < n; i++) {
		const z = points[i * 2 + 1] / cellSize - 0.5
		if (z < zmin) zmin = z
		if (z > zmax) zmax = z
	}
	const r0 = Math.max(0, Math.ceil(zmin))
	const r1 = Math.min(size - 1, Math.floor(zmax))
	const xs: number[] = []
	let count = 0
	for (let row = r0; row <= r1; row++) {
		// The polygon in cell-centre units: a cell (x, row) is in when its centre x + 0.5 is.
		const zc = row + 0.5
		xs.length = 0
		for (let i = 0, j = n - 1; i < n; j = i++) {
			const ax = points[j * 2] / cellSize
			const az = points[j * 2 + 1] / cellSize
			const bx = points[i * 2] / cellSize
			const bz = points[i * 2 + 1] / cellSize
			// Half-open in z, so a vertex on the row counts once.
			if (az <= zc === bz <= zc) continue
			xs.push(ax + ((zc - az) / (bz - az)) * (bx - ax))
		}
		xs.sort((a, b) => a - b)
		for (let k = 0; k + 1 < xs.length; k += 2) {
			// Half-open, as in z: a centre on the left edge is in, one on the right edge out.
			const c0 = Math.max(0, Math.ceil(xs[k] - 0.5))
			const c1 = Math.min(size - 1, Math.ceil(xs[k + 1] - 0.5) - 1)
			for (let x = c0; x <= c1; x++) {
				const p = row * size + x
				if (!out[p]) count++
				out[p] = INSIDE
			}
		}
	}
	return count
}

/** The cells of `r` set in a size by size bitmap. */
export function rectCells(r: CellRect, size: number): Uint8Array {
	const out = new Uint8Array(size * size)
	for (let z = Math.max(0, r.z0); z < Math.min(size, r.z1); z++) out.fill(INSIDE, z * size + Math.max(0, r.x0), z * size + Math.min(size, r.x1))
	return out
}

/**
 * The area a newly drawn shape leaves (#712): `drawn` alone for a replace, or `drawn` added to or taken
 * from `prev` (the area there was, null for none), as Photoshop's Shift and Alt drags do. A new array.
 */
export function combineArea(prev: Uint8Array | null, drawn: Uint8Array, op: MaskOp): Uint8Array {
	if (op === 'replace' || (!prev && op === 'add')) return drawn.slice()
	if (!prev) return new Uint8Array(drawn.length)
	const out = prev.slice()
	combineMask(out, drawn, op)
	return out
}

/** The rect around the set cells, or null when none is set. */
export function shapeBounds(cells: Uint8Array, size: number): CellRect | null {
	let x0 = size
	let z0 = size
	let x1 = -1
	let z1 = -1
	for (let z = 0; z < size; z++) {
		const row = z * size
		for (let x = 0; x < size; x++) {
			if (!cells[row + x]) continue
			if (x < x0) x0 = x
			if (x > x1) x1 = x
			if (z < z0) z0 = z
			if (z > z1) z1 = z
		}
	}
	return x1 < 0 ? null : { x0, z0, x1: x1 + 1, z1: z1 + 1 }
}

/** Whether every cell of the bounds `r` is set, so the shape is the plain rect. */
export function fillsRect(cells: Uint8Array, size: number, r: CellRect): boolean {
	for (let z = r.z0; z < r.z1; z++) for (let x = r.x0; x < r.x1; x++) if (!cells[z * size + x]) return false
	return true
}

/** The cells of `r` cut out of a size by size bitmap, as a w by h one (1 inside). */
export function cellsInRect(cells: Uint8Array, size: number, r: CellRect): Uint8Array {
	const w = r.x1 - r.x0
	const h = r.z1 - r.z0
	const out = new Uint8Array(w * h)
	for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) out[z * w + x] = cells[(r.z0 + z) * size + r.x0 + x] ? 1 : 0
	return out
}

/**
 * For a w by h clip whose cells are `inside` (1 in, 0 out), how far each cell's centre is from the
 * nearest cell outside it or the clip's edge, in cells (half a cell for a cell on the edge), as the
 * paste's blend reads it. Out cells get 0.
 */
export function insideDistance(inside: Uint8Array, w: number, h: number): Float32Array {
	// Chamfer distance (3 straight, 4 diagonal) to the outside, counting beyond the clip as outside.
	const W = w + 2
	const H = h + 2
	const d = new Float32Array(W * H)
	for (let z = 0; z < H; z++) {
		for (let x = 0; x < W; x++) {
			const ix = x - 1
			const iz = z - 1
			const isIn = ix >= 0 && iz >= 0 && ix < w && iz < h && inside[iz * w + ix]
			d[z * W + x] = isIn ? Infinity : 0
		}
	}
	const relax = (p: number, q: number, step: number) => {
		const v = d[q] + step
		if (v < d[p]) d[p] = v
	}
	for (let z = 1; z < H - 1; z++) {
		for (let x = 1; x < W - 1; x++) {
			const p = z * W + x
			relax(p, p - 1, 3)
			relax(p, p - W, 3)
			relax(p, p - W - 1, 4)
			relax(p, p - W + 1, 4)
		}
	}
	for (let z = H - 2; z >= 1; z--) {
		for (let x = W - 2; x >= 1; x--) {
			const p = z * W + x
			relax(p, p + 1, 3)
			relax(p, p + W, 3)
			relax(p, p + W + 1, 4)
			relax(p, p + W - 1, 4)
		}
	}
	const out = new Float32Array(w * h)
	for (let z = 0; z < h; z++) {
		for (let x = 0; x < w; x++) {
			if (!inside[z * w + x]) continue
			// A cell next to the outside is 3 away centre to centre; its centre is half a cell from the edge.
			out[z * w + x] = d[(z + 1) * W + x + 1] / 3 - 0.5
		}
	}
	return out
}

/** A w by h cell bitmap turned a quarter turn clockwise, as rotateClip turns a clip's cells. */
export function rotateCells(cells: Uint8Array, w: number, h: number): Uint8Array {
	const out = new Uint8Array(cells.length)
	for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) out[(w - 1 - x) * h + z] = cells[z * w + x]
	return out
}

/** A w by h cell bitmap mirrored across its middle, as mirrorClip flips a clip's cells. */
export function mirrorCells(cells: Uint8Array, w: number, h: number, axis: 'x' | 'z'): Uint8Array {
	const out = new Uint8Array(cells.length)
	for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) out[(axis === 'x' ? z : h - 1 - z) * w + (axis === 'x' ? w - 1 - x : x)] = cells[z * w + x]
	return out
}
