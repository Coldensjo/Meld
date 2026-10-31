// The textures `Terrain.autoPaint` lays on a new world (and Paint > Auto-paint), planned as the client's
// zones are painted (#771): one base ground in large areas, a second variation of it in patches a few
// hundred yards across with long soft edges, rock on the steep slopes with a rim of dirt at its foot,
// sand along the shores and snow above the snow line, and no more than three textures in a chunk.
// Each rule is a layer laid over the ones before it with its own alpha, as the client blends a chunk's
// layers over its base. Roles as in wow/texturePack.ts: 0 grass, 1 lush, 2 dirt, 3 rock, 4 sand, 5 snow.
import { fbm } from '../engine/noise'
import { heightAt } from './heightField'
import { packRoles } from './chunkPaint'
import { SAND_BAND } from './beach'
import { snowLine } from './presets'

const GRASS = 0
const LUSH = 1
const DIRT = 2
const ROCK = 3
const SAND = 4
const SNOW = 5

/** Yards a wave of the base's variation noise spans: the lush patches are about half that across. */
export const VARIATION_YARDS = 260
/** Yards each way the rock's slope is measured over. */
const ROCK_YARDS = 6
/** Yards each way the dirt's is: wider, so the rim round the rock's foot reaches out past it in one band. */
const DIRT_YARDS = 12
/** Textures a chunk keeps at most: the client's zones blend one to three in a chunk. */
export const AUTO_PAINT_ROLES = 3
/** The share of a chunk's paint below which a texture is left out of it, so a chunk holds no speckle of a fourth. */
export const AUTO_PAINT_MIN_SHARE = 0.04

export interface AutoPaintInput {
	heights: Float32Array
	/** Cells a side. */
	size: number
	cellSize: number
	/** Splat texels a side. */
	res: number
	/** Paint chunks a side. */
	side: number
	roles: number
	waterLevel: number
	waterEnabled: boolean
	/** The lake level near each vertex (`shoreLevels`), NaN away from any, or null. */
	shores?: Float32Array | null
	/** Yards over the sea the sand goes. */
	sand: number
	/** The world's seed: the variation's patches follow it. */
	seed: number
}

function smoothstep(a: number, b: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
	return t * t * (3 - 2 * t)
}

/** Lays `role` over the texel's weights `w` (summing to 1) at alpha `a`. */
function over(w: Float32Array, role: number, a: number) {
	if (a <= 0) return
	for (let k = 0; k < w.length; k++) w[k] *= 1 - a
	w[role] += a
}

/**
 * The thresholds of the paint's rules (#957): the defaults are a new world's (`AUTO_PAINT_RULES`), a
 * biome (terrain/biome.ts) sets its own. Slopes are rise over run.
 */
export interface PaintRules {
	/** The slope (over ROCK_YARDS) the rock starts at and the one it covers the ground at. */
	rock: [number, number]
	/** The slope (over DIRT_YARDS) the dirt rim starts at and the one it is full at. */
	dirt: [number, number]
	/** About the share of the ground the lush patches cover, 0 to 1. */
	lush: number
	/** Yards a wave of the variation noise spans. */
	variation: number
	/** The snow line in yards above the sea, or null for the world's own (`snowLine`). */
	snow: number | null
}

export const AUTO_PAINT_RULES: PaintRules = { rock: [0.62, 0.9], dirt: [0.4, 0.6], lush: 0.5, variation: VARIATION_YARDS, snow: null }

/**
 * The rules' weights of texel (i, j) over the six roles, each 0 to 255, written into `out` (at least six
 * long; the rest left at 0). Built once per paint: the closure reuses its scratch.
 */
export function texelRoles(p: AutoPaintInput, rules: PaintRules = AUTO_PAINT_RULES): (i: number, j: number, out: Float32Array) => void {
	const { heights, size, cellSize, res, roles, waterLevel, sand, shores, seed } = p
	const worldSize = size * cellSize
	const verts = size + 1
	let maxH = -Infinity
	for (let i = 0; i < heights.length; i++) maxH = Math.max(maxH, heights[i])
	const snow = rules.snow === null ? snowLine(waterLevel, maxH) : waterLevel + rules.snow
	const w = new Float32Array(Math.max(roles, SNOW + 1))
	const f = 1 / rules.variation
	const lushFrom = 1 - rules.lush
	const noiseSeed = (seed * 7919 + 99) | 0
	const h = (x: number, z: number) => heightAt(heights, size, cellSize, x, z)
	// The slope over `e` yards each way: over a few yards, the cliffs' rock keeps clean edges where a
	// texel's own slope flickers with every bump of the ground.
	const slopeAt = (x: number, z: number, e: number) => Math.hypot(h(x + e, z) - h(x - e, z), h(x, z + e) - h(x, z - e)) / (2 * e)
	return (i, j, out) => {
		const x = ((i + 0.5) / res) * worldSize
		const z = ((j + 0.5) / res) * worldSize
		const y = h(x, z)
		const slope = slopeAt(x, z, ROCK_YARDS)
		w.fill(0)
		w[GRASS] = 1
		over(w, LUSH, smoothstep(lushFrom, lushFrom + 0.08, fbm(x * f, z * f, 3, noiseSeed)))
		// Dirt rims the rock's foot: the slopes just short of the rock's.
		over(w, DIRT, smoothstep(rules.dirt[0], rules.dirt[1], slopeAt(x, z, DIRT_YARDS)) * 0.9)
		if (p.waterEnabled) over(w, SAND, Math.min(1, Math.max(0, (waterLevel + sand - y) / SAND_BAND)))
		if (shores) {
			const lake = shores[Math.round(z / cellSize) * verts + Math.round(x / cellSize)]
			if (y < lake + sand) over(w, SAND, Math.min(1, Math.max(0, (lake + sand - y) / SAND_BAND)))
		}
		over(w, SNOW, Math.min(1, Math.max(0, (y - snow) / 6)))
		over(w, ROCK, smoothstep(rules.rock[0], rules.rock[1], slope))
		for (let k = 0; k < roles; k++) out[k] = w[k] * 255
	}
}

/** The packed weights and chunk roles (as `packRoles` gives them) of a world's planned paint. */
export function autoPaintRoles(p: AutoPaintInput): { weights: Uint8Array; chunkSlots: Uint8Array } {
	return packRoles(p.side, p.res, p.roles, texelRoles(p), AUTO_PAINT_ROLES, AUTO_PAINT_MIN_SHARE)
}
