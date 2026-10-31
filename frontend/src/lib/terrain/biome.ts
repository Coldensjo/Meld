// Biomes (#957): a saved look for an area of the map, after World Creator's biomes. A biome holds the
// ground textures of auto-paint's roles with the thresholds of its rules (terrain/autoPaint.ts), a
// ground effect per texture and the doodad brushes it scatters, and Apply Biome lays all of it over
// the selected area or the paint mask as one undo step. Biomes are preferences (`prefs.biomes`), kept
// beside the doodad brushes; each embeds its brushes, and holds client paths only.
//
// This module is the data and the paint arithmetic, with no rendering dependency, so it can be tested
// on its own (tests/biome.test.ts). Engine.applyBiome drives it.

import type { DoodadBrush } from '../tools/doodadBrush'
import { AUTO_PAINT_MIN_SHARE, AUTO_PAINT_ROLES, AUTO_PAINT_RULES, VARIATION_YARDS, texelRoles, type PaintRules } from './autoPaint'
import { SAND_BAND } from './beach'
import { NO_TEXTURE, SLOTS, chunkTexelRect, normalizeTexel } from './chunkPaint'

/** The roles a biome gives a texture, in auto-paint's order (wow/texturePack.ts: 0 grass ... 5 snow). */
export const BIOME_ROLES = ['Base', 'Lush patches', 'Dirt rim', 'Rock', 'Sand', 'Snow'] as const

/** Where a role with no texture of its own looks next, as a texture pack's do. */
const FALLBACK: Record<number, number> = { 1: 0, 2: 0, 3: 2, 4: 2, 5: 3 }

/** A biome's thresholds, in the units its window shows (degrees and yards). */
export interface BiomeRules {
	/** The slope in degrees the rock starts at, and the one it covers the ground at. */
	rock: [number, number]
	/** The slope in degrees the dirt rim at the rock's foot starts at, and the one it is full at. */
	dirt: [number, number]
	/** About the share of the base the lush patches cover, 0 to 1. */
	lush: number
	/** Yards across a wave of the patches' noise. */
	variation: number
	/** Yards over the sea (and the lakes) the sand goes. */
	sand: number
	/** The snow line in yards above the sea, or null for the map's own (presets.ts `snowLine`). */
	snow: number | null
}

/** A doodad brush a biome scatters, and how thickly. */
export interface BiomeScatter {
	brush: DoodadBrush
	/** Placements tried per 10,000 square yards. */
	density: number
	/** Grow in clumps (woods and clearings) rather than evenly. */
	clumps: boolean
}

export interface Biome {
	name: string
	/** A texture path per role of BIOME_ROLES ('' for none: the role takes its fallback's). */
	textures: string[]
	rules: BiomeRules
	/** The ground effect (a GroundEffectTexture ID, 0 for none) per texture path the biome sets as the map's own. */
	effects: Record<string, number>
	/** Write the effects for the tiles the area touches only (the map's scopedEffects), not for the texture over the whole map. */
	tileEffects?: boolean
	scatter: BiomeScatter[]
}

const deg = (rise: number) => Math.round((Math.atan(rise) * 180) / Math.PI)

/** Auto-paint's own rules, in a biome's units. */
export const DEFAULT_BIOME_RULES: BiomeRules = {
	rock: [deg(AUTO_PAINT_RULES.rock[0]), deg(AUTO_PAINT_RULES.rock[1])],
	dirt: [deg(AUTO_PAINT_RULES.dirt[0]), deg(AUTO_PAINT_RULES.dirt[1])],
	lush: AUTO_PAINT_RULES.lush,
	variation: VARIATION_YARDS,
	sand: SAND_BAND,
	snow: null,
}

export function newBiome(name: string, textures: string[] = []): Biome {
	const t = BIOME_ROLES.map((_, r) => textures[r] ?? '')
	return { name, textures: t, rules: { ...DEFAULT_BIOME_RULES, rock: [...DEFAULT_BIOME_RULES.rock], dirt: [...DEFAULT_BIOME_RULES.dirt] }, effects: {}, scatter: [] }
}

/** A name not taken by any of `list`: "Biome", "Biome 2" ... */
export function freeBiomeName(list: readonly Biome[], base = 'Biome'): string {
	const taken = new Set(list.map((b) => b.name))
	if (!taken.has(base)) return base
	for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

/** A deep copy, so an edit of one never changes another (or a brush it was made from). */
export function copyBiome(b: Biome): Biome {
	return JSON.parse(JSON.stringify(b)) as Biome
}

/** The texture each role paints with: its own, else its fallback's; '' when even the base has none. */
export function roleTextures(b: Biome): string[] {
	return BIOME_ROLES.map((_, r) => {
		let from = r
		while (!b.textures[from] && from !== 0) from = FALLBACK[from]
		return b.textures[from] ?? ''
	})
}

/** The biome's rules as auto-paint's thresholds. */
export function paintRules(r: BiomeRules): PaintRules {
	const rise = (d: number) => Math.tan((Math.min(89, Math.max(0, d)) * Math.PI) / 180)
	const pair = (p: [number, number]): [number, number] => {
		const a = rise(p[0])
		return [a, Math.max(a + 1e-3, rise(p[1]))]
	}
	return { rock: pair(r.rock), dirt: pair(r.dirt), lush: Math.min(1, Math.max(0, r.lush)), variation: Math.max(10, r.variation), snow: r.snow }
}

/** The ground a biome is painted on: a map's terrain, or a test's. */
export interface BiomeGround {
	heights: Float32Array
	/** Cells a side. */
	size: number
	cellSize: number
	splatRes: number
	paintChunksPerSide: number
	weights: Uint8Array
	chunkSlots: Uint8Array
}

export interface BiomePaint {
	/** The palette index each role paints (BIOME_ROLES' order). */
	roleTex: number[]
	rules: BiomeRules
	waterLevel: number
	waterEnabled: boolean
	seed: number
}

/** What a paint did: the chunks it changed, and those where a texture of the old paint had to go to make room. */
export interface BiomePaintResult {
	chunks: number
	replaced: number
	/** The texels changed, inclusive; null when none. */
	bounds: { x0: number; z0: number; x1: number; z1: number } | null
}

const ROLE_COUNT = BIOME_ROLES.length
/** The most candidates a chunk weighs: its four slots and a texture per role. */
const MAX_CANDIDATES = SLOTS + ROLE_COUNT

/**
 * Paints a biome over `mask` (a value per splat texel, 0 to 255: how much of the biome goes there)
 * within `rect` (inclusive texels). Each texel blends the biome's paint over its own by the mask, and
 * each chunk then keeps the four textures with the most weight in it (three where the biome covers it
 * whole, as auto-paint keeps), none of the biome's under auto-paint's smallest share; a texture of the
 * old paint that has to go is counted in `replaced`, its weight goes to the kept ones (where a texel had nothing else, the strongest). Never more
 * than four layers in a chunk. Writes `g.weights` and `g.chunkSlots` in place.
 */
export function paintBiome(g: BiomeGround, mask: Uint8Array, rect: { x0: number; z0: number; x1: number; z1: number }, p: BiomePaint): BiomePaintResult {
	const R = g.splatRes
	const side = g.paintChunksPerSide
	const per = R / side
	const fill = texelRoles({ heights: g.heights, size: g.size, cellSize: g.cellSize, res: R, side, roles: ROLE_COUNT, waterLevel: p.waterLevel, waterEnabled: p.waterEnabled, sand: p.rules.sand, seed: p.seed }, paintRules(p.rules))
	const roleOut = new Float32Array(ROLE_COUNT)
	const cand = new Int32Array(MAX_CANDIDATES)
	const fromBiome = new Uint8Array(MAX_CANDIDATES)
	const totals = new Float64Array(MAX_CANDIDATES)
	const oldTotals = new Float64Array(MAX_CANDIDATES)
	const texel = new Float32Array(per * per * MAX_CANDIDATES)
	const slot = new Int32Array(ROLE_COUNT)
	let chunks = 0
	let replaced = 0
	let bounds: BiomePaintResult['bounds'] = null
	const cx0 = Math.floor(rect.x0 / per)
	const cz0 = Math.floor(rect.z0 / per)
	const cx1 = Math.floor(rect.x1 / per)
	const cz1 = Math.floor(rect.z1 / per)
	for (let cz = cz0; cz <= cz1; cz++) {
		for (let cx = cx0; cx <= cx1; cx++) {
			const c = cz * side + cx
			const { x0, z0 } = chunkTexelRect(side, R, c)
			// The candidates: the chunk's own textures, then the biome's.
			let n = 0
			for (let k = 0; k < SLOTS; k++) {
				const tex = g.chunkSlots[c * SLOTS + k]
				cand[n] = tex
				fromBiome[n] = 0
				n++
			}
			for (let r = 0; r < ROLE_COUNT; r++) {
				const tex = p.roleTex[r]
				let at = -1
				for (let i = 0; i < n; i++) if (cand[i] === tex) at = i
				if (at < 0) {
					at = n++
					cand[at] = tex
				}
				fromBiome[at] = 1
				slot[r] = at
			}
			totals.fill(0)
			oldTotals.fill(0)
			let any = false
			let whole = true
			let biomeAll = 0
			for (let lz = 0; lz < per; lz++) {
				for (let lx = 0; lx < per; lx++) {
					const x = x0 + lx
					const z = z0 + lz
					const a = mask[z * R + x] / 255
					const base = (z * R + x) * SLOTS
					const t = (lz * per + lx) * MAX_CANDIDATES
					for (let i = 0; i < MAX_CANDIDATES; i++) texel[t + i] = 0
					for (let k = 0; k < SLOTS; k++) {
						if (cand[k] === NO_TEXTURE) continue
						const w = (g.weights[base + k] / 255) * (1 - a)
						texel[t + k] += w
						oldTotals[k] += g.weights[base + k] / 255
					}
					if (a > 0) {
						any = true
						fill(x, z, roleOut)
						for (let r = 0; r < ROLE_COUNT; r++) {
							const w = (roleOut[r] / 255) * a
							texel[t + slot[r]] += w
							biomeAll += w
						}
					}
					if (a < 1) whole = false
				}
			}
			if (!any) continue
			for (let lz = 0; lz < per; lz++) for (let lx = 0; lx < per; lx++) for (let i = 0; i < n; i++) totals[i] += texel[(lz * per + lx) * MAX_CANDIDATES + i]
			// The biome's own speckle under auto-paint's smallest share is left out, as auto-paint leaves it.
			const order: number[] = []
			for (let i = 0; i < n; i++) {
				if (cand[i] === NO_TEXTURE || totals[i] <= 0) continue
				if (fromBiome[i] && i >= SLOTS && totals[i] < biomeAll * AUTO_PAINT_MIN_SHARE) continue
				order.push(i)
			}
			order.sort((a, b) => totals[b] - totals[a])
			const kept = order.slice(0, whole ? AUTO_PAINT_ROLES : SLOTS)
			for (let k = 0; k < SLOTS; k++) {
				if (cand[k] === NO_TEXTURE || kept.includes(k)) continue
				// An old texture that still showed in the chunk had to make room.
				if (oldTotals[k] >= per * per * AUTO_PAINT_MIN_SHARE && totals[k] > 0) {
					replaced++
					break
				}
			}
			for (let k = 0; k < SLOTS; k++) g.chunkSlots[c * SLOTS + k] = k < kept.length ? cand[kept[k]] : NO_TEXTURE
			if (!kept.length) g.chunkSlots[c * SLOTS] = p.roleTex[0]
			for (let lz = 0; lz < per; lz++) {
				for (let lx = 0; lx < per; lx++) {
					const t = (lz * per + lx) * MAX_CANDIDATES
					const base = ((z0 + lz) * R + x0 + lx) * SLOTS
					let sum = 0
					for (let k = 0; k < kept.length; k++) sum += texel[t + kept[k]]
					for (let k = 0; k < SLOTS; k++) g.weights[base + k] = 0
					if (sum > 0) for (let k = 0; k < kept.length; k++) g.weights[base + k] = Math.round((texel[t + kept[k]] * 255) / sum)
					normalizeTexel(g.weights, base)
				}
			}
			chunks++
			if (!bounds) bounds = { x0, z0, x1: x0 + per - 1, z1: z0 + per - 1 }
			else {
				bounds.x0 = Math.min(bounds.x0, x0)
				bounds.z0 = Math.min(bounds.z0, z0)
				bounds.x1 = Math.max(bounds.x1, x0 + per - 1)
				bounds.z1 = Math.max(bounds.z1, z0 + per - 1)
			}
		}
	}
	return { chunks, replaced, bounds }
}

/**
 * The mask of a selected area for a biome (`m`, a value per splat texel, R a side, written in place):
 * full inside, fading to nothing over about `feather` texels inside its edge, so the biome blends into
 * the ground around it and never reaches past the selection. `inside` is the hard mask of the area's
 * texels (as `markAreaTexels` gives it); `rect` (inclusive texels) bounds it.
 */
export function featherInside(inside: Uint8Array, R: number, rect: { x0: number; z0: number; x1: number; z1: number }, feather: number, m: Uint8Array) {
	m.fill(0)
	if (feather <= 0) {
		m.set(inside)
		return
	}
	// Each texel's distance to the nearest texel outside, by two passes of a chamfer distance over the
	// rect and a margin (the map's edge counts as inside).
	const pad = 1
	const x0 = Math.max(0, rect.x0 - pad)
	const z0 = Math.max(0, rect.z0 - pad)
	const x1 = Math.min(R - 1, rect.x1 + pad)
	const z1 = Math.min(R - 1, rect.z1 + pad)
	const w = x1 - x0 + 1
	const h = z1 - z0 + 1
	const d = new Float32Array(w * h)
	const BIG = 1e9
	for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) d[z * w + x] = inside[(z0 + z) * R + x0 + x] ? BIG : 0
	const D = Math.SQRT2
	const at = (x: number, z: number) => (x < 0 || z < 0 || x >= w || z >= h ? BIG : d[z * w + x])
	for (let z = 0; z < h; z++) {
		for (let x = 0; x < w; x++) {
			const i = z * w + x
			if (!d[i]) continue
			d[i] = Math.min(d[i], at(x - 1, z) + 1, at(x, z - 1) + 1, at(x - 1, z - 1) + D, at(x + 1, z - 1) + D)
		}
	}
	for (let z = h - 1; z >= 0; z--) {
		for (let x = w - 1; x >= 0; x--) {
			const i = z * w + x
			if (!d[i]) continue
			d[i] = Math.min(d[i], at(x + 1, z) + 1, at(x, z + 1) + 1, at(x + 1, z + 1) + D, at(x - 1, z + 1) + D)
		}
	}
	for (let z = 0; z < h; z++) {
		for (let x = 0; x < w; x++) {
			const v = d[z * w + x]
			if (!v) continue
			// The texel next to the edge is at 1: it still gets a little of the biome.
			const t = Math.min(1, v / feather)
			m[(z0 + z) * R + x0 + x] = Math.round(t * t * (3 - 2 * t) * 255)
		}
	}
}
