import { MAP_TILES } from '../wow/format'

// A map made for the client sits on the client's 64×64 tile grid (#46, the owner's 1A to 5A): its
// terrain is one square, the smallest that holds its tiles, at the grid tile `tileX`, `tileY` of its
// VmangosRef, and a mask (`tiles`) says which tiles of the square are the map's. A tile left out is not
// drawn, picked or published, and keeps its ground in the file, so adding it back restores it.

/** The most tiles a side a new world's square may have (the owner's 2A, as Part of Azeroth). */
export const MAX_WORLD_TILES = 8

/** A square of tiles on the grid: its north-west tile, and its side in tiles. */
export interface TileSquare {
	x: number
	y: number
	size: number
}

/** A tile's key on the grid. */
export const gridTile = (x: number, y: number) => y * MAP_TILES + x
/** A key's tile. */
export const tileOf = (id: number) => ({ x: id % MAP_TILES, y: Math.floor(id / MAP_TILES) })

/**
 * The smallest square on the grid that holds every tile of `tiles` and the whole of `keep` (the square a
 * map has already, which never shrinks), kept on the grid; null for no tiles and no square.
 */
export function boundingSquare(tiles: Iterable<number>, keep?: TileSquare | null): TileSquare | null {
	let x0 = Infinity,
		y0 = Infinity,
		x1 = -Infinity,
		y1 = -Infinity
	for (const id of tiles) {
		const t = tileOf(id)
		x0 = Math.min(x0, t.x)
		y0 = Math.min(y0, t.y)
		x1 = Math.max(x1, t.x)
		y1 = Math.max(y1, t.y)
	}
	if (keep) {
		x0 = Math.min(x0, keep.x)
		y0 = Math.min(y0, keep.y)
		x1 = Math.max(x1, keep.x + keep.size - 1)
		y1 = Math.max(y1, keep.y + keep.size - 1)
	}
	if (x0 > x1) return null
	const size = Math.max(x1 - x0 + 1, y1 - y0 + 1)
	// The square reaches east and south from the tiles' corner, unless the grid ends first.
	return { x: Math.min(x0, MAP_TILES - size), y: Math.min(y0, MAP_TILES - size), size }
}

/** The mask of `square` for `tiles`: a '1' for each of its tiles in the set, else '0', row by row; '' when every one is. */
export function maskOf(square: TileSquare, tiles: ReadonlySet<number>): string {
	let s = ''
	for (let ty = 0; ty < square.size; ty++) for (let tx = 0; tx < square.size; tx++) s += tiles.has(gridTile(square.x + tx, square.y + ty)) ? '1' : '0'
	return s.includes('0') ? s : ''
}

/** A map's place and mask, as its VmangosRef holds them. */
export interface TilePlace {
	tileX?: number
	tileY?: number
	tiles?: string
}

/** The square of a map `size` tiles a side placed by `p`. */
export const squareOf = (p: TilePlace, size: number): TileSquare => ({ x: p.tileX ?? 0, y: p.tileY ?? 0, size })

/** The mask as a byte a tile (1 a present one) for a square `size` tiles a side; null when every tile is present. */
export function maskBytes(mask: string | undefined, size: number): Uint8Array | null {
	if (!mask || mask.length !== size * size || !mask.includes('0')) return null
	const out = new Uint8Array(size * size)
	for (let i = 0; i < out.length; i++) out[i] = mask.charCodeAt(i) === 49 ? 1 : 0
	return out
}

/** The grid tiles of a map `size` tiles a side placed by `p`: its square's, less those its mask leaves out. */
export function placeTiles(p: TilePlace, size: number): Set<number> {
	const sq = squareOf(p, size)
	const mask = maskBytes(p.tiles, size)
	const out = new Set<number>()
	for (let ty = 0; ty < size; ty++) for (let tx = 0; tx < size; tx++) if (!mask || mask[ty * size + tx]) out.add(gridTile(sq.x + tx, sq.y + ty))
	return out
}

/** What a click on the tile grid does: add a tile, add the 3×3 tiles round it (Shift), or take one away (Ctrl), as Noggit Red's wizard. */
export type TileOp = 'add' | 'add3' | 'remove'

/**
 * `tiles` with the tile (x, y) added or taken away by `op`, or why not: a map keeps one tile at least,
 * and its square, with `keep`'s (the map's square now, which can't shrink), is at most `max` a side.
 * Tiles of a 3×3 off the grid are left out.
 */
export function editTiles(tiles: ReadonlySet<number>, x: number, y: number, op: TileOp, keep?: TileSquare | null, max = MAX_WORLD_TILES): { tiles: Set<number> } | { error: string } {
	const out = new Set(tiles)
	if (op === 'remove') out.delete(gridTile(x, y))
	else {
		const r = op === 'add3' ? 1 : 0
		for (let ty = y - r; ty <= y + r; ty++) for (let tx = x - r; tx <= x + r; tx++) if (tx >= 0 && ty >= 0 && tx < MAP_TILES && ty < MAP_TILES) out.add(gridTile(tx, ty))
	}
	if (!out.size) return { error: 'A map keeps one tile at least.' }
	const sq = boundingSquare(out, keep)
	if (sq && sq.size > max) return { error: `A map's tiles fit in a square of ${max}×${max} tiles.` }
	return { tiles: out }
}
