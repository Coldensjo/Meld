// A map's texture roles, after how Blizzard's zones are painted: a base ground (grass), a rock for
// the mountains, and a dirt that rims the rock's foot, lines roads and edges the water. The roles
// name palette entries. Sculpting "By slope" paints the rock and the dirt as the ground is shaped.

export const NO_ROLE = -1

export interface TextureRoles {
	/** Palette index of the rock texture, or NO_ROLE. */
	rock: number
	/** Palette index of the dirt texture, or NO_ROLE. */
	dirt: number
}

export const noRoles = (): TextureRoles => ({ rock: NO_ROLE, dirt: NO_ROLE })

const ROCK = [/rockbase/i, /rock/i, /cliff/i, /stone/i, /crag/i]
const DIRT = [/dirtbase/i, /dirt/i, /mud/i, /road/i, /path/i]
/** The built-in colour palette's roles (terrain/layers.ts): 2 dirt, 3 rock. */
const COLOUR_ROCK = 3
const COLOUR_DIRT = 2

function firstMatch(palette: readonly string[], patterns: RegExp[], not: number): number {
	for (const re of patterns) {
		const i = palette.findIndex((p, k) => k !== not && !p.startsWith('#') && re.test(p.slice(p.lastIndexOf('\\') + 1)))
		if (i >= 0) return i
	}
	return NO_ROLE
}

/**
 * The roles a palette suggests by its texture names ("ElwynnRockBase" is the rock, "ElwynnDirtBase"
 * the dirt), falling back to the colour palette's fixed slots. Used for a map that has none saved.
 */
export function guessRoles(palette: readonly string[]): TextureRoles {
	const rock = firstMatch(palette, ROCK, NO_ROLE)
	const dirt = firstMatch(palette, DIRT, rock)
	const colours = palette.every((p) => p.startsWith('#'))
	return {
		rock: rock >= 0 ? rock : colours && palette.length > COLOUR_ROCK ? COLOUR_ROCK : NO_ROLE,
		dirt: dirt >= 0 ? dirt : colours && palette.length > COLOUR_DIRT ? COLOUR_DIRT : NO_ROLE,
	}
}

/** Roles kept within a palette of `n` entries; an index past it means none. */
export function validRoles(r: TextureRoles, n: number): TextureRoles {
	const ok = (i: number) => (Number.isInteger(i) && i >= 0 && i < n ? i : NO_ROLE)
	return { rock: ok(r.rock), dirt: ok(r.dirt) }
}

/** The slope in degrees from a height gradient (rise over run along x and z). */
export function slopeDegrees(dhdx: number, dhdz: number): number {
	return (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI
}

function smoothstep(a: number, b: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
	return t * t * (3 - 2 * t)
}

/** How wide, in degrees, the fade into rock and into dirt is on each side of their angles. */
export const ROCK_FADE = 6
export const DIRT_FADE = 5

/**
 * How much rock and dirt a slope of `deg` degrees gets: rock from `rockDeg` on (fading in over
 * ROCK_FADE each side), dirt on the moderate slopes from `dirtDeg` up to where the rock takes over,
 * so a mountain's foot is rimmed with dirt. Written into `out` as [rock, dirt], each 0 to 1.
 */
export function slopeWeights(deg: number, rockDeg: number, dirtDeg: number, out: Float32Array): Float32Array {
	const rock = smoothstep(rockDeg - ROCK_FADE, rockDeg + ROCK_FADE, deg)
	const dirt = smoothstep(dirtDeg - DIRT_FADE, dirtDeg + DIRT_FADE, deg) * (1 - rock)
	out[0] = rock
	out[1] = dirt
	return out
}
