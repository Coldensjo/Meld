// The biome map (#958): which biome each terrain cell was painted with by the Biome Brush, and the paint
// it makes. A byte per cell (`Terrain.biomeMap`), 0 for none, else 1 plus the index of the biome in the
// map's own copies (`editor.mapBiomes`); both are saved in the `.wmap` (format 9). The paint is worked
// out per splat texel from the map: a texel deep inside one biome's cells takes that biome's paint, and
// within half the border width of another biome's cells the two cross-fade, half and half on the cells'
// edge, so the borders are smooth curves over the border width rather than steps of cells. A cell of
// no biome keeps the paint it had, so a biome fades into the ground around it the same way.
//
// Each repainted chunk then keeps four textures at most (three where one biome covers it whole, as
// auto-paint keeps): every biome's base first, then the heaviest of the rest. A dropped texture of a
// biome gives its weight to the nearest of that biome's textures still kept (its role's fallback: snow
// to rock, rock and sand to dirt, dirt and lush to the base), an old one to the kept ones in proportion,
// and the chunk is counted as one where a texture had to go.
//
// Kept free of three.js and the runes state, so tests/biomeMap.test.ts drives it on its own.

import { AUTO_PAINT_MIN_SHARE, AUTO_PAINT_ROLES } from './autoPaint'
import { BIOME_ROLES, ROLE_FALLBACK } from './biome'
import { NO_TEXTURE, SLOTS, chunkTexelRect, normalizeTexel } from './chunkPaint'

/** A cell no biome was painted on. */
export const NO_BIOME = 0
/** The most biomes a map holds: the cells name them by a byte, 0 being none. */
export const MAX_MAP_BIOMES = 255
/** The most biomes one texel blends: its own and the nearest others. */
const MAX_MIX = 8
/** The most biomes one chunk's repaint keeps apart; a further one's share keeps the old paint. */
const MAX_CHUNK_BIOMES = 6
const ROLES = BIOME_ROLES.length

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/**
 * The blend of the biomes at a splat texel: `at` writes the biomes that reach it into `ids` and their
 * shares (summing to 1) into `ws`, and says in `changed` whether a cell within its reach differs from
 * the map it is compared with (a stroke's start). One per stroke; it allocates nothing per texel.
 */
export class BiomeBlend {
	readonly ids = new Uint8Array(MAX_MIX)
	readonly ws = new Float32Array(MAX_MIX)
	/** Whether the last `at` found a cell within reach that differs from `before`. */
	changed = false
	/** The border width in cells, half of it, and the cells a texel looks out over each way. */
	readonly width: number
	private readonly half: number
	readonly reach: number
	private readonly perCell: number

	/** `size` cells a side, `res` splat texels a side, the border `border` cells wide. */
	constructor(
		readonly size: number,
		res: number,
		border: number,
	) {
		this.width = Math.max(0, border)
		this.half = this.width / 2
		this.reach = Math.ceil(this.half)
		this.perCell = res / size
	}

	/** The biomes at texel (tx, tz) of `map`, compared with `before` (same length); returns how many. */
	at(map: Uint8Array, before: Uint8Array, tx: number, tz: number): number {
		const S = this.size
		const px = (tx + 0.5) / this.perCell
		const pz = (tz + 0.5) / this.perCell
		const cx = Math.min(S - 1, Math.floor(px))
		const cz = Math.min(S - 1, Math.floor(pz))
		const oi = cz * S + cx
		const own = map[oi]
		let changed = own !== before[oi]
		let n = 0
		const ids = this.ids
		const ws = this.ws
		const rc = this.reach
		const h2 = this.half * this.half
		if (rc > 0) {
			const z0 = Math.max(0, cz - rc)
			const z1 = Math.min(S - 1, cz + rc)
			const x0 = Math.max(0, cx - rc)
			const x1 = Math.min(S - 1, cx + rc)
			for (let z = z0; z <= z1; z++) {
				const dz = z > pz ? z - pz : pz > z + 1 ? pz - z - 1 : 0
				for (let x = x0; x <= x1; x++) {
					const i = z * S + x
					const id = map[i]
					const differs = id !== before[i]
					if (id === own && !differs) continue
					const dx = x > px ? x - px : px > x + 1 ? px - x - 1 : 0
					const d2 = dx * dx + dz * dz
					if (d2 >= h2) continue
					if (differs) changed = true
					if (id === own) continue
					const d = Math.sqrt(d2)
					let e = 1
					while (e <= n && ids[e] !== id) e++
					if (e <= n) {
						if (d < ws[e]) ws[e] = d
					} else if (n + 1 < MAX_MIX) {
						n++
						ids[n] = id
						ws[n] = d
					}
				}
			}
		}
		this.changed = changed
		ids[0] = own
		if (n === 0) {
			ws[0] = 1
			return 1
		}
		// Each other biome's share falls from a half on its cells' edge to none half the border in; the
		// own biome's rises the same way from its nearest other's edge.
		const W = this.width
		let near = Infinity
		for (let e = 1; e <= n; e++) near = Math.min(near, ws[e])
		ws[0] = smooth(0.5 + near / W)
		let total = ws[0]
		for (let e = 1; e <= n; e++) {
			ws[e] = smooth(0.5 - ws[e] / W)
			total += ws[e]
		}
		for (let e = 0; e <= n; e++) ws[e] /= total
		return n + 1
	}

	/** The share of biome `id` at texel (tx, tz) of `map`, 0 to 1. */
	share(map: Uint8Array, tx: number, tz: number, id: number): number {
		const n = this.at(map, map, tx, tz)
		for (let e = 0; e < n; e++) if (this.ids[e] === id) return this.ws[e]
		return 0
	}
}

/** What a biome paints with: a palette index per role (BIOME_ROLES' order, -1 for none), and its rules' weights per texel. */
export interface BiomeLayer {
	roleTex: number[]
	/** The role weights (0 to 255, summing to 255) of texel (i, j), into `out`. */
	fill: (i: number, j: number, out: Float32Array) => void
}

/** The ground a biome map paints: the terrain's paint and its biome map. */
export interface BiomeMapGround {
	size: number
	splatRes: number
	paintChunksPerSide: number
	weights: Uint8Array
	chunkSlots: Uint8Array
	biomeMap: Uint8Array
}

/** What a chunk's repaint did: nothing (no texel within reach of a changed cell: the chunk keeps its old paint), painted it, or painted it and a texture with a share of the chunk had to go for the four-texture limit. */
export const Repaint = { Same: 0, Painted: 1, Replaced: 2 } as const
export type Repaint = (typeof Repaint)[keyof typeof Repaint]

/**
 * Repaints chunks from the biome map. `layer(id)` gives biome `id`'s paint (1-based, as the cells hold
 * it), or null for one the map no longer has, whose cells keep the old paint. One per stroke: its
 * scratch is sized for one chunk and reused.
 */
export class BiomeRepainter {
	private readonly per: number
	private readonly cand: Int32Array
	private readonly totals: Float64Array
	private readonly oldCand: Uint8Array
	private readonly w0: Float32Array
	private readonly roleW: Float32Array
	private readonly local = new Int32Array(256)
	private readonly localIds = new Int32Array(MAX_CHUNK_BIOMES)
	private readonly localTotal = new Float64Array(MAX_CHUNK_BIOMES)
	private readonly roleCand = new Int32Array(MAX_CHUNK_BIOMES * ROLES)
	private readonly rolePos = new Int32Array(MAX_CHUNK_BIOMES * ROLES)
	private readonly candPos: Int32Array
	private readonly roleOut = new Float32Array(ROLES)
	private readonly acc = new Float32Array(SLOTS)
	private readonly kept: number[] = []
	private readonly order: number[] = []

	constructor(
		private readonly g: BiomeMapGround,
		private readonly blend: BiomeBlend,
		private readonly layer: (id: number) => BiomeLayer | null,
	) {
		this.per = g.splatRes / g.paintChunksPerSide
		const texels = this.per * this.per
		const maxCand = SLOTS + MAX_CHUNK_BIOMES * ROLES
		this.cand = new Int32Array(maxCand)
		this.totals = new Float64Array(maxCand)
		this.oldCand = new Uint8Array(maxCand)
		this.candPos = new Int32Array(maxCand)
		this.w0 = new Float32Array(texels)
		this.roleW = new Float32Array(texels * MAX_CHUNK_BIOMES * ROLES)
	}

	/**
	 * Repaints chunk `c` from the biome map, compared with `before` (the map the old paint was made
	 * under): a texel no changed cell reaches keeps the old paint, any other blends the biomes there over
	 * the old paint's share. `baseWeights` (the chunk's texels, row-major, SLOTS each) and `baseSlots`
	 * (its SLOTS palette indices) are that old paint. Writes the chunk's weights and slots.
	 */
	chunk(c: number, before: Uint8Array, baseWeights: Uint8Array, baseSlots: Uint8Array): Repaint {
		const g = this.g
		const R = g.splatRes
		const per = this.per
		const { x0, z0 } = chunkTexelRect(g.paintChunksPerSide, R, c)
		const blend = this.blend
		const roleW = this.roleW
		const w0 = this.w0
		const stride = MAX_CHUNK_BIOMES * ROLES
		let biomes = 0
		let changedTexels = 0
		let oldShare = 0
		for (let lz = 0; lz < per; lz++) {
			for (let lx = 0; lx < per; lx++) {
				const t = lz * per + lx
				roleW.fill(0, t * stride, (t + 1) * stride)
				const n = blend.at(g.biomeMap, before, x0 + lx, z0 + lz)
				if (!blend.changed) {
					w0[t] = 1
					oldShare += 1
					continue
				}
				changedTexels++
				let keep = 0
				for (let e = 0; e < n; e++) {
					const id = blend.ids[e]
					const w = blend.ws[e]
					const l = id === NO_BIOME ? -1 : this.localOf(id, biomes)
					if (l < 0) {
						keep += w
						continue
					}
					if (l === biomes) biomes++
					this.layer(id)!.fill(x0 + lx, z0 + lz, this.roleOut)
					const o = t * stride + l * ROLES
					for (let r = 0; r < ROLES; r++) roleW[o + r] = (this.roleOut[r] / 255) * w
				}
				w0[t] = keep
				oldShare += keep
			}
		}
		if (!changedTexels) return Repaint.Same
		// The candidates: the chunk's old textures, then each biome's.
		const cand = this.cand
		const oldCand = this.oldCand
		let nc = 0
		for (let k = 0; k < SLOTS; k++) {
			cand[nc] = baseSlots[k]
			oldCand[nc] = 1
			nc++
		}
		for (let l = 0; l < biomes; l++) {
			const tex = this.layer(this.localIds[l])!.roleTex
			for (let r = 0; r < ROLES; r++) {
				const p = tex[r] ?? -1
				if (p < 0) {
					this.roleCand[l * ROLES + r] = -1
					continue
				}
				let at = SLOTS
				while (at < nc && cand[at] !== p) at++
				// A biome texture the old paint has too adds to that slot's candidate.
				for (let k = 0; k < SLOTS; k++) if (cand[k] === p) at = k
				if (at === nc) {
					cand[nc] = p
					oldCand[nc] = 0
					nc++
				}
				this.roleCand[l * ROLES + r] = at
			}
		}
		const totals = this.totals
		totals.fill(0, 0, nc)
		this.localTotal.fill(0)
		const texels = per * per
		for (let t = 0; t < texels; t++) {
			const keep = w0[t]
			if (keep > 0) {
				const b = t * SLOTS
				for (let k = 0; k < SLOTS; k++) if (baseSlots[k] !== NO_TEXTURE) totals[k] += (baseWeights[b + k] / 255) * keep
			}
			const o = t * stride
			for (let l = 0; l < biomes; l++) {
				for (let r = 0; r < ROLES; r++) {
					const v = roleW[o + l * ROLES + r]
					if (!v) continue
					this.localTotal[l] += v
					const at = this.roleCand[l * ROLES + r]
					if (at >= 0) totals[at] += v
				}
			}
		}
		// What the chunk keeps: each biome's base, the heaviest biome first, then the heaviest of the rest.
		const whole = biomes === 1 && changedTexels === texels && oldShare === 0
		const cap = whole ? AUTO_PAINT_ROLES : SLOTS
		const kept = this.kept
		kept.length = 0
		const order = this.order
		order.length = 0
		for (let l = 0; l < biomes; l++) order.push(l)
		order.sort((a, b) => this.localTotal[b] - this.localTotal[a])
		for (const l of order) {
			const at = this.roleCand[l * ROLES]
			if (at >= 0 && kept.length < cap && totals[at] > 0 && !kept.includes(at)) kept.push(at)
		}
		let biomeAll = 0
		for (let l = 0; l < biomes; l++) biomeAll += this.localTotal[l]
		order.length = 0
		for (let i = 0; i < nc; i++) {
			if (cand[i] === NO_TEXTURE || totals[i] <= 0 || kept.includes(i)) continue
			// A biome's own speckle under auto-paint's smallest share is left out, as auto-paint leaves it.
			if (!oldCand[i] && totals[i] < biomeAll * AUTO_PAINT_MIN_SHARE) continue
			order.push(i)
		}
		order.sort((a, b) => totals[b] - totals[a])
		for (const i of order) {
			if (kept.length >= cap) break
			kept.push(i)
		}
		// A chunk one biome covers whole keeps three by choice, as auto-paint does: only a chunk that
		// needed more than four counts.
		let replaced = false
		for (let i = 0; i < nc && !replaced && !whole; i++) {
			if (cand[i] === NO_TEXTURE || kept.includes(i)) continue
			if (totals[i] >= texels * AUTO_PAINT_MIN_SHARE) replaced = true
		}
		// Where each candidate and each biome role lands: its kept place, or a dropped role's fallback's.
		const candPos = this.candPos
		candPos.fill(-1, 0, nc)
		for (let k = 0; k < kept.length; k++) candPos[kept[k]] = k
		for (let l = 0; l < biomes; l++) {
			for (let r = 0; r < ROLES; r++) {
				let role = r
				let pos = -1
				for (;;) {
					const at = this.roleCand[l * ROLES + role]
					if (at >= 0 && candPos[at] >= 0) {
						pos = candPos[at]
						break
					}
					if (role === 0) break
					role = ROLE_FALLBACK[role]
				}
				this.rolePos[l * ROLES + r] = pos
			}
		}
		const acc = this.acc
		for (let lz = 0; lz < per; lz++) {
			for (let lx = 0; lx < per; lx++) {
				const t = lz * per + lx
				acc.fill(0)
				const keep = w0[t]
				if (keep > 0) {
					const b = t * SLOTS
					for (let k = 0; k < SLOTS; k++) {
						const p = candPos[k]
						if (p >= 0) acc[p] += (baseWeights[b + k] / 255) * keep
					}
				}
				const o = t * stride
				for (let l = 0; l < biomes; l++) {
					for (let r = 0; r < ROLES; r++) {
						const v = roleW[o + l * ROLES + r]
						const p = this.rolePos[l * ROLES + r]
						if (v && p >= 0) acc[p] += v
					}
				}
				let sum = 0
				for (let k = 0; k < SLOTS; k++) sum += acc[k]
				const base = ((z0 + lz) * R + x0 + lx) * SLOTS
				for (let k = 0; k < SLOTS; k++) g.weights[base + k] = sum > 0 ? Math.round((acc[k] * 255) / sum) : 0
				normalizeTexel(g.weights, base)
			}
		}
		for (let k = 0; k < SLOTS; k++) g.chunkSlots[c * SLOTS + k] = k < kept.length ? cand[kept[k]] : NO_TEXTURE
		if (!kept.length) g.chunkSlots[c * SLOTS] = baseSlots[0] === NO_TEXTURE ? 0 : baseSlots[0]
		return replaced ? Repaint.Replaced : Repaint.Painted
	}

	/** The chunk-local index of biome `id`: its own, or the next free one (`count` so far); -1 when the chunk has no room or the map no such biome. */
	private localOf(id: number, count: number): number {
		const l = this.local[id]
		if (l >= 0 && l < count && this.localIds[l] === id) return l
		if (count >= MAX_CHUNK_BIOMES || !this.layer(id)) return -1
		this.local[id] = count
		this.localIds[count] = id
		return count
	}
}

/** The chunks (row-major indices) a change of the cells in `rect` (inclusive cells) can repaint: within the blend's reach and a cell. */
export function chunksReached(size: number, side: number, rect: { x0: number; z0: number; x1: number; z1: number }, reach: number, out: number[]): number[] {
	out.length = 0
	const per = size / side
	const m = reach + 1
	const cx0 = Math.max(0, Math.floor((rect.x0 - m) / per))
	const cz0 = Math.max(0, Math.floor((rect.z0 - m) / per))
	const cx1 = Math.min(side - 1, Math.floor((rect.x1 + m) / per))
	const cz1 = Math.min(side - 1, Math.floor((rect.z1 + m) / per))
	for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) out.push(cz * side + cx)
	return out
}

/** The biome map's cell values as written, with any that name a biome the map lacks (`count` of them) cleared. */
export function checkBiomeMap(map: Uint8Array, count: number): Uint8Array {
	for (let i = 0; i < map.length; i++) if (map[i] > count) map[i] = NO_BIOME
	return map
}

/** Copies chunk `c`'s paint out of `g`: its texels' weights (row-major, SLOTS each) into `w`, its slots into `s`. */
export function readChunkPaint(g: BiomeMapGround, c: number, w: Uint8Array, s: Uint8Array) {
	const R = g.splatRes
	const { x0, z0, per } = chunkTexelRect(g.paintChunksPerSide, R, c)
	for (let z = 0; z < per; z++) w.set(g.weights.subarray(((z0 + z) * R + x0) * SLOTS, ((z0 + z) * R + x0 + per) * SLOTS), z * per * SLOTS)
	s.set(g.chunkSlots.subarray(c * SLOTS, c * SLOTS + SLOTS))
}

/** Writes chunk `c`'s paint back into `g`, as `readChunkPaint` read it. */
export function writeChunkPaint(g: BiomeMapGround, c: number, w: Uint8Array, s: Uint8Array) {
	const R = g.splatRes
	const { x0, z0, per } = chunkTexelRect(g.paintChunksPerSide, R, c)
	for (let z = 0; z < per; z++) g.weights.set(w.subarray(z * per * SLOTS, (z + 1) * per * SLOTS), ((z0 + z) * R + x0) * SLOTS)
	g.chunkSlots.set(s, c * SLOTS)
}

/** The bounds (inclusive cells) of the cells of `map` (`size` a side) with a biome, or null when none has. */
export function biomeBounds(map: Uint8Array, size: number): { x0: number; z0: number; x1: number; z1: number } | null {
	let x0 = size,
		z0 = size,
		x1 = -1,
		z1 = -1
	for (let z = 0; z < size; z++) {
		for (let x = 0; x < size; x++) {
			if (map[z * size + x] === NO_BIOME) continue
			if (x < x0) x0 = x
			if (x > x1) x1 = x
			if (z < z0) z0 = z
			z1 = z
		}
	}
	return x1 < 0 ? null : { x0, z0, x1, z1 }
}
