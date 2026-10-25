// Height profiles of the shaped sculpt brushes (Crevice and Mountain) and the angled flatten plane.
// Kept free of the terrain class so they can be tested on their own.

import { brushWeight } from './falloff'

/**
 * The Crevice brush's trench. `t` is the normalised brush distance (0 at the centre, 1 at the edge)
 * and `falloff` the share of the radius the ridges take, so the trench is the brush's solid centre.
 * Returns how much to dig at `t`, 0 outside the trench: a U, deepest at the centre.
 */
export function creviceDig(t: number, falloff: number): number {
	const c = trenchWidth(falloff)
	if (t >= c) return 0
	return 0.5 + 0.5 * Math.cos((Math.PI * t) / c)
}

/**
 * The Crevice brush's ridge, the band outside the trench where the dug ground is piled up. Returns a
 * bump in [0,1] that is 0 at the trench wall and at the brush edge.
 */
export function creviceRidge(t: number, falloff: number): number {
	const c = trenchWidth(falloff)
	if (t <= c || t >= 1) return 0
	return Math.sin((Math.PI * (t - c)) / (1 - c))
}

/** Share of the radius the trench takes. Clamped so both the trench and the ridges always exist. */
export function trenchWidth(falloff: number): number {
	return Math.min(0.9, Math.max(0.1, 1 - falloff))
}

/**
 * How much to scale the ridge so it holds the dug volume: `dig` and `ridge` are the sums of the two
 * profiles over the vertices the brush touches. Capped so a thin ridge band on a small brush doesn't
 * spike.
 */
export function ridgeScale(dig: number, ridge: number): number {
	if (ridge <= 0) return 0
	return Math.min(4, dig / ridge)
}

/**
 * The Mountain brush's profile: `t` is the normalised distance and `n` a ridged noise sample in [0,1].
 * The whole brush is slope (the falloff curve shapes it, the falloff width is ignored), so it tops
 * out in a peak rather than a plateau. `ridges` (0 to 1) is how much of the height the ridges carve
 * away: 0 gives a smooth hill, 1 a mountain all ridges.
 */
export function mountainHeight(t: number, n: number, ridges: number): number {
	const peak = brushWeight(t, 1)
	return peak * (1 - ridges + ridges * n)
}

/**
 * The height of the angled flatten plane at (x, z): it passes through (ox, oy, oz) and rises at
 * `angle` degrees toward `dir` degrees (0 is +x, 90 is +z), as noggit3's angled flatten does.
 */
export function angledHeight(x: number, z: number, ox: number, oy: number, oz: number, angle: number, dir: number): number {
	const a = (Math.max(-89, Math.min(89, angle)) * Math.PI) / 180
	const d = (dir * Math.PI) / 180
	return oy + ((x - ox) * Math.cos(d) + (z - oz) * Math.sin(d)) * Math.tan(a)
}

/** The step a height stands on for the Terrace brush: the highest level `offset + n * step` at or below `h`. */
export function terraceLevel(h: number, step: number, offset: number): number {
	return offset + Math.floor((h - offset) / step) * step
}

/**
 * The Terrace brush's target for a height `h` (#166): the step below it, flat over the step's first
 * `sharpness` share, then rising to the next step over the rest, eased. Sharpness 1 gives flat steps
 * with cliffs between them, 0 smooth stairs. A step of 0 or less leaves `h` as it is.
 */
export function terraceHeight(h: number, step: number, offset: number, sharpness: number): number {
	if (!(step > 0)) return h
	const level = terraceLevel(h, step, offset)
	const edge = 1 - Math.min(1, Math.max(0, sharpness))
	if (edge <= 0) return level
	const f = (h - level) / step
	const t = (f - (1 - edge)) / edge
	if (t <= 0) return level
	return level + step * t * t * (3 - 2 * t)
}
