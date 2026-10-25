import { CHUNK_CELLS, NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../terrain/chunkPaint'

// Ground effects, as the game grows them: each texture carries a GroundEffectTexture ID whose row
// names up to four detail models (grass tufts, flowers, pebbles) and a density, and a cell grows
// the effect of the texture that weighs most on it. The tables come from the client (Go,
// internal/vmangos/groundeffects.go); a map may give a texture an effect of its own. This module is
// the arithmetic; GroundEffectLayer draws it.

export interface GroundEffect {
	doodads: string[]
	/** The row's four doodad slots, each an index into `doodads` or -1 (empty, or naming no model). */
	slots: number[]
	density: number
	terrain: number
}

/** A TerrainType.dbc row: the footstep sounds a ground effect gives its ground. */
export interface TerrainType {
	id: number
	name: string
	/** Walking there leaves footprints (snow, sand). */
	footprints: boolean
}

export interface GroundEffectTables {
	/** By GroundEffectTexture ID. */
	effects: Record<string, GroundEffect>
	/** The TerrainType rows, by ID. */
	terrains?: TerrainType[]
	/** The effect each tileset texture (lower-case path) carries in the client's tiles. */
	textures: Record<string, number>
}

/** A map's own choice of effect per texture path (0 for none), over what the client's tiles say. */
export type TextureEffects = Record<string, number>

/**
 * A map's effects for narrower scopes than the whole map (B-151): per zone (an AreaTable ID, the one a
 * chunk carries) and per tile (the map's own tile, "x,y" counted from its north-west corner), each a
 * choice per texture path. A tile's choice comes before its zone's, and a zone's before the map's.
 */
export interface ScopedEffects {
	zones: Record<string, TextureEffects>
	tiles: Record<string, TextureEffects>
}

export const noScopedEffects = (): ScopedEffects => ({ zones: {}, tiles: {} })

/** Whether any zone or tile has a choice of its own. */
export function hasScopedEffects(s: ScopedEffects): boolean {
	for (const k in s.zones) if (Object.keys(s.zones[k]).length) return true
	for (const k in s.tiles) if (Object.keys(s.tiles[k]).length) return true
	return false
}

/** The key a tile's choices are kept under: the map's own tile, x and z counted from its corner. */
export const tileKey = (tx: number, tz: number) => `${tx},${tz}`

/**
 * The effect ID texture `path` grows in a chunk of zone `areaId` on tile (`tx`, `tz`): the tile's own
 * choice, else the zone's, else the map's, else the client's.
 */
export function effectAt(path: string, own: TextureEffects, scoped: ScopedEffects, areaId: number, tx: number, tz: number, tables: GroundEffectTables | null): number {
	if (path.startsWith('#')) return 0
	const tile = scoped.tiles[tileKey(tx, tz)]?.[path]
	if (tile !== undefined) return tile
	const zone = areaId ? scoped.zones[String(areaId)]?.[path] : undefined
	if (zone !== undefined) return zone
	return effectFor(path, own, tables)
}

/** The effect ID texture `path` grows: the map's own choice first, else what the client's tiles give it; 0 for none. */
export function effectFor(path: string, own: TextureEffects, tables: GroundEffectTables | null): number {
	if (path.startsWith('#')) return 0
	const mine = own[path]
	if (mine !== undefined) return mine
	return tables?.textures[path.toLowerCase()] ?? 0
}

/**
 * The slot (0..3) that weighs most over cell (cx, cz) of a map with `splatRes` texels a side, read
 * from the four weights per texel; -1 for an empty cell.
 */
export function cellPredominant(weights: Uint8Array, splatRes: number, cx: number, cz: number): number {
	let s0 = 0
	let s1 = 0
	let s2 = 0
	let s3 = 0
	const x0 = cx * SPLAT_PER_CELL
	const z0 = cz * SPLAT_PER_CELL
	for (let z = z0; z < z0 + SPLAT_PER_CELL; z++) {
		let i = (z * splatRes + x0) * SLOTS
		for (let x = 0; x < SPLAT_PER_CELL; x++, i += SLOTS) {
			s0 += weights[i]
			s1 += weights[i + 1]
			s2 += weights[i + 2]
			s3 += weights[i + 3]
		}
	}
	if (s0 + s1 + s2 + s3 === 0) return -1
	let best = 0
	let max = s0
	if (s1 > max) ((best = 1), (max = s1))
	if (s2 > max) ((best = 2), (max = s2))
	if (s3 > max) best = 3
	return best
}

/** The palette index on top of cell (cx, cz), or NO_TEXTURE. */
export function cellTexture(weights: Uint8Array, chunkSlots: Uint8Array, splatRes: number, chunksPerSide: number, cx: number, cz: number): number {
	const k = cellPredominant(weights, splatRes, cx, cz)
	if (k < 0) return NO_TEXTURE
	const chunk = Math.floor(cz / CHUNK_CELLS) * chunksPerSide + Math.floor(cx / CHUNK_CELLS)
	return chunkSlots[chunk * SLOTS + k]
}

/**
 * The View menu's density, as the client's Ground Clutter slider stops (`SetWorldDetail` writes
 * `frillDensity` 16, 32 or 48): how many cells of a chunk grow tufts, drawn with repeats.
 */
export type DensityLevel = 'sparse' | 'normal' | 'full'
export const FRILL_DENSITY: Record<DensityLevel, number> = { sparse: 16, normal: 32, full: 48 }
export function frillDensity(level: string): number {
	return FRILL_DENSITY[level as DensityLevel] ?? FRILL_DENSITY.normal
}

/**
 * The client's tuft fade (B-178, Benilla's clutter.rs and wow_model.wgsl, MIT/Apache, after the
 * client's 0x6b2b80): on view depth, not distance, the alpha is multiplied by a ramp that holds at
 * 252/255 to three quarters of the 70 yd detail-doodad distance and falls to 0 by its end, and tufts
 * are cut out at alpha 128/255, so opaque grass thins away by 61.1 yd and the edge never shows.
 */
export const TUFT_FADE_FAR = 70
export const TUFT_FADE_NEAR = TUFT_FADE_FAR * 0.75
export const TUFT_ALPHA_REF = 128 / 255

/** The fade's alpha factor at view depth `depth` (yd). */
export function tuftFade(depth: number): number {
	const u = (depth - TUFT_FADE_NEAR) / (TUFT_FADE_FAR - TUFT_FADE_NEAR)
	return Math.min(252 / 255, Math.max(0, (254 - 256 * u) / 255))
}

/** The view depth past which no tuft shows: where the fade takes an opaque texel under the cut-out. */
export const TUFT_CUT_DEPTH = TUFT_FADE_NEAR + ((TUFT_FADE_FAR - TUFT_FADE_NEAR) * (254 - 128)) / 256

/**
 * How far from the camera (in yards, flat) tufts must be built for a view of vertical field `fovY`
 * (degrees) and `aspect`: the cut depth out to the view's side edge, where a tuft is farthest away for
 * its depth. Tufts reach farthest when the view is level, where the vertical angle adds nothing on
 * the ground; looking down, the ground in view is nearer anyway.
 */
export function tuftReach(fovY: number, aspect: number): number {
	const tx = Math.tan((fovY * Math.PI) / 360) * aspect
	return TUFT_CUT_DEPTH * Math.sqrt(1 + tx * tx)
}

/** A building's footprint: its position and turn on the map, and its box in its own space. */
export interface CoverBox {
	x: number
	z: number
	rotY: number
	scale: number
	minX: number
	minZ: number
	maxX: number
	maxZ: number
}

/**
 * Marks in `out` (one byte per cell of a `cells`-a-side map) every cell whose centre lies inside one
 * of the boxes, as the game's tiles mark the cells under a building so no grass grows through its
 * floor. The bytes already set stay set.
 */
export function coverCells(boxes: readonly CoverBox[], cellSize: number, cells: number, out: Uint8Array) {
	for (const b of boxes) {
		const c = Math.cos(b.rotY)
		const s = Math.sin(b.rotY)
		// The box's reach on the map: the turned box's corners, so only the cells near it are tried.
		let lo = Infinity
		let hi = -Infinity
		let loZ = Infinity
		let hiZ = -Infinity
		for (const [lx, lz] of [
			[b.minX, b.minZ],
			[b.maxX, b.minZ],
			[b.minX, b.maxZ],
			[b.maxX, b.maxZ],
		]) {
			const wx = b.x + (lx * c + lz * s) * b.scale
			const wz = b.z + (-lx * s + lz * c) * b.scale
			lo = Math.min(lo, wx)
			hi = Math.max(hi, wx)
			loZ = Math.min(loZ, wz)
			hiZ = Math.max(hiZ, wz)
		}
		const cx0 = Math.max(0, Math.floor(lo / cellSize))
		const cx1 = Math.min(cells - 1, Math.floor(hi / cellSize))
		const cz0 = Math.max(0, Math.floor(loZ / cellSize))
		const cz1 = Math.min(cells - 1, Math.floor(hiZ / cellSize))
		for (let cz = cz0; cz <= cz1; cz++) {
			const dz = (cz + 0.5) * cellSize - b.z
			for (let cx = cx0; cx <= cx1; cx++) {
				const dx = (cx + 0.5) * cellSize - b.x
				// The cell centre in the box's own space: turned back and unscaled.
				const lx = (dx * c - dz * s) / b.scale
				const lz = (dx * s + dz * c) / b.scale
				if (lx >= b.minX && lx <= b.maxX && lz >= b.minZ && lz <= b.maxZ) out[cz * cells + cx] = 1
			}
		}
	}
}

/**
 * The no-doodad bits (or the hole cells) of paint chunk (gx, gz) of a `cells`-a-side map from a per-cell map: one byte
 * per cell row, bit n for cell n, as the tile's header holds them; null when none is set.
 */
export function chunkNoEffect(blocked: Uint8Array, cells: number, gx: number, gz: number): number[] | null {
	let any = false
	const rows = new Array<number>(CHUNK_CELLS).fill(0)
	for (let r = 0; r < CHUNK_CELLS; r++) {
		const base = (gz * CHUNK_CELLS + r) * cells + gx * CHUNK_CELLS
		for (let c = 0; c < CHUNK_CELLS; c++) {
			if (blocked[base + c]) {
				rows[r] |= 1 << c
				any = true
			}
		}
	}
	return any ? rows : null
}

// The client's own scatter, CMapChunk::CreateDetailDoodads (0x6bfc10), ported from Benilla's
// ground_effects.rs (MIT/Apache; `scatter_ground_doodads`, `BlizzardRandomizer`). Its noise table is the
// one Noggit Red's ChunkAddDetailDoodads.cpp recovers.

/** The client's detail-doodad noise table, a permutation of 0..255. */
const NOISE = new Uint8Array([
	0x8e, 0x14, 0x27, 0x99, 0xfd, 0xaa, 0xc7, 0x08, 0xd5, 0xe6, 0x3e, 0x1f, 0xf6, 0xbb, 0x55, 0xda, 0x75, 0xa0, 0x4a, 0x6a, 0xe8, 0xbd, 0x97, 0xff, 0xde, 0x9b, 0xbc, 0x9f, 0x81, 0x8a, 0xa1, 0x46, 0x6e, 0x0b, 0xe3, 0x63, 0x76, 0x7a, 0x6c,
	0x5d, 0x88, 0xd3, 0x69, 0xca, 0xc3, 0x47, 0xb9, 0x25, 0x83, 0xab, 0xa2, 0x3f, 0xa6, 0x41, 0x7c, 0xba, 0xe5, 0xac, 0x95, 0x01, 0x7e, 0xcf, 0x09, 0xc1, 0xd9, 0x62, 0x70, 0x71, 0x8d, 0xdb, 0x05, 0x02, 0x24, 0x87, 0xef, 0x54, 0xc6, 0xd4,
	0x37, 0x30, 0xd0, 0x1b, 0xcb, 0x7b, 0xb8, 0xe4, 0xd8, 0xec, 0x49, 0xce, 0xad, 0xdc, 0x13, 0xa9, 0x94, 0xc4, 0x8f, 0x39, 0xae, 0x0d, 0x18, 0x52, 0xdd, 0x0e, 0x78, 0xfa, 0xf5, 0x85, 0x58, 0xd2, 0xaf, 0x6d, 0xa4, 0xb2, 0x53, 0x3b, 0x51,
	0xa5, 0x50, 0xbe, 0xfc, 0x2d, 0xf4, 0x11, 0x48, 0x98, 0x16, 0xf1, 0x86, 0xdf, 0x3d, 0x66, 0x5e, 0x44, 0x2e, 0x2f, 0x36, 0x07, 0x6b, 0x17, 0x8b, 0x29, 0x4c, 0xb6, 0xe2, 0x89, 0x5f, 0xe7, 0xcd, 0xa7, 0x21, 0xe1, 0x4d, 0xc9, 0x65, 0xed,
	0xfe, 0xee, 0x9c, 0x23, 0x33, 0x7d, 0xb7, 0x04, 0x9e, 0x9a, 0x2a, 0x40, 0xb3, 0x10, 0x5b, 0xf3, 0x82, 0x77, 0x1c, 0x92, 0x20, 0x4e, 0x1e, 0x57, 0x22, 0x72, 0x06, 0x8c, 0x67, 0x2c, 0x73, 0xfb, 0x59, 0xc2, 0x0a, 0xbf, 0x79, 0x5c, 0xf9,
	0x0c, 0x28, 0x1a, 0x12, 0x68, 0x74, 0x34, 0x19, 0x42, 0xb1, 0xc0, 0x84, 0xf8, 0x38, 0xf0, 0x15, 0x9d, 0x60, 0xf2, 0x3a, 0x6f, 0xb4, 0x90, 0xeb, 0x91, 0x1d, 0x7f, 0x35, 0x61, 0x5a, 0x32, 0x03, 0x56, 0xa3, 0xc5, 0x2b, 0x93, 0x80, 0x0f,
	0x4b, 0x43, 0xf7, 0xa8, 0xe0, 0x3c, 0x96, 0xd1, 0x64, 0x26, 0xd7, 0x45, 0xcc, 0x4f, 0xc8, 0xb0, 0xe9, 0xb5, 0x00, 0xd6, 0x31, 0xea,
])

/** Little-endian u32 at byte `i` of the noise table; the lanes keep `i` at most 251. */
function noise32(i: number): number {
	return (NOISE[i] | (NOISE[i + 1] << 8) | (NOISE[i + 2] << 16) | (NOISE[i + 3] << 24)) >>> 0
}

const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0

/** One lane of the seed: a negative index adds the lane's own constant, not a mod-256 wrap (0x4531e0). */
function lane(byte: number, sub: number, wrap: number): number {
	const i = (byte & 0xff) - sub
	return i < 0 ? i + wrap : i
}

/** The client's detail-doodad randomizer (0x4531e0, its seed expanded by 0x44ea80), seeded once a chunk. */
export class BlizzardRandomizer {
	source = 0
	seed = 0

	constructor(source = 0) {
		this.reset(source)
	}

	reset(source: number): this {
		source >>>= 0
		this.source = source
		this.seed = (((source % 0x2f) << 26) | ((source % 0x35) << 18) | ((source % 0x3b) << 10) | (4 * (source % 0x3d))) >>> 0
		return this
	}

	/** Advances and returns the next source, a u32. */
	shuffle(): number {
		const s = this.seed
		const a = lane(s, 0x1c, 0xf4)
		const b = lane(s >>> 8, 0x18, 0xec)
		const c = lane(s >>> 16, 0x0c, 0xd4)
		const d = lane(s >>> 24, 0x04, 0xbc)
		this.seed = (a | (b << 8) | (c << 16) | (d << 24)) >>> 0
		this.source = (this.source + ((noise32(a) ^ rotl(noise32(d), 1) ^ rotl(noise32(c), 2) ^ rotl(noise32(b), 3)) >>> 0)) >>> 0
		return this.source
	}

	/** The client's genCoord: a mantissa in [1, 2), mapped by the roll's sign bit to (0, 1] or [-1, 0). */
	signedUnit(): number {
		const u = this.shuffle()
		const f = 1 + (u & 0x7fffff) / 0x800000
		return u >= 0x80000000 ? 2 - f : f - 2
	}
}

/** The seed of a chunk: its place among all the map's chunks, (global row << 16) | global column. */
export const chunkSeed = (globalX: number, globalY: number) => ((globalY << 16) | (globalX & 0xffff)) >>> 0

/** One tuft of a chunk: its cell (row * 8 + column), where in it (0..1 east and south), which of the effect's doodads, its turn and size. */
export interface Tuft {
	cell: number
	u: number
	v: number
	doodad: number
	rotY: number
	scale: number
}

/**
 * The tufts of one chunk, as the client scatters them: `frill` cells drawn at random with repeats
 * (column, then row), then in each, in that order, the effect's density of doodads (8 for a density
 * of 0), the nth taking slot (n + the cell's turn in the list) & 3. `cells` holds each cell's effect
 * (row * 8 + column), null for a cell that grows nothing (no texture or effect, a hole, a no-tuft
 * cell), which draws nothing from the stream. A doodad's position is drawn even when its slot is
 * empty; its size (0.9 to 1.1) and turn only when it is placed. Written into `out`, reused; returns how many.
 */
export function scatterChunk(rng: BlizzardRandomizer, seed: number, frill: number, cells: ReadonlyArray<GroundEffect | null>, out: Tuft[]): number {
	rng.reset(seed)
	const picks = scatterPicks
	if (picks.length < frill) picks.length = frill
	for (let i = 0; i < frill; i++) {
		const col = rng.shuffle() & 7
		const row = rng.shuffle() & 7
		picks[i] = row * CHUNK_CELLS + col
	}
	let count = 0
	for (let i = 0; i < frill; i++) {
		const cell = picks[i]
		const effect = cells[cell]
		if (!effect) continue
		const density = effect.density || 8
		for (let n = 0; n < density; n++) {
			const rx = rng.signedUnit()
			const ry = rng.signedUnit()
			const slot = effect.slots[(n + i) & 3]
			if (slot < 0) continue
			const scale = rng.signedUnit() * 0.1 + 1
			const yaw = rng.signedUnit() * Math.PI
			const t = out[count] ?? (out[count] = { cell: 0, u: 0, v: 0, doodad: 0, rotY: 0, scale: 1 })
			t.cell = cell
			t.u = (rx + 1) * 0.5
			t.v = (ry + 1) * 0.5
			t.doodad = slot
			t.rotY = yaw
			t.scale = scale
			count++
		}
	}
	return count
}
const scatterPicks: number[] = []

/** The effect IDs the client's tiles use, with how many textures use each, most used first, for a chooser. */
export function knownEffects(tables: GroundEffectTables): Array<{ id: number; uses: number }> {
	const uses = new Map<number, number>()
	for (const id of Object.values(tables.textures)) if (id && tables.effects[id]) uses.set(id, (uses.get(id) ?? 0) + 1)
	return [...uses].map(([id, n]) => ({ id, uses: n })).sort((a, b) => b.uses - a.uses || a.id - b.id)
}
