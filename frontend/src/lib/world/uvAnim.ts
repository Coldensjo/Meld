import type { AnimTrack } from '../wow/api'

// M2 texture animation (B-168, the texture part): a batch's texture transform, resolved by Go for the
// model's loop, moves its texture as the client does (Benilla's tex_anim.rs, MIT/Apache, after the
// client's 0x715f25): uv' = R((uv + T - p) * S) + p about p = (0.5, 0.5), where R is the raw quaternion's
// turn about z, built unnormalised (cos = 1 - 2z², sin = 2zw) as the client builds it. Waterfalls, lava
// and the like scroll this way. A batch's colour and transparency (B-181) tint and fade it the same way,
// on the same clock. Kept free of three.js so it can be tested on its own.

/**
 * A group's colour (B-181, Benilla's mat_anim.rs): an RGB tint multiplied into it (client colour space)
 * and an alpha and transparency weight whose product is its opacity; at 0 or less the client skips it.
 */
export interface ColorAnimSpec {
	rgb?: AnimTrack
	a?: AnimTrack
	w?: AnimTrack
}

/** Whether every track of a colour holds one value, so it is set once rather than every frame. */
export function colorIsStatic(spec: ColorAnimSpec): boolean {
	return [spec.rgb, spec.a, spec.w].every((t) => !t || t.t.length < 2 || !t.loop)
}

/** Whether the colour can ever be see-through (an alpha or weight below 1), so its material blends. */
export function colorFades(spec: ColorAnimSpec): boolean {
	return [spec.a, spec.w].some((t) => !!t && t.v.some((v) => v < 1))
}

const cv = [1, 1, 1]
const av = [1]

/** The colour at `ms` into `out` as [r, g, b, opacity]. */
export function colorAt(spec: ColorAnimSpec, ms: number, out: number[]): number[] {
	if (spec.rgb) sampleTrack(spec.rgb, ms, 3, cv)
	else cv[0] = cv[1] = cv[2] = 1
	let o = 1
	if (spec.a) {
		sampleTrack(spec.a, ms, 1, av)
		o *= av[0]
	}
	if (spec.w) {
		sampleTrack(spec.w, ms, 1, av)
		o *= av[0]
	}
	out[0] = cv[0]
	out[1] = cv[1]
	out[2] = cv[2]
	out[3] = o
	return out
}

/** A group's texture transform: translation (u, v, w), a raw quaternion and scaling (u, v, w), each optional. */
export interface UVAnimSpec {
	t?: AnimTrack
	r?: AnimTrack
	s?: AnimTrack
}

/**
 * A track's value at `ms` into `out` (`n` components): keys lerped (or held for a stepped track), the
 * time wrapped by its loop. Past the last key, the last key holds.
 */
export function sampleTrack(tr: AnimTrack, ms: number, n: number, out: number[]) {
	const times = tr.t
	const v = tr.v
	if (times.length === 1 || !tr.loop) {
		for (let k = 0; k < n; k++) out[k] = v[k]
		return
	}
	const t = ms % tr.loop
	// The first key later than t, by binary search (#328); none means t is at or past the last key.
	let low = 0
	let hi = times.length
	while (low < hi) {
		const mid = (low + hi) >> 1
		if (times[mid] > t) hi = mid
		else low = mid + 1
	}
	if (hi === times.length) {
		for (let k = 0; k < n; k++) out[k] = v[(hi - 1) * n + k]
		return
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
	else ((qv[2] = 0), (qv[3] = 1))
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
