// The 1.12 format's sizes, the tile zero point and the axis swap between the editor's map and the
// server's (and the client's world), in one place (#538). Go has the same values in internal/adt and
// internal/mapfile; tests/format.test.ts checks both sides against tests/fixtures/format.json, which
// the Go test TestFormatFixture (internal/adt) writes with -update and checks otherwise.

/** A tile (ADT) is 533 1/3 yards across (adt.TileSize). */
export const TILE_YARDS = 1600 / 3
/** A map is 64 by 64 tiles (the WDT's grid). */
export const MAP_TILES = 64
/** The world coordinate of a map's first tile, measured from its middle: 32 tiles (adt.ZeroPoint). */
export const ZERO_POINT = 32 * TILE_YARDS
/** A tile is 16 by 16 chunks (adt.ChunksPerTile). */
export const TILE_CHUNKS = 16
/** A chunk is 8 by 8 cells (adt.CellsPerChunk, mapfile.ChunkCells). */
export const CHUNK_CELLS = 8
/** A tile is 128 by 128 cells. */
export const TILE_CELLS = TILE_CHUNKS * CHUNK_CELLS
/** A tile's outer height grid is 129 by 129 vertices. */
export const TILE_VERTS = TILE_CELLS + 1
/** A chunk holds up to 4 texture layers (mapfile.SlotsPerChunk). */
export const SLOTS = 4
/** A chunk's alpha map is 64 by 64 texels (adt.AlphaSize). */
export const ALPHA_SIZE = 64
/** A liquid chunk is 8 by 8 cells, with 9 by 9 vertices. */
export const LIQUID_CELLS = 8
export const LIQUID_VERTS = LIQUID_CELLS + 1
/** A liquid layer's record in the .wmap: id, flag, bounds, heights and depths (mapfile.LiquidRecordSize). */
export const LIQUID_RECORD_BYTES = 4 + 1 + 8 + LIQUID_VERTS * LIQUID_VERTS * 4 + LIQUID_VERTS * LIQUID_VERTS
/** A chunk's baked shadow map: 64 by 64 bits (adt.ShadowBytes). */
export const CHUNK_SHADOW_BYTES = (64 * 64) / 8

/**
 * The server's (x, y) of the editor point (x, z) in the block whose first tile is (tileX, tileY): the
 * axes swap and mirror, so the server's x is ZERO_POINT less the editor's z and its y is ZERO_POINT
 * less the editor's x. Height (the editor's y, the server's z) is unchanged. Go: adt.ToServer.
 */
export function toServer(x: number, z: number, tileX = 0, tileY = 0): { x: number; y: number } {
	return { x: ZERO_POINT - z - tileY * TILE_YARDS, y: ZERO_POINT - x - tileX * TILE_YARDS }
}

/** The inverse of toServer: the editor's (x, z) of the server point (x, y). Go: adt.FromServer. */
export function fromServer(x: number, y: number, tileX = 0, tileY = 0): { x: number; z: number } {
	return { x: ZERO_POINT - y - tileX * TILE_YARDS, z: ZERO_POINT - x - tileY * TILE_YARDS }
}
