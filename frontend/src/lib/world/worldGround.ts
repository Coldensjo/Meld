import { tileKey } from '../io/mapTiles'
import { TILE_SIZE as TILE_YARDS } from '../io/portCoords'

// The world view's ground (#15), kept free of three.js so it can be tested: one client tile as
// /wow/ground sends it (wow.EncodeGround), the mesh arrays it is drawn with, its height under a point,
// and which tiles to keep loaded around the camera. The world view's coordinates are the whole map's
// editor coordinates (io/portCoords.ts `editorPoint`): tile (x, y) spans x*TILE_YARDS to
// (x+1)*TILE_YARDS east and y*TILE_YARDS to (y+1)*TILE_YARDS south.

/** The cells a side of a client tile. */
export const GROUND_CELLS = 128
/** The height samples a side of a client tile. */
export const GROUND_SIDE = GROUND_CELLS + 1
/** A cell's side in yards (Terrain's CELL_SIZE; that module needs the runes state, which the tests lack). */
const CELL_SIZE = TILE_YARDS / GROUND_CELLS

/** One tile's ground: its outer heights (row by row, rows running south) and a byte a cell, 1 for a hole. */
export interface TileGround {
	heights: Float32Array
	holes: Uint8Array
}

/** Reads a /wow/ground reply: "GRND", GROUND_SIDE² float32 heights, then GROUND_CELLS² hole bytes. */
export function parseGround(buf: ArrayBuffer): TileGround {
	const n = GROUND_SIDE * GROUND_SIDE
	const cells = GROUND_CELLS * GROUND_CELLS
	const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))
	if (String.fromCharCode(...head) !== 'GRND' || buf.byteLength !== 4 + n * 4 + cells) throw new Error(`not a tile's ground (${buf.byteLength} bytes)`)
	// The heights start at byte 4, which a Float32Array may view directly.
	return { heights: new Float32Array(buf, 4, n), holes: new Uint8Array(buf, 4 + n * 4, cells) }
}

/**
 * The mesh of one tile, in the tile's own frame (its north-west corner at the origin, the mesh placed
 * there): a vertex a height sample, its normal from the samples around it, its uv across the tile
 * (the minimap image's), and two triangles a cell but for the holes.
 */
export function groundMesh(g: TileGround): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; index: Uint16Array } {
	const S = GROUND_SIDE
	const h = g.heights
	const positions = new Float32Array(S * S * 3)
	const normals = new Float32Array(S * S * 3)
	const uvs = new Float32Array(S * S * 2)
	const at = (x: number, y: number) => h[Math.min(S - 1, Math.max(0, y)) * S + Math.min(S - 1, Math.max(0, x))]
	for (let y = 0; y < S; y++) {
		for (let x = 0; x < S; x++) {
			const i = y * S + x
			positions[i * 3] = x * CELL_SIZE
			positions[i * 3 + 1] = h[i]
			positions[i * 3 + 2] = y * CELL_SIZE
			// Central differences, one-sided at the tile's edge.
			const run = (Math.min(x + 1, S - 1) - Math.max(x - 1, 0)) * CELL_SIZE
			const fall = (Math.min(y + 1, S - 1) - Math.max(y - 1, 0)) * CELL_SIZE
			const nx = -(at(x + 1, y) - at(x - 1, y)) / run
			const nz = -(at(x, y + 1) - at(x, y - 1)) / fall
			const len = Math.hypot(nx, 1, nz)
			normals[i * 3] = nx / len
			normals[i * 3 + 1] = 1 / len
			normals[i * 3 + 2] = nz / len
			uvs[i * 2] = x / GROUND_CELLS
			uvs[i * 2 + 1] = y / GROUND_CELLS
		}
	}
	let solid = 0
	for (const v of g.holes) if (!v) solid++
	const index = new Uint16Array(solid * 6)
	let k = 0
	for (let y = 0; y < GROUND_CELLS; y++) {
		for (let x = 0; x < GROUND_CELLS; x++) {
			if (g.holes[y * GROUND_CELLS + x]) continue
			const a = y * S + x
			const b = a + 1
			const c = a + S
			const d = c + 1
			// Counter-clockwise seen from above (+y), so the ground's top faces the sky.
			index[k++] = a
			index[k++] = c
			index[k++] = b
			index[k++] = b
			index[k++] = c
			index[k++] = d
		}
	}
	return { positions, normals, uvs, index }
}

/** The ground's height at (u, v) cells into the tile (0 to GROUND_CELLS), between its four samples. */
export function groundHeight(g: TileGround, u: number, v: number): number {
	const x = Math.min(GROUND_CELLS - 1, Math.max(0, Math.floor(u)))
	const y = Math.min(GROUND_CELLS - 1, Math.max(0, Math.floor(v)))
	const fx = Math.min(1, Math.max(0, u - x))
	const fy = Math.min(1, Math.max(0, v - y))
	const h = g.heights
	const i = y * GROUND_SIDE + x
	const top = h[i] + (h[i + 1] - h[i]) * fx
	const bottom = h[i + GROUND_SIDE] + (h[i + GROUND_SIDE + 1] - h[i + GROUND_SIDE]) * fx
	return top + (bottom - top) * fy
}

/** How far a point is from tile (tx, ty) across the ground, in yards: 0 inside it. */
export function tileDistance(x: number, z: number, tx: number, ty: number): number {
	const dx = Math.max(tx * TILE_YARDS - x, 0, x - (tx + 1) * TILE_YARDS)
	const dz = Math.max(ty * TILE_YARDS - z, 0, z - (ty + 1) * TILE_YARDS)
	return Math.hypot(dx, dz)
}

/**
 * The tiles of `have` (tileKey) to have loaded with the camera at (x, z): those within `reach` yards,
 * nearest first, so the ground under the camera comes first.
 */
export function wantedTiles(x: number, z: number, reach: number, have: ReadonlySet<number>): number[] {
	const r = Math.ceil(reach / TILE_YARDS) + 1
	const cx = Math.floor(x / TILE_YARDS)
	const cz = Math.floor(z / TILE_YARDS)
	const out: { key: number; d: number }[] = []
	for (let ty = Math.max(0, cz - r); ty <= Math.min(63, cz + r); ty++) {
		for (let tx = Math.max(0, cx - r); tx <= Math.min(63, cx + r); tx++) {
			const key = tileKey(tx, ty)
			if (!have.has(key)) continue
			const d = tileDistance(x, z, tx, ty)
			// Ties (the tiles the camera stands between) go by the distance to the tile's middle.
			if (d <= reach) out.push({ key, d: d + Math.hypot((tx + 0.5) * TILE_YARDS - x, (ty + 0.5) * TILE_YARDS - z) * 1e-3 })
		}
	}
	out.sort((a, b) => a.d - b.d)
	return out.map((t) => t.key)
}

/** How far the camera may go before a loaded tile is let go of: a tile past the reach it loads by. */
export function keepReach(reach: number): number {
	return reach + TILE_YARDS
}

/** The tiles the world view loads around the camera for the view distance preference (1 is the default): a radius of 3 tiles, 1 to 6. */
export function streamReach(viewDistance: number): number {
	return Math.min(6, Math.max(1, Math.round(3 * viewDistance))) * TILE_YARDS
}
