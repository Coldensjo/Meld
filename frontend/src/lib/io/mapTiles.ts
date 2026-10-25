import type { TileBlock } from './regionGrow'
import { MAP_TILES } from '../wow/format'

// The tiles a client map has (its WDT's MAIN table, served by /wow/tiles), and the checks the region
// picker makes against them: a block can only be opened where every tile has an ADT (#222).

/** The side of a client map, in tiles. */
const SIDE = MAP_TILES

/** A tile's key in a set of tiles: x + 64 * y, the WDT's own order. */
export function tileKey(x: number, y: number): number {
	return x + SIDE * y
}

/** How many tiles of block have no ADT. */
export function blockGaps(block: TileBlock, have: ReadonlySet<number>): number {
	let gaps = 0
	for (let y = block.y; y < block.y + block.size; y++) {
		for (let x = block.x; x < block.x + block.size; x++) if (!have.has(tileKey(x, y))) gaps++
	}
	return gaps
}

/**
 * The biggest square of at most maxSize tiles a side that lies wholly on the map's tiles, the
 * first one found in reading order; null for a map with no tiles. It is what the picker selects
 * on an instance, whose few tiles are hard to find on the 64x64 grid.
 */
export function fullBlock(tiles: ReadonlyArray<{ X: number; Y: number }>, maxSize: number): TileBlock | null {
	if (!tiles.length) return null
	const have = new Set(tiles.map((t) => tileKey(t.X, t.Y)))
	let x0 = SIDE,
		y0 = SIDE,
		x1 = 0,
		y1 = 0
	for (const t of tiles) {
		x0 = Math.min(x0, t.X)
		y0 = Math.min(y0, t.Y)
		x1 = Math.max(x1, t.X + 1)
		y1 = Math.max(y1, t.Y + 1)
	}
	for (let size = Math.min(maxSize, x1 - x0, y1 - y0); size >= 1; size--) {
		for (let y = y0; y + size <= y1; y++) {
			for (let x = x0; x + size <= x1; x++) {
				const b = { x, y, size }
				if (blockGaps(b, have) === 0) return b
			}
		}
	}
	return null
}
