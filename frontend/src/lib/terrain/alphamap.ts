// A texture's alphamap as an image (Noggit Red's alphamap export and import, gap §9): the weight one
// palette texture has at every splat texel of the map, 0 to 1, read out to a greyscale image or laid in
// from one. Kept free of three.js so it can be tested on its own.
import { NO_TEXTURE, SLOTS, acquireSlotCompacting, findSlot, normalizeTexel } from './chunkPaint'

/** The paint the alphamap reads and writes: chunk slots and four weights per texel. */
export interface SplatPaint {
	paintChunksPerSide: number
	splatRes: number
	chunkSlots: Uint8Array
	weights: Uint8Array
}

/** Texture `tex`'s weight at every texel (res*res, row-major), 0 to 1; 0 in chunks without it. */
export function textureWeights(t: SplatPaint, tex: number): Float32Array {
	const side = t.paintChunksPerSide
	const res = t.splatRes
	const per = res / side
	const out = new Float32Array(res * res)
	for (let c = 0; c < side * side; c++) {
		const k = findSlot(t.chunkSlots, c, tex)
		if (k < 0) continue
		const x0 = (c % side) * per
		const z0 = Math.floor(c / side) * per
		for (let z = z0; z < z0 + per; z++) {
			for (let x = x0; x < x0 + per; x++) out[z * res + x] = t.weights[(z * res + x) * SLOTS + k] / 255
		}
	}
	return out
}

/**
 * Lays `values` (res*res, 0 to 1) into chunk c as texture `tex`'s weight: each texel takes that much of
 * the texture, and its other textures share the rest as they shared it before (a texel with nothing else
 * keeps all of it on `tex`). A chunk that lacks the texture takes it into a free slot where it is
 * wanted; a full one refuses. Returns whether the chunk was refused.
 */
export function layAlphamapChunk(t: SplatPaint, c: number, tex: number, values: Float32Array): boolean {
	const side = t.paintChunksPerSide
	const res = t.splatRes
	const per = res / side
	const x0 = (c % side) * per
	const z0 = Math.floor(c / side) * per
	let k = findSlot(t.chunkSlots, c, tex)
	if (k < 0) {
		let wanted = false
		for (let z = z0; z < z0 + per && !wanted; z++) for (let x = x0; x < x0 + per; x++) if (values[z * res + x] > 0.002) wanted = true
		if (!wanted) return false
		k = acquireSlotCompacting(side, res, t.chunkSlots, t.weights, c, tex)
		if (k < 0) return true
	}
	const w = t.weights
	for (let z = z0; z < z0 + per; z++) {
		for (let x = x0; x < x0 + per; x++) {
			const base = (z * res + x) * SLOTS
			const want = Math.round(Math.min(1, Math.max(0, values[z * res + x])) * 255)
			let others = 0
			for (let j = 0; j < SLOTS; j++) if (j !== k && t.chunkSlots[c * SLOTS + j] !== NO_TEXTURE) others += w[base + j]
			if (others === 0) {
				// Nothing else to give the rest to: the texel stays all this texture.
				for (let j = 0; j < SLOTS; j++) w[base + j] = j === k ? 255 : 0
				continue
			}
			const rest = 255 - want
			for (let j = 0; j < SLOTS; j++) {
				if (j === k) w[base + j] = want
				else w[base + j] = Math.round((w[base + j] * rest) / others)
			}
			normalizeTexel(w, base)
		}
	}
	return false
}
