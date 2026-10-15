import type { AnimTrack } from '../wow/api'

// M2 texture animation (B-168, the texture part): a batch's texture transform, resolved by Go for the
// model's loop, moves its texture as the client does (Benilla's tex_anim.rs, MIT/Apache, after the
// client's 0x715f25): uv' = R((uv + T - p) * S) + p about p = (0.5, 0.5), where R is the raw quaternion's
// turn about z, built unnormalised (cos = 1 - 2z², sin = 2zw) as the client builds it. Waterfalls, lava
// and the like scroll this way. Kept free of three.js so it can be tested on its own.

/** A group's texture transform: translation (u, v, w), a raw quaternion and scaling (u, v, w), each optional. */
export interface UVAnimSpec {
  t?: AnimTrack
  r?: AnimTrack
  s?: AnimTrack
}

/** A track's value at `ms` into `out` (`n` components): keys lerped (or held for a stepped track), the time wrapped by its loop. */
export function sampleTrack(tr: AnimTrack, ms: number, n: number, out: number[]) {
  const times = tr.t
  const v = tr.v
  if (times.length === 1 || !tr.loop) {
    for (let k = 0; k < n; k++) out[k] = v[k]
    return
  }
  const t = ms % tr.loop
  let hi = times.length - 1
  for (let i = 0; i < times.length; i++) {
    if (times[i] > t) {
      hi = i
      break
    }
  }
  const lo = Math.max(0, hi - 1)
  const span = times[hi] - times[lo]
  const f = tr.step || span <= 0 ? 0 : Math.min(1, Math.max(0, (t - times[lo]) / span))
  for (let k = 0; k < n; k++) out[k] = v[lo * n + k] + (v[hi * n + k] - v[lo * n + k]) * f
}

const tv = [0, 0, 0]
const qv = [0, 0, 0, 1]
const sv = [1, 1, 1]

/**
 * The transform at `ms` as the first two rows of a 3x3 matrix taking (u, v, 1) to the sampled uv, into
 * `out` as [a, b, c, d, e, f]: u' = a·u + b·v + c, v' = d·u + e·v + f.
 */
export function uvMatrix(spec: UVAnimSpec, ms: number, out: number[]): number[] {
  if (spec.t) sampleTrack(spec.t, ms, 3, tv)
  else tv[0] = tv[1] = 0
  if (spec.r) sampleTrack(spec.r, ms, 4, qv)
  else (qv[2] = 0), (qv[3] = 1)
  if (spec.s) sampleTrack(spec.s, ms, 3, sv)
  else sv[0] = sv[1] = 1
  const c = 1 - 2 * qv[2] * qv[2]
  const s = 2 * qv[2] * qv[3]
  const tx = tv[0] - 0.5
  const ty = tv[1] - 0.5
  out[0] = c * sv[0]
  out[1] = -s * sv[1]
  out[2] = 0.5 + c * sv[0] * tx - s * sv[1] * ty
  out[3] = s * sv[0]
  out[4] = c * sv[1]
  out[5] = 0.5 + s * sv[0] * tx + c * sv[1] * ty
  return out
}
