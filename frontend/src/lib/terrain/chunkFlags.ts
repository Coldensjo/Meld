// The map data a chunk's header carries besides its ground: the zone it belongs to (an AreaTable.dbc
// ID per paint chunk), whether it can be walked (a flag per chunk), and the cells that grow no ground
// effect doodads (a byte per cell). The Map data tool paints them; the export writes them into the
// MCNK headers. Kept free of three.js so it can be tested on its own.

/** The chunk flag for a chunk players can't walk: the MCNK header's 0x2. */
export const CHUNK_IMPASSABLE = 1

/**
 * Writes a colour for an area ID into `out` at `at` (three bytes): black for 0 (no zone), else a hue
 * hashed from the ID, so neighbouring zones tell apart in the overlay.
 */
export function areaColor(id: number, out: Uint8Array, at: number) {
	if (!id) {
		out[at] = out[at + 1] = out[at + 2] = 0
		return
	}
	const h = (Math.imul(id, 2654435761) >>> 0) / 4294967296
	// HSV with full saturation and value, by sixths of the hue: in each sixth one channel is full, one
	// zero and one ramps up (f) or down (1 - f).
	const k = h * 6
	const sixth = Math.floor(k) % 6
	const f = k - Math.floor(k)
	const up = Math.round(f * 255)
	const down = Math.round((1 - f) * 255)
	let r = 0
	let g = 0
	let b = 0
	switch (sixth) {
		case 0:
			r = 255
			g = up
			break
		case 1:
			r = down
			g = 255
			break
		case 2:
			g = 255
			b = up
			break
		case 3:
			g = down
			b = 255
			break
		case 4:
			r = up
			b = 255
			break
		default:
			r = 255
			b = down
	}
	out[at] = r
	out[at + 1] = g
	out[at + 2] = b
}

/** An inclusive rect of chunks or cells. */
export interface GridRect {
	x0: number
	z0: number
	x1: number
	z1: number
}

/**
 * Calls `fn` with each grid square (`step` yards a side, `side` a row) whose centre is within `radius`
 * of (x, z), and writes the inclusive rect they span into `out`. Returns false when there is none.
 */
export function forEachSquare(side: number, step: number, x: number, z: number, radius: number, out: GridRect, fn: (i: number) => void): boolean {
	const x0 = Math.max(0, Math.floor((x - radius) / step))
	const z0 = Math.max(0, Math.floor((z - radius) / step))
	const x1 = Math.min(side - 1, Math.floor((x + radius) / step))
	const z1 = Math.min(side - 1, Math.floor((z + radius) / step))
	let any = false
	const r2 = radius * radius
	for (let gz = z0; gz <= z1; gz++) {
		for (let gx = x0; gx <= x1; gx++) {
			const dx = (gx + 0.5) * step - x
			const dz = (gz + 0.5) * step - z
			if (dx * dx + dz * dz > r2) continue
			fn(gz * side + gx)
			if (!any) {
				out.x0 = out.x1 = gx
				out.z0 = out.z1 = gz
				any = true
			} else {
				out.x0 = Math.min(out.x0, gx)
				out.z0 = Math.min(out.z0, gz)
				out.x1 = Math.max(out.x1, gx)
				out.z1 = Math.max(out.z1, gz)
			}
		}
	}
	return any
}

/**
 * The squares under the brush, or, when the brush is smaller than one square, the square under its
 * centre, so a small brush still reaches the chunk it is over.
 */
export function squaresUnder(side: number, step: number, x: number, z: number, radius: number, out: GridRect, fn: (i: number) => void): boolean {
	if (forEachSquare(side, step, x, z, radius, out, fn)) return true
	const gx = Math.floor(x / step)
	const gz = Math.floor(z / step)
	if (gx < 0 || gz < 0 || gx >= side || gz >= side) return false
	fn(gz * side + gx)
	out.x0 = out.x1 = gx
	out.z0 = out.z1 = gz
	return true
}
