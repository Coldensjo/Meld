// The 1.12 client's DayNight tables: the lighting sun, the visible sun and moon, the stars and the sky
// dome's dawn and dusk warp, ported from Benilla's daynight.rs (MIT/Apache), which cites the client's
// own addresses. Times are game minutes (0 to 1440). Directions are toward the body, in the editor's
// frame (x east, y up, z south: a tile's placement frame), from the client's world frame (x north,
// y west, z up) as (-y, z, -x). Kept free of three.js so it can be tested on its own.

type Table = ReadonlyArray<readonly [number, number]>

/**
 * The client's DayNight::InterpTable: a wrap-around linear interpolation of (day fraction, value)
 * keys at `dp` in [0, 1). Keys are walked in their stored order, so a table stored out of order keeps
 * the client's quirks.
 */
export function interpDayNight(table: Table, dp: number): number {
	const n = table.length
	let a = 0
	while (a < n && dp > table[a][0]) a++
	let b: number
	if (a === n || a === 0) {
		a = a === n ? 0 : a
		b = n - 1
	} else b = a - 1
	let span = table[a][0] - table[b][0]
	if (span < 0) span += 1
	let into = dp - table[b][0]
	if (into < 0) into += 1
	const t = span !== 0 ? into / span : 0
	return table[b][1] + t * (table[a][1] - table[b][1])
}

/** The client's world direction (cosθ·sinφ, sinθ·sinφ, cosφ) of a body at azimuth θ and polar angle φ, into `out` in the editor's frame. */
function bodyDir(theta: number, phi: number, out: number[]): number[] {
	const sp = Math.sin(phi)
	const x = Math.cos(theta) * sp
	const y = Math.sin(theta) * sp
	const z = Math.cos(phi)
	out[0] = -y
	out[1] = z
	out[2] = -x
	return out
}

/** DayNight::SetDirection's polar angle of the lighting sun's travel: it wobbles between 110° and 127°. */
const SUN_PHI: Table = [
	[0, 2.2165682],
	[0.25, 1.9198623],
	[0.5, 2.2165682],
	[0.75, 1.9198623],
]
/** The lighting sun's azimuth, 225° all day. */
const SUN_THETA = 3.926991

/**
 * The lighting sun (DayNight::SetDirection): the direction toward the light that lights the world and
 * casts its shadows. It never sets: it stands 20° to 37° up in the north-west all day, and night comes
 * from the light's colours, not from where it stands.
 */
export function lightingSunDir(minute: number, out: number[]): number[] {
	bodyDir(SUN_THETA, interpDayNight(SUN_PHI, minute / 1440), out)
	// The table gives the light's travel; toward the sun is the other way.
	out[0] = -out[0]
	out[1] = -out[1]
	out[2] = -out[2]
	return out
}

/** The visible sun's polar angle (0xce8d64): 100° (under the horizon) at night, 5° across noon. */
const CELESTIAL_SUN_PHI: Table = [
	[0.2291667, 1.7453293],
	[0.4965278, 0.0872665],
	[0.5, 0.0872665],
	[0.5034722, 0.0872665],
	[0.8958333, 1.7453293],
]

/** The visible sun (body 0 of 0x6d3b80): on the lighting sun's bearing, it rises, stands near the zenith at noon and sets. */
export function celestialSunDir(minute: number, out: number[]): number[] {
	return bodyDir(Math.PI / 4, interpDayNight(CELESTIAL_SUN_PHI, minute / 1440), out)
}

/** The white moon's polar angle (0xce8d24): overhead at midnight, under the horizon from 04:00 to 22:00. */
const MOON_PHI: Table = [
	[0, 0.6108652],
	[0.003472, 0.6108652],
	[0.166667, 1.7453293],
	[0.916667, 1.7453293],
	[0.996528, 0.6108652],
]

/** The white moon, on the sun's bearing. */
export function moonDir(minute: number, out: number[]): number[] {
	return bodyDir(Math.PI / 4, interpDayNight(MOON_PHI, minute / 1440), out)
}

/** The sky dome's dawn and dusk warp strength (0xce9b2c): spikes at about 06:29 and 21:29. */
const SKY_WARP: Table = [
	[0.125, 0],
	[0.2708, 1],
	[0.2917, 0],
	[0.8542, 0],
	[0.8958, 1],
	[0.9993, 0],
]

/** How strongly the dome is warped toward the sun: the curve times LightParams' highlightSky (0 or 1). */
export function skyWarp(minute: number, highlightSky: number): number {
	return interpDayNight(SKY_WARP, minute / 1440) * highlightSky
}

/** The stars' alpha (0xce9a98): in from 22:30 to midnight, out from 03:00 to 04:30. */
const STARS: Table = [
	[0, 1],
	[0.125, 1],
	[0.1875, 0],
	[0.9375, 0],
]

export function starAlpha(minute: number): number {
	return interpDayNight(STARS, minute / 1440)
}

/** The sun disc's size (0xce8cac): twice as big at the horizon (06:00, 21:00), 1 across the day. */
const SUN_SIZE: Table = [
	[0.25, 2],
	[0.28125, 1],
	[0.84375, 1],
	[0.875, 2],
]

export function sunDiscScale(minute: number): number {
	return interpDayNight(SUN_SIZE, minute / 1440)
}

/** The ring elevations (degrees) of the client's sky dome, apex down: LightIntBand rows 2 to 6 sit on them, the fog colour (row 7) at the horizon. */
export const SKY_RINGS = [90, 16.8, 9.8, 3.7, 1.8] as const

/**
 * The clouds' sun-glow envelope (the static track 0xce9ab8, not a Light.dbc band): 1 all day with
 * notches at dawn and dusk. Its last two keys are stored out of order and never reached, as in the client.
 */
const CLOUD_GLOW: Table = [
	[0.16667, 1],
	[0.19444, 0],
	[0.20139, 0],
	[0.22917, 1],
	[0.89583, 1],
	[0.92361, 0],
	[0.88889, 0],
	[0.91667, 1],
]

export function cloudGlowTrack(minute: number): number {
	return interpDayNight(CLOUD_GLOW, minute / 1440)
}

/** Whether the clouds glow toward the sun (04:50 to 22:10) rather than the moon. */
export function cloudGlowIsSun(minute: number): boolean {
	const dp = minute / 1440
	return dp >= 0.2013889 && dp <= 0.9236111
}
