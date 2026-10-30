// Paint › Mask › Select by (#183): the magic wand and the mask's Grow, Shrink, Feather, Border and Smooth (#769), as
// Photoshop's Select menu does them, over the paint mask (a byte per splat texel, a row of `res` texels).
// Kept free of three.js so it can be tested on its own.

/** How a click in Paint › Mask sets the mask: the brush, or the wand by texture, height, slope or water. */
export type MaskPick = 'brush' | 'texture' | 'height' | 'slope' | 'water'

/** How the wand's texels meet the mask already there: Shift adds, Alt subtracts, a plain click replaces. */
export type MaskOp = 'replace' | 'add' | 'subtract'

/** Mask › Modify: how a whole-mask change reshapes it, by the options bar's step. */
export type MaskHow = 'grow' | 'shrink' | 'feather' | 'border' | 'smooth'

/**
 * Writes 255 into `out` for the texels the wand takes and 0 elsewhere: every texel that is `inside`, or
 * with `contiguous`, only those reached from `seed` through inside texels (4-connected). Returns how
 * many it took. `inside` is asked once a texel at most.
 */
export function wandSelect(res: number, inside: (p: number) => boolean, seed: number, contiguous: boolean, out: Uint8Array): number {
	out.fill(0)
	const n = res * res
	let count = 0
	if (!contiguous) {
		for (let p = 0; p < n; p++) {
			if (!inside(p)) continue
			out[p] = 255
			count++
		}
		return count
	}
	if (seed < 0 || seed >= n || !inside(seed)) return 0
	// Visited texels are marked 1 (outside) or 255 (taken), so none is asked twice.
	const stack = new Int32Array(n)
	let top = 0
	out[seed] = 255
	count = 1
	stack[top++] = seed
	while (top > 0) {
		const p = stack[--top]
		const x = p % res
		for (let k = 0; k < 4; k++) {
			let q: number
			if (k === 0) {
				if (x === 0) continue
				q = p - 1
			} else if (k === 1) {
				if (x === res - 1) continue
				q = p + 1
			} else if (k === 2) {
				if (p < res) continue
				q = p - res
			} else {
				q = p + res
				if (q >= n) continue
			}
			if (out[q]) continue
			if (inside(q)) {
				out[q] = 255
				count++
				stack[top++] = q
			} else out[q] = 1
		}
	}
	for (let p = 0; p < n; p++) if (out[p] === 1) out[p] = 0
	return count
}

/** Puts `sel` (0 to 255 a texel) into `mask` by `op`. */
export function combineMask(mask: Uint8Array, sel: Uint8Array, op: MaskOp) {
	if (op === 'replace') mask.set(sel)
	else if (op === 'add') {
		for (let i = 0; i < mask.length; i++) if (sel[i] > mask[i]) mask[i] = sel[i]
	} else {
		for (let i = 0; i < mask.length; i++) {
			const v = 255 - sel[i]
			if (v < mask[i]) mask[i] = v
		}
	}
}

/** Chamfer steps (3 straight, 4 diagonal), so a distance of d texels is about 3d. */
const STRAIGHT = 3
const DIAGONAL = 4
const FAR = 0xffff

/**
 * The chamfer distance of every texel to the nearest texel where `from` holds, in thirds of a texel,
 * capped at 65535, written into `dist`.
 */
function chamfer(res: number, from: (p: number) => boolean, dist: Uint16Array) {
	const n = res * res
	for (let p = 0; p < n; p++) dist[p] = from(p) ? 0 : FAR
	const relax = (p: number, q: number, step: number) => {
		const d = dist[q] + step
		if (d < dist[p]) dist[p] = d > FAR ? FAR : d
	}
	for (let z = 0; z < res; z++) {
		for (let x = 0; x < res; x++) {
			const p = z * res + x
			if (x > 0) relax(p, p - 1, STRAIGHT)
			if (z > 0) {
				relax(p, p - res, STRAIGHT)
				if (x > 0) relax(p, p - res - 1, DIAGONAL)
				if (x < res - 1) relax(p, p - res + 1, DIAGONAL)
			}
		}
	}
	for (let z = res - 1; z >= 0; z--) {
		for (let x = res - 1; x >= 0; x--) {
			const p = z * res + x
			if (x < res - 1) relax(p, p + 1, STRAIGHT)
			if (z < res - 1) {
				relax(p, p + res, STRAIGHT)
				if (x < res - 1) relax(p, p + res + 1, DIAGONAL)
				if (x > 0) relax(p, p + res - 1, DIAGONAL)
			}
		}
	}
}

/** Widens the mask by `texels`: every texel that close to one at least half in the mask becomes full. */
export function growMask(mask: Uint8Array, res: number, texels: number) {
	if (texels <= 0) return
	const dist = new Uint16Array(res * res)
	chamfer(res, (p) => mask[p] >= 128, dist)
	const reach = Math.round(texels * STRAIGHT)
	for (let p = 0; p < mask.length; p++) if (dist[p] <= reach) mask[p] = 255
}

/** Narrows the mask by `texels`: every texel that close to one less than half in the mask is cleared. */
export function shrinkMask(mask: Uint8Array, res: number, texels: number) {
	if (texels <= 0) return
	const dist = new Uint16Array(res * res)
	chamfer(res, (p) => mask[p] < 128, dist)
	const reach = Math.round(texels * STRAIGHT)
	for (let p = 0; p < mask.length; p++) if (dist[p] <= reach) mask[p] = 0
}

/**
 * Keeps only a band along the mask's edge, `texels` wide on each side of it (Grow minus Shrink): the
 * texels that close to the other side of the half-full line become full, the rest are cleared. A mask
 * with no edge (empty, or full to the map's edge) comes out empty.
 */
export function borderMask(mask: Uint8Array, res: number, texels: number) {
	if (texels <= 0) return
	const n = res * res
	const toIn = new Uint16Array(n)
	const toOut = new Uint16Array(n)
	chamfer(res, (p) => mask[p] >= 128, toIn)
	chamfer(res, (p) => mask[p] < 128, toOut)
	const reach = Math.round(texels * STRAIGHT)
	for (let p = 0; p < n; p++) {
		const d = mask[p] >= 128 ? toOut[p] : toIn[p]
		mask[p] = d <= reach ? 255 : 0
	}
}

/**
 * Rounds off the mask's outline over about `texels`: Feather, then each texel full where the blur is at
 * least half and empty elsewhere, so corners round, specks and spikes narrower than that vanish and
 * notches fill. The result is a hard mask.
 */
export function smoothMask(mask: Uint8Array, res: number, texels: number) {
	if (texels <= 0) return
	featherMask(mask, res, texels)
	for (let p = 0; p < mask.length; p++) mask[p] = mask[p] >= 128 ? 255 : 0
}

/**
 * Softens the mask's edge over about `texels` on each side: three box blurs along x and then along z,
 * which come close to a Gaussian of `texels / 2` texels' deviation. The map's edge repeats its texels.
 */
export function featherMask(mask: Uint8Array, res: number, texels: number) {
	const b = Math.max(1, Math.round(texels / 2))
	if (texels <= 0) return
	const line = new Float32Array(res)
	const outLine = new Float32Array(res)
	const blurLine = () => {
		const w = 2 * b + 1
		let sum = 0
		for (let d = -b; d <= b; d++) sum += line[Math.min(res - 1, Math.max(0, d))]
		for (let i = 0; i < res; i++) {
			outLine[i] = sum / w
			sum += line[Math.min(res - 1, i + b + 1)] - line[Math.max(0, i - b)]
		}
		line.set(outLine)
	}
	for (let z = 0; z < res; z++) {
		const row = z * res
		for (let x = 0; x < res; x++) line[x] = mask[row + x]
		for (let k = 0; k < 3; k++) blurLine()
		for (let x = 0; x < res; x++) mask[row + x] = Math.round(line[x])
	}
	for (let x = 0; x < res; x++) {
		for (let z = 0; z < res; z++) line[z] = mask[z * res + x]
		for (let k = 0; k < 3; k++) blurLine()
		for (let z = 0; z < res; z++) mask[z * res + x] = Math.round(line[z])
	}
}
