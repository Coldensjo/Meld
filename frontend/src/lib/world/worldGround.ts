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

/** The chunks a side of a client tile. */
const GROUND_CHUNKS = 16

/**
 * One tile's ground: its outer heights (row by row, rows running south); a byte a cell for a hole and
 * for the no-tufts bit (the chunk's noEffectDoodad bit), 1 where set; and a value a chunk (16x16, row
 * by row) for its AreaTable ID and its impassable flag (1 where set).
 */
export interface TileGround {
	heights: Float32Array
	holes: Uint8Array
	noEffect: Uint8Array
	areas: Uint32Array
	impassable: Uint8Array
}

/**
 * Reads a /wow/ground reply: "GRND", GROUND_SIDE² float32 heights, GROUND_CELLS² hole bytes, 256 uint32
 * area IDs, 256 impassable bytes, then GROUND_CELLS² no-tufts bytes (wow.EncodeGround).
 */
export function parseGround(buf: ArrayBuffer): TileGround {
	const n = GROUND_SIDE * GROUND_SIDE
	const cells = GROUND_CELLS * GROUND_CELLS
	const chunks = GROUND_CHUNKS * GROUND_CHUNKS
	const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))
	if (String.fromCharCode(...head) !== 'GRND' || buf.byteLength !== 4 + n * 4 + cells + chunks * 5 + cells) throw new Error(`not a tile's ground (${buf.byteLength} bytes)`)
	// The heights start at byte 4 and the areas after the holes, both 4-byte offsets a typed array may view directly.
	const areas = 4 + n * 4 + cells
	return {
		heights: new Float32Array(buf, 4, n),
		holes: new Uint8Array(buf, 4 + n * 4, cells),
		areas: new Uint32Array(buf, areas, chunks),
		impassable: new Uint8Array(buf, areas + chunks * 4, chunks),
		noEffect: new Uint8Array(buf, areas + chunks * 5, cells),
	}
}

/** How far a skirt hangs below the stray of its edge: past the WDL horizon's heights, which are whole yards cut toward 0. */
const SKIRT_MARGIN = 2

/** The strides a tile's ground is drawn at (#15): every sample near the camera, every second or fourth further off. */
export type GroundStride = 1 | 2 | 4

/**
 * The stride a tile `d` yards from the camera (tileDistance) is drawn at: every sample within half a
 * tile, every second within a tile and a half, every fourth beyond. A cell is 4.2 yards, so the far
 * tiles' 17-yard cells are a few pixels on screen there.
 */
export function groundStride(d: number): GroundStride {
	if (d < TILE_YARDS / 2) return 1
	if (d < TILE_YARDS * 1.5) return 2
	return 4
}

/**
 * How far the edge `edge` (its GROUND_SIDE heights in order) strays at any stride from at another, the
 * WDL horizon's every eighth sample among them: the skirt's depth less its margin.
 */
function edgeStray(edge: Float32Array): number {
	let most = 0
	const lerp = (k: number, s: number) => {
		const a = Math.floor(k / s) * s
		if (a === k) return edge[k]
		return edge[a] + ((edge[a + s] - edge[a]) * (k - a)) / s
	}
	for (let k = 0; k < GROUND_SIDE; k++) {
		const f = edge[k]
		const c2 = lerp(k, 2)
		const c4 = lerp(k, 4)
		const c8 = lerp(k, 8)
		most = Math.max(most, Math.abs(f - c2), Math.abs(f - c4), Math.abs(c2 - c4), Math.abs(f - c8), Math.abs(c2 - c8), Math.abs(c4 - c8))
	}
	return most
}

/**
 * The mesh of one tile at `stride`, in the tile's own frame (its north-west corner at the origin, the
 * mesh placed there): a vertex every `stride` height samples, its normal from the samples around it,
 * its uv across the tile (the minimap image's), and two triangles a cell of `stride` samples but for
 * the holes (a coarse cell is a hole only when all its cells are). Each edge hangs a skirt down past
 * how far its ground strays between the strides and the WDL horizon's every eighth sample, facing
 * out, so a neighbour drawn at another stride, or the horizon past the last tile, leaves no slit.
 */
export function groundMesh(g: TileGround, stride: GroundStride = 1): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; index: Uint16Array } {
	const S = GROUND_SIDE
	const h = g.heights
	const cells = GROUND_CELLS / stride
	const n = cells + 1
	// The four edges, each in the order its skirt runs (outward to the left of the run, see below):
	// north west to east, east north to south, south east to west, west south to north.
	const edges: Array<(k: number) => [number, number]> = [(k) => [k * stride, 0], (k) => [GROUND_CELLS, k * stride], (k) => [GROUND_CELLS - k * stride, GROUND_CELLS], (k) => [0, GROUND_CELLS - k * stride]]
	const depth = edges.map((at) => {
		const line = new Float32Array(S)
		for (let k = 0; k < S; k++) {
			const [x, y] = at(k / stride)
			line[k] = h[y * S + x]
		}
		return edgeStray(line) + SKIRT_MARGIN
	})
	// The grid, then a row of skirt vertices an edge.
	const total = n * n + 4 * n
	const positions = new Float32Array(total * 3)
	const normals = new Float32Array(total * 3)
	const uvs = new Float32Array(total * 2)
	const at = (x: number, y: number) => h[Math.min(S - 1, Math.max(0, y)) * S + Math.min(S - 1, Math.max(0, x))]
	/** Writes vertex `i` at sample (x, y), `drop` yards below the ground. */
	const vertex = (i: number, x: number, y: number, drop: number) => {
		positions[i * 3] = x * CELL_SIZE
		positions[i * 3 + 1] = h[y * S + x] - drop
		positions[i * 3 + 2] = y * CELL_SIZE
		// Central differences over the samples themselves, one-sided at the tile's edge.
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
	for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vertex(j * n + i, i * stride, j * stride, 0)
	/** Whether coarse cell (cx, cy) is a hole: all of its cells are. */
	const hole = (cx: number, cy: number) => {
		for (let y = cy * stride; y < (cy + 1) * stride; y++) for (let x = cx * stride; x < (cx + 1) * stride; x++) if (!g.holes[y * GROUND_CELLS + x]) return false
		return true
	}
	const holes = new Uint8Array(cells * cells)
	let solid = 0
	for (let y = 0; y < cells; y++) {
		for (let x = 0; x < cells; x++) {
			holes[y * cells + x] = hole(x, y) ? 1 : 0
			if (!holes[y * cells + x]) solid++
		}
	}
	// A skirt runs along every coarse cell of its edge but the holes'.
	const index = new Uint16Array(solid * 6 + 4 * cells * 6)
	let k = 0
	for (let y = 0; y < cells; y++) {
		for (let x = 0; x < cells; x++) {
			if (holes[y * cells + x]) continue
			const a = y * n + x
			const b = a + 1
			const c = a + n
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
	let base = n * n
	edges.forEach((edgeAt, e) => {
		for (let q = 0; q < n; q++) {
			const [x, y] = edgeAt(q)
			vertex(base + q, x, y, depth[e])
		}
		const top = (q: number) => {
			const [x, y] = edgeAt(q)
			return (y / stride) * n + x / stride
		}
		for (let q = 0; q < cells; q++) {
			// The coarse cell inside this stretch of the edge.
			const [x0, y0] = edgeAt(q)
			const [x1, y1] = edgeAt(q + 1)
			const cx = Math.min(cells - 1, Math.min(x0, x1) / stride)
			const cy = Math.min(cells - 1, Math.min(y0, y1) / stride)
			if (holes[cy * cells + cx]) continue
			// With the run going from a to b, (a, b, a') and (b, b', a') face out.
			const a = top(q)
			const b = top(q + 1)
			index[k++] = a
			index[k++] = b
			index[k++] = base + q
			index[k++] = b
			index[k++] = base + q + 1
			index[k++] = base + q
		}
		base += n
	})
	return { positions, normals, uvs, index: k === index.length ? index : index.slice(0, k) }
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

/**
 * How far along the ray from (ox, oy, oz) in the unit direction (dx, dy, dz) it first goes below
 * `height` (NaN where no ground is loaded, which the ray passes over), or -1 within `maxDist`: a march
 * in `step`-yard steps, then a bisection of the step it went under in. A coarse step can miss a thin
 * ridge, which suits the shadow fit (#741) it was written for, not picking.
 */
export function marchGround(height: (x: number, z: number) => number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, step: number): number {
	let prev = 0
	for (let t = 0; t <= maxDist; t += step) {
		const h = height(ox + dx * t, oz + dz * t)
		if (!(oy + dy * t <= h)) {
			prev = t
			continue
		}
		if (t === 0) return 0
		let lo = prev
		let hi = t
		for (let i = 0; i < 10; i++) {
			const mid = (lo + hi) * 0.5
			if (oy + dy * mid <= height(ox + dx * mid, oz + dz * mid)) hi = mid
			else lo = mid
		}
		return hi
	}
	return -1
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

/**
 * A model a tile places, as /wow/groundmodels sends it (wow.TileModel): in the map's editor
 * coordinates with `y` its absolute height, its turn in radians, and `uid` the file's unique ID (0 for
 * none), under which every tile its bounds overlap lists it.
 */
export interface TileModel {
	uid: number
	type: string
	x: number
	y: number
	z: number
	rotY: number
	tiltX: number
	tiltZ: number
	scale: number
}

/**
 * Which of the loaded tiles' models are placed (#15). A model whose bounds cross a tile border is
 * listed by each tile it overlaps under one ID, as `vmangos.ReadRegion` finds (#646): it is placed once,
 * by the first of those tiles to load, and taken away when the last of them is let go of. A model
 * without an ID belongs to its tile alone.
 */
export class TileModelShare {
	/** The placed object of each ID, and the loaded tiles (tileKey) that list it. */
	private byUid = new Map<number, { id: number; tiles: Set<number> }>()
	/** What each loaded tile lists: the IDs it shares, and the objects only it placed. */
	private byTile = new Map<number, { uids: number[]; ids: number[] }>()

	/** Notes tile `key`'s models, placing (`place`, which returns the object's id) those not placed yet. */
	add(key: number, models: readonly TileModel[], place: (m: TileModel) => number) {
		if (this.byTile.has(key)) return
		const own = { uids: [] as number[], ids: [] as number[] }
		this.byTile.set(key, own)
		for (const m of models) {
			if (!m.uid) {
				own.ids.push(place(m))
				continue
			}
			const shared = this.byUid.get(m.uid)
			if (shared) {
				// A tile may list one ID twice; it holds it once.
				if (!shared.tiles.has(key)) {
					shared.tiles.add(key)
					own.uids.push(m.uid)
				}
				continue
			}
			this.byUid.set(m.uid, { id: place(m), tiles: new Set([key]) })
			own.uids.push(m.uid)
		}
	}

	/** Lets go of tile `key`'s models, taking away (`remove`) those no other loaded tile lists. */
	drop(key: number, remove: (id: number) => void) {
		const own = this.byTile.get(key)
		if (!own) return
		this.byTile.delete(key)
		for (const id of own.ids) remove(id)
		for (const uid of own.uids) {
			const shared = this.byUid.get(uid)
			if (!shared) continue
			shared.tiles.delete(key)
			if (shared.tiles.size === 0) {
				this.byUid.delete(uid)
				remove(shared.id)
			}
		}
	}

	/** How many models are placed. */
	get count(): number {
		let n = this.byUid.size
		for (const own of this.byTile.values()) n += own.ids.length
		return n
	}
}
