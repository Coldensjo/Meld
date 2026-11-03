// The ground's chunk data in a shared session (#1018): every change to the
// session map's zones (`areaIds`), chunk flags (`chunkFlags`, the impassable flag) and no-effect cells
// (`noEffect`) (the Map data tool, a paste, the reference image's zones, a script, an undo) and to its
// biome map (`biomeMap`, the Biome Brush's cells, #1036) goes out as the changed chunks' and cells' values,
// and every member applies the others' in the host's order.
//
// The holes' sync (holes.ts) over four grids at once: the area IDs and the flags a paint chunk each, the
// no-effect and biome bytes a cell each. The changed rects come from the two `Terrain.touchChunkData` and
// `Terrain.touchBiomeMap` grow (`takeSessionChunkData`), compared against a mirror of each grid, so a touch that changed nothing sends
// nothing. One's own come back as the acknowledgement; another member's arriving while some of mine are
// unacknowledged is ordered before them, so mine are written back over it, grid by grid.
//
// A biome map cell holds 1 plus an index in the member's own list of the map's biomes, and two members who
// add a biome at once hold different lists for a while (#1048), so the cells go out naming their biomes:
// the part carries the biomes its bytes name (`t`), and the receiver turns them into its own indexes,
// adding a biome its list lacks. The settings' `biomes` (settings.ts `mergeBiomes`) keep a biome the cells
// still use.
// Kept free of the bindings so a Bun test can run two members against a scripted host.
import { base64ToBytes, bytesToBase64 } from '../io/base64'
import { copyBiome, type Biome } from '../terrain/biome'
import { MAX_MAP_BIOMES } from '../terrain/biomeMap'
import { prefShapeOk } from '../state/prefsPatch'
import type { VertexRect } from './heights'

/** The kind of a message carrying chunk data (data: `ChunkDataData`). */
export const KIND_CHUNK_DATA = 'chunkdata'

/** An inclusive rect of a grid: paint chunks for the zones and flags, cells for the no-effect bytes. */
export type GridRect = VertexRect

/** One grid's part of a message: an inclusive rect and its values (base64 of their bytes, row by row; an area ID is 4 bytes, little-endian). */
export interface GridPart {
	rect: GridRect
	b: string
	/** The biome map's part only: the biomes its bytes name, a byte `v` naming `t[v - 1]` (#1048). */
	t?: Biome[]
}

/**
 * A `chunkdata` message's data: the sender's own count `id`, and the parts of the grids that changed:
 * `a` the area IDs and `f` the chunk flags (rects of paint chunks), `n` the no-effect cells (a rect of cells).
 */
export interface ChunkDataData {
	id: number
	a?: GridPart
	f?: GridPart
	n?: GridPart
	/** The biome map's cells (a rect of cells, a byte each: 0 for none, else 1 plus the index in `t`, or in the map's biomes without `t`). */
	m?: GridPart
}

/** What the sync needs of a `Terrain`. */
export interface ChunkDataGround {
	readonly areaIds: Uint32Array
	readonly chunkFlags: Uint8Array
	readonly noEffect: Uint8Array
	readonly biomeMap: Uint8Array
	/** Cells a side. */
	readonly size: number
	readonly paintChunksPerSide: number
	touchChunkData(rect?: GridRect | null, cells?: boolean): void
	touchBiomeMap(rect: GridRect): void
	takeSessionChunkData(chunks: GridRect, cells: GridRect): boolean
}

/** The map's biomes, whose indexes the biome map's cells hold. */
export interface ChunkDataBiomes {
	/** The map's biomes now (`editor.mapBiomes` or its document's `meta.biomes`). */
	list(): readonly Biome[]
	/** Appends biomes another member's cells name that the map lacks. */
	add(biomes: Biome[]): void
}

export interface ChunkDataSyncHooks {
	/** The map's biomes, so the biome map's cells go out by biome rather than by this member's index (#1048). Without it the bytes go as they are. */
	biomes?: ChunkDataBiomes
	/** Sends one message to everyone; resolves once the host has it. */
	send(data: ChunkDataData): Promise<unknown>
	/** After another member's chunk data was written in. */
	applied?(): void
	/** A send failed: the others never got that chunk data. */
	failed?(err: unknown): void
}

type Key = 'a' | 'f' | 'n' | 'm'
const KEYS: readonly Key[] = ['a', 'f', 'n', 'm']
/** The grids of cells (the rest are of paint chunks). */
const isCells = (k: Key) => k === 'n' || k === 'm'

interface Part {
	rect: GridRect
	b: Uint8Array
}

interface Pending {
	id: number
	parts: Partial<Record<Key, Part>>
}

interface Held {
	seq: number
	data: unknown
}

/** One grid as bytes: `side` values a side, `stride` bytes a value, and the mirror of them. */
interface Grid {
	bytes: Uint8Array
	side: number
	stride: number
	mirror: Uint8Array
}

/** The bytes of a typed array, the same memory. */
function bytesOf(a: Uint32Array | Uint8Array): Uint8Array {
	return new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
}

/** One member's chunk data sync for the session's map. */
export class ChunkDataSync {
	private ground: ChunkDataGround | null = null
	private grids: Record<Key, Grid> | null = null
	/** My sent messages the host has not sent back yet, oldest first, with their bytes. */
	private pending: Pending[] = []
	/** Messages held while waiting for the map (a guest before its handoff opens). */
	private held: Held[] = []
	private holding = false
	/** Messages at or before this `seq` are already in the map bound (the handoff's). */
	private after = 0
	private nextId = 1
	private readonly chunks: GridRect = { x0: 0, z0: 0, x1: 0, z1: 0 }
	private readonly cells: GridRect = { x0: 0, z0: 0, x1: 0, z1: 0 }

	constructor(private readonly hooks: ChunkDataSyncHooks) {}

	get bound(): ChunkDataGround | null {
		return this.ground
	}

	/** The sent messages not yet acknowledged (for the tests). */
	get unacknowledged(): number {
		return this.pending.length
	}

	/** Holds the chunk data messages that arrive until `bind`, as a guest does until the host's map opens. */
	wait() {
		this.unbind()
		this.holding = true
	}

	/** Syncs `ground` from now on, as it stands: the map as it was after message `afterSeq`. Held messages after that are applied. */
	bind(ground: ChunkDataGround, afterSeq: number) {
		const held = this.held
		const grid = (a: Uint32Array | Uint8Array, side: number, stride: number): Grid => {
			const bytes = bytesOf(a)
			return { bytes, side, stride, mirror: bytes.slice() }
		}
		const side = ground.paintChunksPerSide
		this.ground = ground
		this.grids = { a: grid(ground.areaIds, side, 4), f: grid(ground.chunkFlags, side, 1), n: grid(ground.noEffect, ground.size, 1), m: grid(ground.biomeMap, ground.size, 1) }
		this.pending = []
		this.held = []
		this.holding = false
		this.after = afterSeq
		ground.takeSessionChunkData(this.chunks, this.cells)
		for (const m of held) if (m.seq > afterSeq) this.applyData(m.data)
	}

	/** Stops syncing (the session ended or its map was closed). */
	unbind() {
		this.ground = null
		this.grids = null
		this.pending = []
		this.held = []
		this.holding = false
		this.after = 0
	}

	/** Sends the chunk data changed since the last flush, if any. Runs on the heights' timer and before a remote message is applied. */
	flush() {
		const g = this.ground
		const grids = this.grids
		if (!g || !grids || !g.takeSessionChunkData(this.chunks, this.cells)) return
		const parts: Partial<Record<Key, Part>> = {}
		let any = false
		for (const k of KEYS) {
			const p = takeChanged(grids[k], isCells(k) ? this.cells : this.chunks)
			if (!p) continue
			parts[k] = p
			any = true
		}
		if (!any) return
		const id = this.nextId++
		this.pending.push({ id, parts })
		const data: ChunkDataData = { id }
		for (const k of KEYS) {
			const p = parts[k]
			if (!p) continue
			if (k === 'm' && this.hooks.biomes) {
				const { bytes, table } = toWire(p.b, this.hooks.biomes.list())
				data.m = { rect: p.rect, b: bytesToBase64(bytes), t: table }
			} else data[k] = { rect: p.rect, b: bytesToBase64(p.b) }
		}
		this.hooks.send(data).catch((err) => {
			this.pending = this.pending.filter((p) => p.id !== id)
			this.hooks.failed?.(err)
		})
	}

	/** A `chunkdata` message from the session, `you` this member's id. */
	receive(seq: number, from: number, data: unknown, you: number) {
		if (from === you) {
			const id = (data as ChunkDataData | null)?.id
			const i = this.pending.findIndex((p) => p.id === id)
			if (i >= 0) this.pending.splice(i, 1)
			return
		}
		if (!this.ground) {
			if (this.holding) this.held.push({ seq, data })
			return
		}
		if (seq <= this.after) return
		this.applyData(data)
	}

	/** Writes another member's chunk data in, then mine still unacknowledged over it. False for a message that doesn't fit the map. */
	private applyData(data: unknown): boolean {
		const g = this.ground
		const grids = this.grids
		const d = data as Record<string, unknown> | null
		if (!g || !grids || !d || typeof d !== 'object') return false
		const parts: Partial<Record<Key, Part>> = {}
		let any = false
		for (const k of KEYS) {
			if (d[k] === undefined) continue
			const p = readPart(d[k], grids[k])
			if (!p) return false
			if (k === 'm' && !this.fromWire(p.b, (d[k] as GridPart).t)) return false
			parts[k] = p
			any = true
		}
		if (!any) return false
		// My edits not sent yet are pending from here on, so they are written back over this one too.
		this.flush()
		for (const k of KEYS) {
			const p = parts[k]
			if (!p) continue
			const grid = grids[k]
			writeRect(grid.bytes, grid.side, grid.stride, p.rect, p.b, p.rect)
			for (const mine of this.pending) {
				const q = mine.parts[k]
				if (q) writeRect(grid.bytes, grid.side, grid.stride, q.rect, q.b, p.rect)
			}
			copyRect(grid.bytes, grid.mirror, grid.side, grid.stride, p.rect)
		}
		const chunks = union(parts.a?.rect, parts.f?.rect)
		if (chunks) g.touchChunkData(chunks)
		if (parts.n) g.touchChunkData(parts.n.rect, true)
		if (parts.m) g.touchBiomeMap(parts.m.rect)
		// Not an edit of mine: the flush above took every earlier touch, so these are the apply's alone.
		g.takeSessionChunkData(this.chunks, this.cells)
		this.hooks.applied?.()
		return true
	}

	/** Turns a received biome map part's bytes, naming the biomes of `table`, into this member's indexes in place, adding the biomes the map lacks. False for a table that isn't biomes. */
	private fromWire(b: Uint8Array, table: unknown): boolean {
		const hooks = this.hooks.biomes
		// A message without a table (or a member without the map's biomes) takes the bytes as they are.
		if (!hooks || table === undefined) return true
		if (!Array.isArray(table) || !prefShapeOk('biomes', table)) return false
		const t = table as Biome[]
		let list = hooks.list()
		const missing: Biome[] = []
		for (const e of t) if (!list.some((x) => x.name === e.name) && !missing.some((x) => x.name === e.name)) missing.push(copyBiome(e))
		const room = MAX_MAP_BIOMES - list.length
		if (missing.length && room > 0) {
			hooks.add(missing.slice(0, room))
			list = hooks.list()
		}
		const ids = t.map((e) => {
			const i = list.findIndex((x) => x.name === e.name)
			return i >= 0 && i < MAX_MAP_BIOMES ? i + 1 : 0
		})
		for (let i = 0; i < b.length; i++) b[i] = b[i] ? (ids[b[i] - 1] ?? 0) : 0
		return true
	}

	/**
	 * Rewrites the biome map's cells through `ids` (an old cell value to its new one, 256 long), with the
	 * mirror and my unacknowledged parts, so a change of the map's list of biomes (settings.ts
	 * `mergeBiomes`) keeps every cell naming its biome without sending them again.
	 */
	remapBiomes(ids: Uint8Array) {
		const m = this.grids?.m
		if (!m) return
		remapCells(m.bytes, ids)
		remapCells(m.mirror, ids)
		for (const p of this.pending) if (p.parts.m) remapCells(p.parts.m.b, ids)
	}
}

/** Rewrites biome map bytes through `ids` (an old cell value to its new one, 256 long), in place. */
export function remapCells(b: Uint8Array, ids: Uint8Array) {
	for (let i = 0; i < b.length; i++) b[i] = ids[b[i]]
}

/** A biome map part's bytes as they go out: renumbered by first use, with the biomes they name. A cell naming no biome of `list` goes as none. */
function toWire(b: Uint8Array, list: readonly Biome[]): { bytes: Uint8Array; table: Biome[] } {
	const ids = new Uint8Array(256)
	const table: Biome[] = []
	const bytes = new Uint8Array(b.length)
	for (let i = 0; i < b.length; i++) {
		const v = b[i]
		if (!v) continue
		if (!ids[v]) {
			const biome = list[v - 1]
			if (!biome) continue
			// A copy, since the send's JSON is made later in the queue and the biome can change in place before then.
			table.push(copyBiome(biome))
			ids[v] = table.length
		}
		bytes[i] = ids[v]
	}
	return { bytes, table }
}

/** The part of `grid` within `r` (clipped to it) that differs from its mirror, copied into the mirror; null when none does. */
function takeChanged(grid: Grid, r: GridRect): Part | null {
	const { bytes, mirror, side, stride } = grid
	const x0 = Math.max(0, r.x0)
	const z0 = Math.max(0, r.z0)
	const x1 = Math.min(side - 1, r.x1)
	const z1 = Math.min(side - 1, r.z1)
	let ax = Infinity
	let az = Infinity
	let bx = -Infinity
	let bz = -Infinity
	for (let z = z0; z <= z1; z++) {
		for (let x = x0; x <= x1; x++) {
			const at = (z * side + x) * stride
			let same = true
			for (let k = 0; k < stride; k++) if (bytes[at + k] !== mirror[at + k]) same = false
			if (same) continue
			if (x < ax) ax = x
			if (x > bx) bx = x
			if (z < az) az = z
			bz = z
		}
	}
	if (ax > bx) return null
	const rect = { x0: ax, z0: az, x1: bx, z1: bz }
	const w = (bx - ax + 1) * stride
	const out = new Uint8Array(w * (bz - az + 1))
	for (let z = az; z <= bz; z++) {
		const from = (z * side + ax) * stride
		out.set(bytes.subarray(from, from + w), (z - az) * w)
	}
	copyRect(bytes, mirror, side, stride, rect)
	return { rect, b: out }
}

/** A message's part for `grid`, checked against it; null when it doesn't fit. */
function readPart(v: unknown, grid: Grid): Part | null {
	const p = v as GridPart | null
	const r = p?.rect
	if (!p || !r || typeof p.b !== 'string') return null
	const { x0, z0, x1, z1 } = r
	const S = grid.side
	if (![x0, z0, x1, z1].every((n) => Number.isInteger(n)) || x0 < 0 || z0 < 0 || x1 >= S || z1 >= S || x0 > x1 || z0 > z1) return null
	let b: Uint8Array
	try {
		b = base64ToBytes(p.b)
	} catch {
		return null
	}
	if (b.length !== (x1 - x0 + 1) * (z1 - z0 + 1) * grid.stride) return null
	return { rect: { x0, z0, x1, z1 }, b }
}

/** Writes the part of `src` (the values of rect `sr`) that falls inside `clip` into the grid `a`, `side` values a row of `stride` bytes. */
function writeRect(a: Uint8Array, side: number, stride: number, sr: GridRect, src: Uint8Array, clip: GridRect) {
	const x0 = Math.max(sr.x0, clip.x0)
	const x1 = Math.min(sr.x1, clip.x1)
	const z0 = Math.max(sr.z0, clip.z0)
	const z1 = Math.min(sr.z1, clip.z1)
	if (x0 > x1 || z0 > z1) return
	const w = sr.x1 - sr.x0 + 1
	for (let z = z0; z <= z1; z++) {
		const from = ((z - sr.z0) * w + (x0 - sr.x0)) * stride
		a.set(src.subarray(from, from + (x1 - x0 + 1) * stride), (z * side + x0) * stride)
	}
}

/** Copies rect `r` of grid `src` into `dst`, both `side` values a row of `stride` bytes. */
function copyRect(src: Uint8Array, dst: Uint8Array, side: number, stride: number, r: GridRect) {
	for (let z = r.z0; z <= r.z1; z++) dst.set(src.subarray((z * side + r.x0) * stride, (z * side + r.x1 + 1) * stride), (z * side + r.x0) * stride)
}

/** The rect around both (either may be absent); null for neither. */
function union(a?: GridRect, b?: GridRect): GridRect | null {
	if (!a) return b ? { ...b } : null
	if (!b) return { ...a }
	return { x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) }
}
