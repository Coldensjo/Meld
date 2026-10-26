import type { MapSnapshot } from '../engine/Engine'
import { CHUNK_CELLS, NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../terrain/chunkPaint'
import { SHADOW_PER_CELL, packShadowBits, unpackShadowBits } from '../terrain/bakedShadows'
import { tileKey } from '../world/groundEffects'
import { LIQUID_CELLS, LIQUID_RECORD_BYTES, TILE_CELLS, TILE_YARDS } from '../wow/format'

// Growing a map made for the client to a bigger square of tiles (#46, the owner's 4A): Map Properties
// adds a tile outside the square, so the terrain is made again that much bigger with the old square
// inside it, `dx` and `dy` tiles in from the new one's north-west corner. Everything kept in the map's
// own coordinates moves with it; the new ground is flat at `fill` yards, unpainted but for the
// palette's first texture, with no holes, zones or shadows of its own.

/** Copies `rows` rows of `w` items each (`per` values an item) from `src` into `dst` at item (`ox`, `oz`) of its rows of `stride` items. */
function blit<T extends Uint8Array | Uint32Array | Float32Array>(src: T, dst: T, w: number, rows: number, per: number, ox: number, oz: number, stride: number) {
	for (let r = 0; r < rows; r++) dst.set(src.subarray(r * w * per, (r + 1) * w * per), ((oz + r) * stride + ox) * per)
}

/**
 * The snapshot `s` (a square of `s.size` cells, whole tiles) inside a square of `size` tiles, its old
 * square `dx`, `dy` tiles from the new one's corner. Every array is new; `s` is left as it was. The
 * VmangosRef is the caller's to set.
 */
export function growSnapshot(s: MapSnapshot, dx: number, dy: number, size: number, fill: number): MapSnapshot {
	const n0 = s.size / TILE_CELLS
	if (!Number.isInteger(n0) || dx < 0 || dy < 0 || dx + n0 > size || dy + n0 > size) throw new Error(`a square of ${n0} tiles doesn't fit ${size} tiles at ${dx},${dy}`)
	const cells = size * TILE_CELLS
	const ox = dx * TILE_CELLS
	const oz = dy * TILE_CELLS

	// The heights: one more vertex a side than cells.
	const V0 = s.size + 1
	const V = cells + 1
	const h0 = new Float32Array(s.heights.slice().buffer)
	const h = new Float32Array(V * V).fill(fill)
	blit(h0, h, V0, V0, 1, ox, oz, V)

	// The paint: every texel all of slot 0, every chunk's slot 0 the palette's first texture.
	const R0 = s.size * SPLAT_PER_CELL
	const R = cells * SPLAT_PER_CELL
	const weights = new Uint8Array(R * R * SLOTS)
	for (let i = 0; i < weights.length; i += SLOTS) weights[i] = 255
	blit(s.weights, weights, R0, R0, SLOTS, ox * SPLAT_PER_CELL, oz * SPLAT_PER_CELL, R)
	const C0 = s.size / CHUNK_CELLS
	const C = cells / CHUNK_CELLS
	const cx = ox / CHUNK_CELLS
	const cz = oz / CHUNK_CELLS
	const chunkSlots = new Uint8Array(C * C * SLOTS).fill(NO_TEXTURE)
	for (let c = 0; c < C * C; c++) chunkSlots[c * SLOTS] = 0
	blit(s.chunkSlots, chunkSlots, C0, C0, SLOTS, cx, cz, C)

	const perCell = (a: Uint8Array) => {
		if (a.length !== s.size * s.size) return new Uint8Array(0)
		const out = new Uint8Array(cells * cells)
		blit(a, out, s.size, s.size, 1, ox, oz, cells)
		return out
	}
	let chunkData: MapSnapshot['chunkData'] = null
	if (s.chunkData) {
		const areaIds = new Uint32Array(C * C)
		blit(s.chunkData.areaIds, areaIds, C0, C0, 1, cx, cz, C)
		const chunkFlags = new Uint8Array(C * C)
		blit(s.chunkData.chunkFlags, chunkFlags, C0, C0, 1, cx, cz, C)
		chunkData = { areaIds, chunkFlags, noEffect: perCell(s.chunkData.noEffect) }
	}
	let shadows: Uint8Array | null = null
	if (s.shadows) {
		const S0 = s.size * SHADOW_PER_CELL
		const S = cells * SHADOW_PER_CELL
		const out = new Uint8Array(S * S)
		blit(unpackShadowBits(s.shadows, S0), out, S0, S0, 1, ox * SHADOW_PER_CELL, oz * SHADOW_PER_CELL, S)
		shadows = packShadowBits(out)
	}
	// A liquid layer is placed by its chunk's index alone.
	let liquids: Uint8Array | null = null
	if (s.liquids) {
		liquids = s.liquids.slice()
		const L0 = s.size / LIQUID_CELLS
		const L = cells / LIQUID_CELLS
		const dv = new DataView(liquids.buffer, liquids.byteOffset, liquids.byteLength)
		const count = liquids.length >= 4 ? dv.getUint32(0, true) : 0
		for (let k = 0; k < count && 4 + (k + 1) * LIQUID_RECORD_BYTES <= liquids.length; k++) {
			const o = 4 + k * LIQUID_RECORD_BYTES
			const c = dv.getUint32(o, true)
			dv.setUint32(o, (Math.floor(c / L0) + oz / LIQUID_CELLS) * L + (c % L0) + ox / LIQUID_CELLS, true)
		}
	}

	const mx = dx * TILE_YARDS
	const mz = dy * TILE_YARDS
	const tiles: MapSnapshot['scopedEffects']['tiles'] = {}
	for (const [k, v] of Object.entries(s.scopedEffects.tiles)) {
		const [tx, tz] = k.split(',').map(Number)
		tiles[tileKey(tx + dx, tz + dy)] = { ...v }
	}
	return {
		...s,
		size: cells,
		splatRes: R,
		// An attached model is placed on its parent, so only the roots move.
		objects: s.objects.map((o) => (o.parent ? { ...o } : { ...o, x: o.x + mx, z: o.z + mz })),
		scopedEffects: { zones: structuredClone(s.scopedEffects.zones), tiles },
		reference: s.reference ? { ...s.reference, x: s.reference.x + mx, z: s.reference.z + mz } : null,
		paths: s.paths.map((p) => ({ ...p, points: p.points.map((q) => ({ ...q, x: q.x + mx, z: q.z + mz })) })),
		heights: new Uint8Array(h.buffer),
		weights,
		chunkSlots,
		holes: perCell(s.holes),
		liquids,
		chunkData,
		shadows,
		legacy: undefined,
	}
}
