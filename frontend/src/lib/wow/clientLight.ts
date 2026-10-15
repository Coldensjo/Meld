// The client's lighting at a spot and an hour (B-084), as Noggit Red's Skies work it out
// (`Skies::findSkyWeights`, `Sky::colorFor`): the map's global light gives the base, and each local
// light whose outer radius reaches the camera blends over it, fully inside its inner radius and fading
// to nothing at its outer one, the farthest first. A light's colour or number at an hour is its band
// interpolated between the keys around it (half-minutes, 2880 a day), wrapping at midnight. Kept free of
// three.js so it can be tested on its own.

/** A key of a band: time in half-minutes, value (0xRRGGBB for colours). */
export interface LightKey {
  t: number
  v: number
}

export interface ClientLightParams {
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

/** The colour bands the preview uses, by their index in a params row. */
export const BAND = { diffuse: 0, ambient: 1, skyTop: 2, fog: 7, sun: 9, oceanLight: 14, oceanDark: 15, riverLight: 16, riverDark: 17 } as const
/** The float bands: the fog's distance (in thirty-sixths of a yard) and its multiplier. */
export const FLOAT = { fogDistance: 0, fogMultiplier: 1 } as const

/** The light at a spot: 18 colours as r, g, b (0 to 1, sRGB as the client stores them), the 6 floats and the water alphas. */
export interface LightAt {
  colors: Float32Array
  floats: Float32Array
  waterAlpha: [number, number]
  oceanAlpha: [number, number]
}

export function newLightAt(): LightAt {
  return { colors: new Float32Array(18 * 3), floats: new Float32Array(6), waterAlpha: [0.5, 1], oceanAlpha: [0.75, 1] }
}

const DAY = 2880

/** A band's keys around `t` (half-minutes) and how far between them: [a, b, f]. */
function around(keys: LightKey[], t: number): [LightKey, LightKey, number] | null {
  if (!keys.length) return null
  if (keys.length === 1) return [keys[0], keys[0], 0]
  let i = keys.length - 1
  while (i > 0 && keys[i].t > t) i--
  const a = keys[i]
  if (t < keys[0].t) {
    // Before the first key: between the last one (yesterday) and the first.
    const last = keys[keys.length - 1]
    const span = keys[0].t + DAY - last.t
    return [last, keys[0], span > 0 ? (t + DAY - last.t) / span : 0]
  }
  const b = i + 1 < keys.length ? keys[i + 1] : keys[0]
  const end = i + 1 < keys.length ? b.t : b.t + DAY
  return [a, b, end > a.t ? (t - a.t) / (end - a.t) : 0]
}

/** A colour band's colour at `t`, into out[at..at+2] as 0 to 1. Black for an empty band. */
export function bandColor(keys: LightKey[], t: number, out: Float32Array, at: number) {
  const k = around(keys, t)
  if (!k) {
    out[at] = out[at + 1] = out[at + 2] = 0
    return
  }
  const [a, b, f] = k
  for (let c = 0; c < 3; c++) {
    const s = 16 - c * 8
    out[at + c] = ((((a.v >> s) & 255) * (1 - f) + ((b.v >> s) & 255) * f) / 255)
  }
}

/** A float band's number at `t`; 0 for an empty band. */
export function bandFloat(keys: LightKey[], t: number): number {
  const k = around(keys, t)
  if (!k) return 0
  return k[0].v * (1 - k[2]) + k[1].v * k[2]
}

const scratch = newLightAt()
/** The local lights reaching the spot and their distances, reused call to call (lightAt runs every frame). */
const nearLights: ClientLight[] = []
const nearDist: number[] = []

/** One light's own values at `t` into `out`. Returns false when it has no clear-weather params. */
function lightValues(set: ClientLights, l: ClientLight, t: number, out: LightAt): boolean {
  const p = set.params[l.params[0]]
  if (!p) return false
  for (let i = 0; i < 18; i++) bandColor(p.colors[i] ?? [], t, out.colors, i * 3)
  for (let i = 0; i < 6; i++) out.floats[i] = bandFloat(p.floats[i] ?? [], t)
  out.waterAlpha[0] = p.waterAlpha[0]
  out.waterAlpha[1] = p.waterAlpha[1]
  out.oceanAlpha[0] = p.oceanAlpha[0]
  out.oceanAlpha[1] = p.oceanAlpha[1]
  return true
}

/** How much a local light counts at distance `d`: 1 inside its inner radius, fading to 0 at its outer. */
export function lightWeight(l: ClientLight, d: number): number {
  if (d > l.outer) return 0
  if (d <= l.inner) return 1
  return l.outer > l.inner ? (l.outer - d) / (l.outer - l.inner) : 1
}

/**
 * The light at (x, y, z) (yards, in the tiles' placement frame) and `hour`, into `out`: the global light,
 * with every local light that reaches the spot blended over it, the farthest first. Returns false when
 * the map has no global light to start from.
 */
export function lightAt(set: ClientLights, x: number, y: number, z: number, hour: number, out: LightAt): boolean {
  const t = ((((hour % 24) + 24) % 24) * DAY) / 24
  let global: ClientLight | null = null
  for (const l of set.lights) if (l.global) global = l
  if (!global || !lightValues(set, global, t, out)) return false
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
    if (w <= 0 || !lightValues(set, l, t, scratch)) continue
    for (let i = 0; i < out.colors.length; i++) out.colors[i] += (scratch.colors[i] - out.colors[i]) * w
    for (let i = 0; i < 6; i++) out.floats[i] += (scratch.floats[i] - out.floats[i]) * w
    for (let i = 0; i < 2; i++) {
      out.waterAlpha[i] += (scratch.waterAlpha[i] - out.waterAlpha[i]) * w
      out.oceanAlpha[i] += (scratch.oceanAlpha[i] - out.oceanAlpha[i]) * w
    }
  }
  return true
}
