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

/** The packed weights and chunk roles (as `packRoles` gives them) of a world's planned paint. */
export function autoPaintRoles(p: AutoPaintInput): { weights: Uint8Array; chunkSlots: Uint8Array } {
	const { heights, size, cellSize, res, roles, waterLevel, sand, shores, seed } = p
	const worldSize = size * cellSize
	const verts = size + 1
	let maxH = -Infinity
	for (let i = 0; i < heights.length; i++) maxH = Math.max(maxH, heights[i])
	const snow = snowLine(waterLevel, maxH)
	const w = new Float32Array(roles)
	const f = 1 / VARIATION_YARDS
	const noiseSeed = (seed * 7919 + 99) | 0
	const h = (x: number, z: number) => heightAt(heights, size, cellSize, x, z)
	// The slope over `e` yards each way: over a few yards, the cliffs' rock keeps clean edges where a
	// texel's own slope flickers with every bump of the ground.
	const slopeAt = (x: number, z: number, e: number) => Math.hypot(h(x + e, z) - h(x - e, z), h(x, z + e) - h(x, z - e)) / (2 * e)
	return packRoles(
		p.side,
		res,
		roles,
		(i, j, out) => {
			const x = ((i + 0.5) / res) * worldSize
			const z = ((j + 0.5) / res) * worldSize
			const y = h(x, z)
			const slope = slopeAt(x, z, ROCK_YARDS)
			w.fill(0)
			w[GRASS] = 1
			over(w, LUSH, smoothstep(0.5, 0.58, fbm(x * f, z * f, 3, noiseSeed)))
			// Dirt rims the rock's foot: the slopes just short of the rock's.
			over(w, DIRT, smoothstep(0.4, 0.6, slopeAt(x, z, DIRT_YARDS)) * 0.9)
			if (p.waterEnabled) over(w, SAND, Math.min(1, Math.max(0, (waterLevel + sand - y) / SAND_BAND)))
			if (shores) {
				const lake = shores[Math.round(z / cellSize) * verts + Math.round(x / cellSize)]
				if (y < lake + 1.2) over(w, SAND, Math.min(1, Math.max(0, (lake + 1.2 - y) / 1.2)))
			}
			over(w, SNOW, Math.min(1, Math.max(0, (y - snow) / 6)))
			over(w, ROCK, smoothstep(0.62, 0.9, slope))
			for (let k = 0; k < roles; k++) out[k] = w[k] * 255
		},
		AUTO_PAINT_ROLES,
		AUTO_PAINT_MIN_SHARE,
	)
}
