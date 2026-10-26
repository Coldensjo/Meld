// The minimap of a world view (#15): the client's overview of the whole map (64 tiles a side) cut to
// the square that holds the map's tiles, so the tiles fill it whatever the map's shape.

/** Tiles a side of a map. */
const SIDE = 64

/** A square of tiles: its north-west tile and how many tiles a side. */
export interface TileSquare {
	x: number
	y: number
	n: number
}

/**
 * The smallest square that holds every tile of `keys` (tileKey: x + 64 * y), the tiles centred in it
 * and the square kept on the map, or null for none.
 */
export function worldExtent(keys: Iterable<number>): TileSquare | null {
	let x0 = SIDE,
		y0 = SIDE,
		x1 = -1,
		y1 = -1
	for (const k of keys) {
		const x = k % SIDE
		const y = Math.floor(k / SIDE)
		if (x < x0) x0 = x
		if (x > x1) x1 = x
		if (y < y0) y0 = y
		if (y > y1) y1 = y
	}
	if (x1 < 0) return null
	const n = Math.max(x1 - x0, y1 - y0) + 1
	const place = (lo: number, hi: number) => Math.min(SIDE - n, Math.max(0, lo - Math.floor((n - (hi - lo + 1)) / 2)))
	return { x: place(x0, x1), y: place(y0, y1), n }
}
