// A path's last apply (#395): what it replaced, kept per map so applying the path again takes it back
// first, and saved in the map file's path applies blob (internal/mapfile, version 8) so that still
// holds after the map is reopened. pathApply.ts makes a record and the undo step that writes it; this
// module holds the record, each map's records and their bytes in the file.
import type { Command } from '../state/history'
import type { Terrain } from '../terrain/Terrain'
import type { MapPath } from '../terrain/paths'
import { CHUNK_CELLS, SLOTS } from '../terrain/chunkPaint'
import { LIQUID_RECORD_BYTES } from '../wow/format'
import { readLiquidRecord, writeLiquidRecord, type LiquidLayer } from '../water/liquids'

/** What one apply replaced. A part the apply left alone is null. */
export interface PathRecord {
	/** The vertices it moved (row-major) and their heights before. */
	heights: { index: Int32Array; before: Float32Array } | null
	/**
	 * The paint chunks it painted and their paint before: `slots` four a chunk, `weights` a chunk's
	 * texels (row-major, four weights each) after another, in the order of `chunks`.
	 */
	paint: { chunks: Int32Array; weights: Uint8Array; slots: Uint8Array } | null
	/** The liquid chunks it changed and the layers each held before (none for a chunk that had no liquid). */
	liquids: { chunks: Int32Array; layers: LiquidLayer[][] } | null
	/** The models a fence apply stood, by id, and their type: a model of another type that took one of the ids since is not one of them. */
	models: { ids: Int32Array; type: string } | null
}

/** A path's last apply in an open map: its record, its undo step, and whether it is in the map now (its step not undone). */
export interface PathApply {
	record: PathRecord
	cmd: Command
	live: boolean
}

/** A record as the map file keeps it: the path it belongs to. */
export interface SavedApply {
	pathId: number
	record: PathRecord
}

const applies = new WeakMap<Terrain, Map<number, PathApply>>()

/** The last applies of the map whose terrain is `t`, by path id. */
export function appliesOf(t: Terrain): Map<number, PathApply> {
	let m = applies.get(t)
	if (!m) applies.set(t, (m = new Map()))
	return m
}

/**
 * The records the map file keeps for terrain `t`'s map: those of the paths in `paths` whose last apply
 * is in the map. One undone, or of a path deleted since, is left out, since a reopened map has no
 * history to bring it back.
 */
export function savedApplies(t: Terrain, paths: readonly MapPath[]): SavedApply[] {
	const m = applies.get(t)
	if (!m) return []
	const ids = new Set(paths.map((p) => p.id))
	const out: SavedApply[] = []
	for (const [pathId, a] of m) if (a.live && ids.has(pathId)) out.push({ pathId, record: a.record })
	return out
}

/** The bytes a record holds, for the undo budget. */
export function recordBytes(r: PathRecord): number {
	let n = 0
	if (r.heights) n += r.heights.index.byteLength + r.heights.before.byteLength
	if (r.paint) n += r.paint.chunks.byteLength + r.paint.weights.byteLength + r.paint.slots.byteLength
	if (r.liquids) for (const ls of r.liquids.layers) for (const l of ls) n += l.heights.byteLength + l.depth.byteLength + l.cells.byteLength
	if (r.models) n += r.models.ids.byteLength
	return n
}

/** Texels a side of a paint chunk in a map of `size` cells with `splatRes` texels a side. */
export function paintChunkTexels(size: number, splatRes: number): number {
	return splatRes / (size / CHUNK_CELLS)
}

/** The path applies blob of the map file (internal/mapfile, version 8) holding `list`. */
export function encodePathApplies(list: readonly SavedApply[]): Uint8Array {
	if (!list.length) return new Uint8Array(0)
	const text = new TextEncoder()
	const types = list.map((a) => text.encode(a.record.models?.type ?? ''))
	let n = 4
	list.forEach(({ record: r }, k) => {
		n += 4 + 4 + (r.heights?.index.length ?? 0) * 8
		n += 4 + (r.paint ? r.paint.chunks.length * 4 + r.paint.slots.length + r.paint.weights.length : 0)
		n += 4 + (r.liquids?.chunks.length ?? 0) * 4 + 4 + (r.liquids?.layers.reduce((s, ls) => s + ls.length, 0) ?? 0) * LIQUID_RECORD_BYTES
		n += 4 + (r.models?.ids.length ?? 0) * 4 + 4 + types[k].length
	})
	const out = new Uint8Array(n)
	const dv = new DataView(out.buffer)
	let o = 0
	const u32 = (v: number) => {
		dv.setUint32(o, v, true)
		o += 4
	}
	const bytes = (b: Uint8Array) => {
		out.set(b, o)
		o += b.length
	}
	u32(list.length)
	list.forEach(({ pathId, record: r }, k) => {
		u32(pathId)
		const h = r.heights
		u32(h?.index.length ?? 0)
		if (h) {
			for (const i of h.index) u32(i)
			for (const v of h.before) {
				dv.setFloat32(o, v, true)
				o += 4
			}
		}
		const p = r.paint
		u32(p?.chunks.length ?? 0)
		if (p) {
			for (const c of p.chunks) u32(c)
			bytes(p.slots)
			bytes(p.weights)
		}
		const l = r.liquids
		u32(l?.chunks.length ?? 0)
		if (l) for (const c of l.chunks) u32(c)
		u32(l?.layers.reduce((s, ls) => s + ls.length, 0) ?? 0)
		l?.layers.forEach((ls, i) => {
			for (const layer of ls) {
				writeLiquidRecord(dv, o, l.chunks[i], layer)
				o += LIQUID_RECORD_BYTES
			}
		})
		u32(r.models?.ids.length ?? 0)
		if (r.models) for (const id of r.models.ids) u32(id)
		u32(types[k].length)
		bytes(types[k])
	})
	return out
}

/**
 * The records of a path applies blob, for a map of `size` cells with `splatRes` texels a side. A blob
 * that doesn't fit the map (Go's mapfile checks it, so only a bug gets here) gives none, with a warning.
 */
export function decodePathApplies(blob: Uint8Array, size: number, splatRes: number): SavedApply[] {
	if (blob.length < 4) return []
	const verts = (size + 1) * (size + 1)
	const chunks = (size / CHUNK_CELLS) ** 2
	const per = paintChunkTexels(size, splatRes)
	const chunkWeights = per * per * SLOTS
	const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
	let o = 0
	const need = (n: number) => {
		if (!(n >= 0) || o + n > blob.length) throw new Error(`runs past its end at byte ${o}`)
	}
	const u32 = () => {
		need(4)
		const v = dv.getUint32(o, true)
		o += 4
		return v
	}
	const indices = (n: number, limit: number, what: string) => {
		need(n * 4)
		const out = new Int32Array(n)
		for (let k = 0; k < n; k++) {
			const i = u32()
			if (i >= limit) throw new Error(`${what} ${i} of ${limit}`)
			out[k] = i
		}
		return out
	}
	const take = (n: number) => {
		need(n)
		o += n
		return blob.slice(o - n, o)
	}
	try {
		const out: SavedApply[] = []
		const count = u32()
		for (let r = 0; r < count; r++) {
			const pathId = u32()
			const record: PathRecord = { heights: null, paint: null, liquids: null, models: null }
			const nh = u32()
			const index = indices(nh, verts, 'vertex')
			need(nh * 4)
			const before = new Float32Array(nh)
			for (let k = 0; k < nh; k++) before[k] = dv.getFloat32(o + k * 4, true)
			o += nh * 4
			if (nh) record.heights = { index, before }
			const np = u32()
			if (np) {
				if (!Number.isInteger(per) || per <= 0) throw new Error(`paint chunks of ${per} texels`)
				const pc = indices(np, chunks, 'paint chunk')
				const slots = take(np * SLOTS)
				record.paint = { chunks: pc, slots, weights: take(np * chunkWeights) }
			}
			const lc = indices(u32(), chunks, 'liquid chunk')
			const nl = u32()
			need(nl * LIQUID_RECORD_BYTES)
			const layers: LiquidLayer[][] = Array.from(lc, () => [])
			for (let k = 0; k < nl; k++) {
				const { c, layer } = readLiquidRecord(dv, o)
				o += LIQUID_RECORD_BYTES
				const i = lc.indexOf(c)
				if (i < 0) throw new Error(`a liquid layer of chunk ${c}, which the apply did not change`)
				layers[i].push(layer)
			}
			if (lc.length) record.liquids = { chunks: lc, layers }
			const ids = indices(u32(), 2 ** 31, 'model id')
			const type = new TextDecoder().decode(take(u32()))
			if (ids.length) record.models = { ids, type }
			out.push({ pathId, record })
		}
		if (o !== blob.length) throw new Error(`${blob.length - o} bytes past the last record`)
		return out
	} catch (e) {
		console.warn(`The map's path applies were not read: ${(e as Error).message}`)
		return []
	}
}

/**
 * `list` for a map grown around its old square (io/worldGrow.ts): the old map of `size0` cells sits
 * `ox`, `oz` cells (whole chunks) in from the corner of the new one of `size` cells. The texels a paint
 * chunk has are the same in both.
 */
export function shiftApplies(list: readonly SavedApply[], size0: number, size: number, ox: number, oz: number): SavedApply[] {
	const V0 = size0 + 1
	const V = size + 1
	const C0 = size0 / CHUNK_CELLS
	const C = size / CHUNK_CELLS
	const cx = ox / CHUNK_CELLS
	const cz = oz / CHUNK_CELLS
	const vertex = (i: number) => (Math.floor(i / V0) + oz) * V + (i % V0) + ox
	const chunk = (c: number) => (Math.floor(c / C0) + cz) * C + (c % C0) + cx
	return list.map(({ pathId, record: r }) => ({
		pathId,
		record: {
			heights: r.heights ? { index: r.heights.index.map(vertex), before: r.heights.before } : null,
			paint: r.paint ? { ...r.paint, chunks: r.paint.chunks.map(chunk) } : null,
			liquids: r.liquids ? { chunks: r.liquids.chunks.map(chunk), layers: r.liquids.layers } : null,
			models: r.models,
		},
	}))
}
