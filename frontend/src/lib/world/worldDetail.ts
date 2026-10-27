import { NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../terrain/chunkPaint'
import { CHUNK_CELLS, LIQUID_VERTS, TILE_CHUNKS, TILE_YARDS } from '../wow/format'
import { GROUND_CELLS, type TileGround } from './worldGround'
import { PAINT_SIDE, type TilePaintIn } from './worldPaint'
import type { TileLiquid } from './worldLiquid'

// What View › Detail info says about a world view's ground (#15), from what the stream holds of the
// tile under the cursor: its ground, its texture layers once read (near the camera) and its liquids.
// The same readout as a region's (`Engine.detailInfo`), cell by cell within the tile.

/** A cell's side in yards. */
const CELL = TILE_YARDS / GROUND_CELLS

/** A loaded tile of a world view: where it is and what has been read of it. */
export interface WorldTileData {
	x: number
	y: number
	ground: TileGround
	/** Its texture layers, null until read (only the tiles near the camera are). */
	paint: TilePaintIn | null
	liquids: readonly TileLiquid[] | null
}

/** The ground at one point of a loaded tile. */
export interface WorldCellDetail {
	/** The chunk in the tile and the cell in the tile, east then south. */
	chunkX: number
	chunkY: number
	cellX: number
	cellY: number
	hole: boolean
	/** The cell's no-tufts bit: no ground effect grows there. */
	noTufts: boolean
	/** The chunk's AreaTable ID (0 for none) and its impassable flag. */
	area: number
	impassable: boolean
	/** The chunk's texture layers by slot, with the share each takes of the cell (0 to 1); null when the tile's paint isn't read. */
	textures: Array<{ path: string; weight: number }> | null
	/** The liquid layers covering the cell, with their surface height at the cell's north-west corner. */
	liquids: Array<{ type: number; height: number }>
}

/** What tile `t` holds at the world point (x, z), which must be in the tile. */
export function worldCellDetail(t: WorldTileData, x: number, z: number): WorldCellDetail {
	const cellX = Math.min(GROUND_CELLS - 1, Math.max(0, Math.floor((x - t.x * TILE_YARDS) / CELL)))
	const cellY = Math.min(GROUND_CELLS - 1, Math.max(0, Math.floor((z - t.y * TILE_YARDS) / CELL)))
	const chunkX = Math.floor(cellX / CHUNK_CELLS)
	const chunkY = Math.floor(cellY / CHUNK_CELLS)
	const chunk = chunkY * TILE_CHUNKS + chunkX
	let textures: WorldCellDetail['textures'] = null
	const p = t.paint
	if (p) {
		// The share of each slot over the cell's texels, as a region's readout sums them.
		const sums = [0, 0, 0, 0]
		for (let v = 0; v < SPLAT_PER_CELL; v++) {
			let i = ((cellY * SPLAT_PER_CELL + v) * PAINT_SIDE + cellX * SPLAT_PER_CELL) * SLOTS
			for (let u = 0; u < SPLAT_PER_CELL; u++, i += SLOTS) for (let k = 0; k < SLOTS; k++) sums[k] += p.weights[i + k]
		}
		textures = []
		for (let k = 0; k < SLOTS; k++) {
			const idx = p.slots[chunk * SLOTS + k]
			if (idx === NO_TEXTURE) continue
			textures.push({ path: p.names[idx] ?? '', weight: sums[k] / (SPLAT_PER_CELL * SPLAT_PER_CELL * 255) })
		}
	}
	const lx = cellX % CHUNK_CELLS
	const ly = cellY % CHUNK_CELLS
	const liquids: WorldCellDetail['liquids'] = []
	for (const l of t.liquids ?? []) {
		if (l.indexX !== chunkX || l.indexY !== chunkY || !l.cells[ly * CHUNK_CELLS + lx]) continue
		liquids.push({ type: l.type, height: l.heights[ly * LIQUID_VERTS + lx] })
	}
	const cell = cellY * GROUND_CELLS + cellX
	const g = t.ground
	return { chunkX, chunkY, cellX, cellY, hole: g.holes[cell] !== 0, noTufts: g.noEffect[cell] !== 0, area: g.areas[chunk], impassable: g.impassable[chunk] !== 0, textures, liquids }
}
