import { CHUNK_CELLS, NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../terrain/chunkPaint'
import { liquidsToAdt, type AdtLiquid, type LiquidMap } from '../water/liquids'
import { chunkNoEffect } from '../world/groundEffects'
import { CHUNK_IMPASSABLE } from '../terrain/chunkFlags'
import { SHADOW_PER_CELL, chunkShadowBits } from '../terrain/bakedShadows'
import { floatsToBase64 } from './base64'
import { TILE_CELLS, TILE_CHUNKS, TILE_VERTS } from '../wow/format'

/** A palette entry that's a colour rather than a texture. */
const isColor = (entry: string) => /^#[0-9a-fA-F]{6}$/.test(entry)

// Splits a map into the 1.12 tiles the client and server read: each tile is 128 cells square, and the
// map's heights, paint and models are cut to fit them. The output is the Go side's MapSpec (see
// internal/vmangos/export.go), with the paint's weights as base64.

/** Cells in a 1.12 tile a side. */
export { TILE_CELLS }
/** Paint chunks in a tile a side. */
const CHUNKS_PER_TILE = TILE_CHUNKS
/** Splat texels in a chunk a side. */
const TEXELS_PER_CHUNK = CHUNK_CELLS * SPLAT_PER_CELL

export interface ExportObject {
	/** 'm2:<path>' or 'wmo:<path>'. */
	type: string
	/** World position in yards, the map's own coordinates. */
	x: number
	y: number
	z: number
	rotY: number
	tiltX?: number
	tiltZ?: number
	scale: number
}

export interface ExportInput {
	/** Cells a side of the map; a multiple of TILE_CELLS. */
	size: number
	/** Yards a cell. */
	cellSize: number
	/** (size+1)^2 heights. */
	heights: Float32Array
	/** SPLAT_PER_CELL * size texels a side, four weights per texel. */
	weights: Uint8Array
	/** Four palette indices per paint chunk, for the map's (size/CHUNK_CELLS) chunks a side. */
	chunkSlots: Uint8Array
	/** The palette: a WoW tileset path or a colour per index. */
	palette: readonly string[]
	/** The ground effect (GroundEffectTexture ID, 0 for none) per palette index; optional. */
	effects?: readonly number[]
	/** The look flags (world/textureLooks.ts) per palette index, -1 to keep the tile's own; optional. */
	looks?: readonly number[]
	/**
	 * The effect a palette texture grows in a paint chunk (gx, gz) of the map, where the map chooses per
	 * zone or tile; optional, `effects` otherwise.
	 */
	effectAt?: (tex: number, gx: number, gz: number) => number
	/** One byte per cell, set where no ground effect doodads grow (under buildings); optional. */
	noEffect?: Uint8Array
	/**
	 * Each paint chunk's AreaTable.dbc ID and flags (CHUNK_IMPASSABLE), for the chunk headers; optional,
	 * which leaves the zones, impassable flags and no-tuft cells as the tile has them (#644).
	 */
	headers?: { areaIds: Uint32Array; chunkFlags: Uint8Array }
	/**
	 * One byte per cell, non-zero where the ground is a hole; sent in the chunk headers, with or without
	 * `headers`. Without, the tiles keep their own.
	 */
	holes?: Uint8Array
	/**
	 * Whether `holes` are added to the tiles' own rather than replacing them, for a map that doesn't know
	 * the client's holes (saved before the file kept them, #663): only the chunks with a hole send any.
	 */
	holesAdd?: boolean
	/**
	 * The baked shadows, a byte per texel (terrain/bakedShadows.ts, `size * SHADOW_PER_CELL` a side);
	 * sent in the chunk headers, with or without `headers`. Without, the tiles keep their own.
	 */
	shadows?: Uint8Array
	objects: readonly ExportObject[]
	/** Whether the map has water, and the level it's at in yards. */
	waterEnabled: boolean
	waterLevel: number
	/** The painted liquids, if any. */
	liquids?: LiquidMap
}

export interface PaintOut {
	Chunk: number
	Textures: string[]
	Weights: string
	/** The ground effect per texture, in the same order (0 for none, which keeps the tile's own). */
	Effects: number[]
	/** The look flags per texture, in the same order (-1 keeps the tile's own); only when the map sets one. */
	Flags?: number[]
	/** The no-doodad bits, one per cell row with a bit per cell, where any is set (added to the tile's own). */
	NoEffect?: number[]
}

/** A chunk's header fields, as the Go side's HeaderSpec has them. */
export interface HeaderOut {
	/** The chunk's index in the tile (y*16 + x), or in the block for a region save. */
	chunk: number
	/** AreaTable.dbc ID; 0 keeps the tile's own. */
	areaId: number
	/** Sets or clears the impassable flag; absent keeps the tile's own (a map without chunk data, #644). */
	impassable?: boolean
	/** The cells that grow no ground effect doodads, a bit per cell in each row; replaces the tile's own. */
	noEffect?: number[]
	/** The hole cells, a bit per cell in each row; Go turns them into the client's 2x2-cell blocks. */
	holes?: number[]
	/** Adds `holes` to the tile's own instead of replacing them (a map that doesn't know them, #663). */
	holesAdd?: boolean
	/** The chunk's baked shadow map in the client's form (512 bytes, base64); replaces the tile's own. */
	shadow?: string
}

export interface ObjectOut {
	Type: string
	X: number
	Y: number
	Z: number
	RotY: number
	/** The model's tilt forward and back, and side to side, in radians, as vmangos.ObjectSpec reads them (#229). */
	TiltX: number
	TiltZ: number
	Scale: number
}

export interface TileOut {
	X: number
	Y: number
	/** The tile's 129 x 129 heights as base64 of their float32s, as vmangos.HeightGrid reads them (#632). */
	Outer: string
	Paint: PaintOut[]
	Objects: ObjectOut[]
	/** The tile's liquid layers, each placed by its chunk in the tile. */
	Liquids: AdtLiquid[]
	/** Every chunk's header fields, when the map sends any (chunk data, holes or baked shadows). */
	Headers?: HeaderOut[]
}

/**
 * Where a map made for the client sits on the client's 64×64 grid and which of its square's tiles are
 * its own (#46): `x`, `y` the tile at the map's north-west corner, `present` a byte a tile row by row (1
 * a present one; null for every tile).
 */
export interface TileLayout {
	x: number
	y: number
	present?: Uint8Array | null
}

export interface ExportOut {
	tiles: TileOut[]
	/** Chunks whose paint uses a colour rather than a texture, which the client can't show, so it isn't written. */
	colorChunks: number
	/** Models outside the map, or on a tile left out of it, which aren't written. */
	outside: number
}

/**
 * The map as tiles. Throws when the map's size doesn't cut into whole tiles. Every tile of the map
 * is written, since each one needs its file for the client to walk it, but those `layout` leaves out;
 * the tiles are numbered from `layout`'s corner on the grid (0,0 without one).
 */
export function mapToTiles(input: ExportInput, layout?: TileLayout): ExportOut {
	if (input.size % TILE_CELLS !== 0) throw new Error(`the map is ${input.size} cells, not a whole number of 128-cell tiles`)
	const tilesPerSide = input.size / TILE_CELLS
	const V = input.size + 1
	const tileYards = TILE_CELLS * input.cellSize
	const splatRes = input.size * SPLAT_PER_CELL
	const paintSide = input.size / CHUNK_CELLS
	const tiles: TileOut[] = []
	let colorChunks = 0

	// Models, by the tile they stand in.
	const objectsOf = (tx: number, ty: number): ObjectOut[] =>
		input.objects
			.filter((o) => Math.floor(o.x / tileYards) === tx && Math.floor(o.z / tileYards) === ty)
			.map((o) => ({
				Type: o.type,
				X: o.x - tx * tileYards,
				Y: o.y,
				Z: o.z - ty * tileYards,
				RotY: o.rotY,
				TiltX: o.tiltX ?? 0,
				TiltZ: o.tiltZ ?? 0,
				Scale: o.scale,
			}))
	const extent = input.size * input.cellSize
	const present = layout?.present && layout.present.length === tilesPerSide * tilesPerSide ? layout.present : null
	const isIn = (tx: number, ty: number) => !present || present[ty * tilesPerSide + tx] !== 0
	const outside = input.objects.filter((o) => o.x < 0 || o.z < 0 || o.x >= extent || o.z >= extent || !isIn(Math.floor(o.x / tileYards), Math.floor(o.z / tileYards))).length
	const gx0 = layout?.x ?? 0
	const gy0 = layout?.y ?? 0

	for (let ty = 0; ty < tilesPerSide; ty++) {
		for (let tx = 0; tx < tilesPerSide; tx++) {
			if (!isIn(tx, ty)) continue
			const outer = new Float32Array(TILE_VERTS * TILE_VERTS)
			for (let r = 0; r <= TILE_CELLS; r++) {
				for (let c = 0; c <= TILE_CELLS; c++) {
					outer[r * TILE_VERTS + c] = input.heights[(ty * TILE_CELLS + r) * V + tx * TILE_CELLS + c]
				}
			}

			const paint: PaintOut[] = []
			for (let cy = 0; cy < CHUNKS_PER_TILE; cy++) {
				for (let cx = 0; cx < CHUNKS_PER_TILE; cx++) {
					const gx = tx * CHUNKS_PER_TILE + cx
					const gz = ty * CHUNKS_PER_TILE + cy
					const chunk = gz * paintSide + gx
					// The chunk's textures that are in use, in slot order. A slot without one is dropped.
					const used: number[] = []
					for (let k = 0; k < SLOTS; k++) {
						const i = input.chunkSlots[chunk * SLOTS + k]
						if (i !== NO_TEXTURE) used.push(k)
					}
					if (used.length === 0) continue
					const names = used.map((k) => input.palette[input.chunkSlots[chunk * SLOTS + k]] ?? '')
					const effects = used.map((k) => (input.effectAt ? input.effectAt(input.chunkSlots[chunk * SLOTS + k], gx, gz) : (input.effects?.[input.chunkSlots[chunk * SLOTS + k]] ?? 0)))
					if (names.some((n) => !n || isColor(n))) {
						colorChunks++
						continue
					}
					// Four weights per texel, in the used slots' order.
					const weights = new Uint8Array(TEXELS_PER_CHUNK * TEXELS_PER_CHUNK * SLOTS)
					for (let v = 0; v < TEXELS_PER_CHUNK; v++) {
						for (let u = 0; u < TEXELS_PER_CHUNK; u++) {
							const z = gz * TEXELS_PER_CHUNK + v
							const x = gx * TEXELS_PER_CHUNK + u
							const src = (z * splatRes + x) * SLOTS
							const dst = (v * TEXELS_PER_CHUNK + u) * SLOTS
							used.forEach((k, j) => (weights[dst + j] = input.weights[src + k]))
						}
					}
					const out: PaintOut = { Chunk: cy * CHUNKS_PER_TILE + cx, Textures: names, Weights: toBase64(weights), Effects: effects }
					const flags = used.map((k) => input.looks?.[input.chunkSlots[chunk * SLOTS + k]] ?? -1)
					if (flags.some((f) => f >= 0)) out.Flags = flags
					const noEffect = input.noEffect ? chunkNoEffect(input.noEffect, input.size, gx, gz) : null
					if (noEffect) out.NoEffect = noEffect
					paint.push(out)
				}
			}

			const liquids = input.liquids ? liquidsToAdt(input.liquids, tx * CHUNKS_PER_TILE, ty * CHUNKS_PER_TILE, CHUNKS_PER_TILE) : []
			const tile: TileOut = { X: gx0 + tx, Y: gy0 + ty, Outer: floatsToBase64(outer), Paint: paint, Objects: objectsOf(tx, ty), Liquids: liquids }
			const h = input.headers
			// Holes and baked shadows travel in the headers too, so a map without chunk data of its own
			// still sends them, with area ID 0 and no impassable flag or no-tuft rows, which keep the tile's (#644).
			if (h || input.holes || input.shadows) {
				tile.Headers = []
				for (let cy = 0; cy < CHUNKS_PER_TILE; cy++) {
					for (let cx = 0; cx < CHUNKS_PER_TILE; cx++) {
						const chunk = (ty * CHUNKS_PER_TILE + cy) * paintSide + tx * CHUNKS_PER_TILE + cx
						const gx = tx * CHUNKS_PER_TILE + cx
						const gz = ty * CHUNKS_PER_TILE + cy
						const header: HeaderOut = { chunk: cy * CHUNKS_PER_TILE + cx, areaId: 0 }
						if (h) {
							header.areaId = h.areaIds[chunk]
							header.impassable = (h.chunkFlags[chunk] & CHUNK_IMPASSABLE) !== 0
							// The map holds every no-tuft cell (the client's, the painted ones and, in noEffect,
							// those under its buildings), so the header's bits are replaced and a cleared cell comes off.
							if (input.noEffect) header.noEffect = chunkNoEffect(input.noEffect, input.size, gx, gz) ?? new Array<number>(CHUNK_CELLS).fill(0)
						}
						if (input.holes) {
							const holes = chunkNoEffect(input.holes, input.size, gx, gz)
							// Added to the client's, a chunk without any of the map's sends none and keeps its own.
							if (input.holesAdd) {
								if (holes) {
									header.holes = holes
									header.holesAdd = true
								}
							} else header.holes = holes ?? new Array<number>(CHUNK_CELLS).fill(0)
						}
						if (input.shadows) header.shadow = toBase64(chunkShadowBits(input.shadows, input.size * SHADOW_PER_CELL, gx, gz))
						tile.Headers.push(header)
					}
				}
			}
			tiles.push(tile)
		}
	}
	return { tiles, colorChunks, outside }
}

/** Base64 of bytes, in chunks, so large weight arrays don't overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
	let s = ''
	for (let i = 0; i < bytes.length; i += 0x8000) {
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	}
	return btoa(s)
}
