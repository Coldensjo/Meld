// Terrain › Smooth Selection (#713): Sculpt › Smooth's kernel run over the selected area or the whole
// map, a number of passes at a chosen strength, a slice at a time between frames so the editor stays
// live and the run can be cancelled. The Engine copies the heights out into a patch, runs this, and
// writes the result back as one undo step. Kept free of three.js so it can be tested on its own.
import { nextTurn } from './erodeArea'

/** Terrain › Smooth Selection's settings (editor.smoothArea). */
export interface SmoothAreaSettings {
	/**
	 * How far each pass moves a vertex toward the average of the 3x3 vertices around it, 0 to 1. The
	 * brush moves it `min(1, strength × 10 × seconds)` of the way, so a pass at 1 is a tenth of a second
	 * of the Smooth brush at full strength.
	 */
	strength: number
	/** How many passes; each one reads the heights the last one left. */
	passes: number
	/** Fades the smoothing in from the area's edge over `width` yards, rather than at full strength up to it. */
	falloff: boolean
	/** The falloff's width in yards. */
	width: number
}

/**
 * Fades `weights` (`w` by `h`, 1 where a vertex may change, 0 where not) in from the vertices that may
 * not change: a vertex `band` vertices or more from the nearest fixed one keeps its weight, a nearer one
 * gets a smoothstep of its distance over `band`. Distances are a two-pass chamfer (1 and √2). With no
 * fixed vertex in the patch, nothing changes.
 */
export function fadeFromEdge(weights: Float32Array, w: number, h: number, band: number, dist: Float32Array = new Float32Array(w * h)): void {
	if (band <= 0) return
	const n = w * h
	let any = false
	for (let i = 0; i < n; i++) {
		const fixed = weights[i] === 0
		dist[i] = fixed ? 0 : Infinity
		if (fixed) any = true
	}
	if (!any) return
	const D = Math.SQRT2
	const relax = (i: number, j: number, d: number) => {
		if (dist[j] + d < dist[i]) dist[i] = dist[j] + d
	}
	for (let z = 0; z < h; z++) {
		for (let x = 0; x < w; x++) {
			const i = z * w + x
			if (x > 0) relax(i, i - 1, 1)
			if (z > 0) {
				relax(i, i - w, 1)
				if (x > 0) relax(i, i - w - 1, D)
				if (x < w - 1) relax(i, i - w + 1, D)
			}
		}
	}
	for (let z = h - 1; z >= 0; z--) {
		for (let x = w - 1; x >= 0; x--) {
			const i = z * w + x
			if (x < w - 1) relax(i, i + 1, 1)
			if (z < h - 1) {
				relax(i, i + w, 1)
				if (x < w - 1) relax(i, i + w + 1, D)
				if (x > 0) relax(i, i + w - 1, D)
			}
		}
	}
	for (let i = 0; i < n; i++) {
		if (!weights[i] || dist[i] >= band) continue
		const f = dist[i] / band
		weights[i] *= f * f * (3 - 2 * f)
	}
}

/**
 * One pass of Sculpt › Smooth's kernel over the patch `hs` (`w` by `h`): each vertex moves `k × weight`
 * of the way toward the average of the 3x3 vertices around it in the patch (fewer at its edge), read
 * from the heights before the pass. `rows` (w × h) and `prev` (w × h) are scratch.
 */
export function smoothPass(hs: Float32Array, w: number, h: number, weights: Float32Array, k: number, rows: Float32Array, prev: Float32Array): void {
	prev.set(hs.subarray(0, w * h))
	// The 3-wide average along x, then along z of those: the same as the brush's 3x3 box, edges included.
	for (let z = 0; z < h; z++) {
		const o = z * w
		for (let x = 0; x < w; x++) {
			let sum = prev[o + x]
			let c = 1
			if (x > 0) {
				sum += prev[o + x - 1]
				c++
			}
			if (x < w - 1) {
				sum += prev[o + x + 1]
				c++
			}
			rows[o + x] = sum / c
		}
	}
	for (let z = 0; z < h; z++) {
		const o = z * w
		for (let x = 0; x < w; x++) {
			const i = o + x
			const wt = weights[i]
			if (!wt) continue
			let sum = rows[i]
			let c = 1
			if (z > 0) {
				sum += rows[i - w]
				c++
			}
			if (z < h - 1) {
				sum += rows[i + w]
				c++
			}
			hs[i] += (sum / c - prev[i]) * wt * k
		}
	}
}

/**
 * Smooths the patch `hs` (`w` by `h`) in place: `o.passes` passes at `o.strength`, weighted per vertex
 * by `weights`, about `sliceMs` of work between turns for the editor. Reports the share done (0 to 1)
 * to `progress` and stops, returning false, as soon as `cancelled` says so; returns true when it ran
 * to the end.
 */
export async function smoothPatch(
	hs: Float32Array,
	w: number,
	h: number,
	weights: Float32Array,
	o: SmoothAreaSettings,
	progress: (f: number) => void,
	cancelled: () => boolean,
	sliceMs = 30,
	turn: () => Promise<void> = nextTurn,
): Promise<boolean> {
	const passes = Math.max(0, Math.round(o.passes))
	const k = Math.min(1, Math.max(0, o.strength))
	if (cancelled()) return false
	const rows = new Float32Array(w * h)
	const prev = new Float32Array(w * h)
	let start = performance.now()
	for (let p = 0; p < passes && k > 0; p++) {
		smoothPass(hs, w, h, weights, k, rows, prev)
		if (performance.now() - start >= sliceMs) {
			progress((p + 1) / passes)
			await turn()
			start = performance.now()
			if (cancelled()) return false
		}
	}
	progress(1)
	return true
}
