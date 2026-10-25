import { MAP_TILES } from '../wow/format'

// Growing an open region by a tile: the block stays square (the editor's terrain is square), so a
// plus on one side adds that side's tiles and one more row or column along the other axis, kept
// toward the east or south unless the map's edge is there.

export type Side = 'n' | 'e' | 's' | 'w'

export interface TileBlock {
	x: number
	y: number
	size: number
}

/** A continent is 64 tiles a side. */
export { MAP_TILES }
/** The most tiles a side a region can have (internal/vmangos/region.go). */
export const MAX_REGION = 16

/**
 * The block one tile bigger on `side`, or null when the region is at its largest or the map ends
 * there. The extra tile along the other axis goes east or south, else west or north.
 */
export function grownBlock(b: TileBlock, side: Side, mapTiles = MAP_TILES, max = MAX_REGION): TileBlock | null {
	if (b.size >= max) return null
	const size = b.size + 1
	let x = b.x
	let y = b.y
	if (side === 'w') x = b.x - 1
	else if (side === 'e' && b.x + size > mapTiles) return null
	if (side === 'n') y = b.y - 1
	else if (side === 's' && b.y + size > mapTiles) return null
	if (x < 0 || y < 0) return null
	// The other axis: keep the origin (grow east or south) when the map has room, else grow the other way.
	if (side === 'n' || side === 's') {
		if (x + size > mapTiles) x = mapTiles - size
	} else if (y + size > mapTiles) y = mapTiles - size
	if (x < 0 || y < 0) return null
	return { x, y, size }
}

/** Which sides of a block can grow. */
export function growableSides(b: TileBlock, mapTiles = MAP_TILES, max = MAX_REGION): Side[] {
	return (['n', 'e', 's', 'w'] as Side[]).filter((s) => grownBlock(b, s, mapTiles, max) !== null)
}
