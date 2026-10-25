// The client's lighting at a spot and an hour (B-084), as Noggit Red's Skies work it out
// (`Skies::findSkyWeights`, `Sky::colorFor`): the map's global light gives the base, and each local
// light whose outer radius reaches the camera blends over it, fully inside its inner radius and fading
// to nothing at its outer one, the farthest first. A light's colour or number at an hour is its band
// interpolated between the keys around it (half-minutes, 2880 a day), walked as the client walks them
// (Benilla's light/tables.rs, MIT/Apache). Kept free of three.js so it can be tested on its own.

/** A key of a band: time in half-minutes, value (0xRRGGBB for colours). */
export interface LightKey {
	t: number
	v: number
}

export interface ClientLightParams {
	/** LightParams' highlightSky: the sky dome is warped toward the sun at dawn and dusk. */
	highlightSky?: boolean
	waterAlpha: number[]
	oceanAlpha: number[]
	colors: LightKey[][]
	floats: LightKey[][]
}

export interface ClientLight {
	x: number
	y: number
	z: number
	inner: number
	outer: number
	global: boolean
	params: number[]
}

export interface ClientLights {
	lights: ClientLight[]
	params: Record<number, ClientLightParams>
}

/** The colour bands the preview uses, by their index in a params row: the sky runs from skyTop (2) to the horizon (6). */
export const BAND = { diffuse: 0, ambient: 1, skyTop: 2, fog: 7, sun: 9, oceanLight: 14, oceanDark: 15, riverLight: 16, riverDark: 17 } as const
/** The float bands: the fog's end (in thirty-sixths of a yard) and its start as a share of the end. */
export const FLOAT = { fogDistance: 0, fogMultiplier: 1 } as const

/** The light at a spot: 18 colours as r, g, b (0 to 1, sRGB as the client stores them), the 6 floats, the water alphas and the dome's warp (0 or 1, blended). */
export interface LightAt {
	colors: Float32Array
	floats: Float32Array
	waterAlpha: [number, number]
	oceanAlpha: [number, number]
	highlightSky: number
}

export function newLightAt(): LightAt {
	return { colors: new Float32Array(18 * 3), floats: new Float32Array(6), waterAlpha: [0.5, 1], oceanAlpha: [0.75, 1], highlightSky: 0 }
}

/** Light.dbc and the fog band keep distances in thirty-sixths of a yard. */
const POS_SCALE = 36

/**
 * The scene's fog from a light (the client's 0x6cee30): it ends at the light's fog end or the far
 * clip, whichever is nearer, and starts at the light's share of that end, unclamped, so a storm's
 * negative share puts fog at the eye. Into `out` as [start, end] in yards.
 */
export function sceneFog(l: LightAt, farClip: number, out: number[]): number[] {
	const end = Math.min(l.floats[FLOAT.fogDistance] / POS_SCALE, farClip)
	out[0] = l.floats[FLOAT.fogMultiplier] * end
	out[1] = end
	return out
}

const DAY = 2880

const around: [LightKey, LightKey, number] = [{ t: 0, v: 0 }, { t: 0, v: 0 }, 0]

/**
 * A band's keys around `t` (half-minutes) and how far between them: [a, b, f], reused call to call.
 * The client (0x6d63e0) walks the keys as a cycle in their stored order, which isn't always time order:
 * the first pair that brackets `t` wins, and a pair that doesn't ascend wraps through midnight.
 */
function segment(keys: LightKey[], t: number): [LightKey, LightKey, number] | null {
	const n = keys.length
	if (!n) return null
	around[2] = 0
	if (n === 1) {
		around[0] = around[1] = keys[0]
		return around
	}
	for (let i = 0; i < n; i++) {
		const a = keys[i]
		const b = keys[(i + 1) % n]
		let bt = b.t
		let tt = t
		if (bt > a.t) {
			if (t < a.t || t > bt) continue
		} else {
			if (!(t >= a.t || t <= bt)) continue
			bt += DAY
			if (t < a.t) tt += DAY
		}
		around[0] = a
		around[1] = b
		around[2] = (tt - a.t) / (bt - a.t)
		return around
	}
	around[0] = around[1] = keys[n - 1]
	return around
}

/** A colour band's colour at `t`, into out[at..at+2] as 0 to 1. Black for an empty band. */
export function bandColor(keys: LightKey[], t: number, out: Float32Array, at: number) {
	const k = segment(keys, t)
	if (!k) {
		out[at] = out[at + 1] = out[at + 2] = 0
		return
	}
	const [a, b, f] = k
	for (let c = 0; c < 3; c++) {
		const s = 16 - c * 8
		out[at + c] = (((a.v >> s) & 255) * (1 - f) + ((b.v >> s) & 255) * f) / 255
	}
}

/** A float band's number at `t`; 0 for an empty band. */
export function bandFloat(keys: LightKey[], t: number): number {
	const k = segment(keys, t)
	if (!k) return 0
	return k[0].v * (1 - k[2]) + k[1].v * k[2]
}

const scratch = newLightAt()
/** The local lights reaching the spot and their distances, reused call to call (lightAt runs every frame). */
const nearLights: ClientLight[] = []
const nearDist: number[] = []

/** Light.dbc's params slots: clear weather, and the storm the client blends over it in rain, snow and sandstorms. */
export const SLOT = { clear: 0, storm: 2 } as const

/**
 * One light's own values at `t` into `out`, from its params in `slot` (a light without storm params
 * keeps its clear ones). Returns false when it has no clear-weather params either.
 */
function lightValues(set: ClientLights, l: ClientLight, t: number, out: LightAt, slot: number): boolean {
	const p = set.params[l.params[slot]] ?? set.params[l.params[0]]
	if (!p) return false
	for (let i = 0; i < 18; i++) bandColor(p.colors[i] ?? [], t, out.colors, i * 3)
	for (let i = 0; i < 6; i++) out.floats[i] = bandFloat(p.floats[i] ?? [], t)
	out.waterAlpha[0] = p.waterAlpha[0]
	out.waterAlpha[1] = p.waterAlpha[1]
	out.oceanAlpha[0] = p.oceanAlpha[0]
	out.oceanAlpha[1] = p.oceanAlpha[1]
	out.highlightSky = p.highlightSky ? 1 : 0
	return true
}

/** How much a local light counts at distance `d`: 1 inside its inner radius, fading to 0 at its outer. */
export function lightWeight(l: ClientLight, d: number): number {
	if (d > l.outer) return 0
	if (d <= l.inner) return 1
	return l.outer > l.inner ? (l.outer - d) / (l.outer - l.inner) : 1
}

const stormOut = newLightAt()

/**
 * The light at (x, y, z) (yards, in the tiles' placement frame) and `hour`, into `out`: the global light,
 * with every local light that reaches the spot blended over it, the farthest first. `storm` (0 to 1) is
 * how far the storm params are blended over the clear ones, as the client does in bad weather (its
 * storm blend, Benilla's `weather::storm_blend`: full from a quarter of the weather's grade up).
 * Returns false when the map has no global light to start from.
 */
export function lightAt(set: ClientLights, x: number, y: number, z: number, hour: number, out: LightAt, storm = 0): boolean {
	const t = ((((hour % 24) + 24) % 24) * DAY) / 24
	if (!blendAt(set, x, y, z, t, out, SLOT.clear)) return false
	if (storm <= 0 || !blendAt(set, x, y, z, t, stormOut, SLOT.storm)) return true
	const w = Math.min(1, storm)
	for (let i = 0; i < out.colors.length; i++) out.colors[i] += (stormOut.colors[i] - out.colors[i]) * w
	for (let i = 0; i < 6; i++) out.floats[i] += (stormOut.floats[i] - out.floats[i]) * w
	for (let i = 0; i < 2; i++) {
		out.waterAlpha[i] += (stormOut.waterAlpha[i] - out.waterAlpha[i]) * w
		out.oceanAlpha[i] += (stormOut.oceanAlpha[i] - out.oceanAlpha[i]) * w
	}
	out.highlightSky += (stormOut.highlightSky - out.highlightSky) * w
	return true
}

/** lightAt for one params slot at `t` (half-minutes). */
function blendAt(set: ClientLights, x: number, y: number, z: number, t: number, out: LightAt, slot: number): boolean {
	let global: ClientLight | null = null
	for (const l of set.lights) if (l.global) global = l
	if (!global || !lightValues(set, global, t, out, slot)) return false
	// The local lights that reach the spot, kept sorted farthest first as they are found.
	let n = 0
	for (const l of set.lights) {
		if (l.global) continue
		const d = Math.hypot(l.x - x, l.y - y, l.z - z)
		if (d > l.outer) continue
		let i = n++
		while (i > 0 && nearDist[i - 1] < d) {
			nearLights[i] = nearLights[i - 1]
			nearDist[i] = nearDist[i - 1]
			i--
		}
		nearLights[i] = l
		nearDist[i] = d
	}
	for (let k = 0; k < n; k++) {
		const l = nearLights[k]
		const w = lightWeight(l, nearDist[k])
		if (w <= 0 || !lightValues(set, l, t, scratch, slot)) continue
		for (let i = 0; i < out.colors.length; i++) out.colors[i] += (scratch.colors[i] - out.colors[i]) * w
		for (let i = 0; i < 6; i++) out.floats[i] += (scratch.floats[i] - out.floats[i]) * w
		for (let i = 0; i < 2; i++) {
			out.waterAlpha[i] += (scratch.waterAlpha[i] - out.waterAlpha[i]) * w
			out.oceanAlpha[i] += (scratch.oceanAlpha[i] - out.oceanAlpha[i]) * w
		}
		out.highlightSky += (scratch.highlightSky - out.highlightSky) * w
	}
	return true
}
