import { MAX_PALETTE, NO_TEXTURE, SLOTS, paletteIndex } from './chunkPaint'

// Restore the Client's Paint (#645): puts chunks' paint back to the client's own, read from its tiles
// without Meld's patch (LoadBaseRegionPaint, then tilePaint), so the next compile finds them unpainted
// and writes the client's full-resolution alpha (adt.KeepClientAlpha, #526). Compiles before #526 left
// the patch's chunks at half the alpha resolution, and a region read from the patch kept them so.

/** A block's paint in the editor's form: the palette, SLOTS weights a texel and SLOTS slots a chunk. */
export interface PaintArrays {
	weights: Uint8Array
	chunkSlots: Uint8Array
}

/** What restoring some chunks takes: the palette with any texture it lacked added, and the chunks that differ. */
export interface RestorePlan {
	palette: string[]
	/** The base palette's index to the map palette's, for the indices the chunks use; -1 where unused. */
	remap: Int16Array
	/** The chunks whose paint is not the client's yet. */
	changed: number[]
}

/**
 * Plans restoring `chunks` of `target` (paint chunks `side` a side, splat texels `res` a side) to
 * `base`, which tilePaint read with `basePalette`, as the same grid. Returns the textures the palette
 * has no room for instead, when restoring needs more than MAX_PALETTE.
 */
export function planRestore(target: PaintArrays, palette: readonly string[], base: PaintArrays, basePalette: readonly string[], chunks: readonly number[], side: number, res: number): RestorePlan | { full: string[] } {
	const remap = new Int16Array(basePalette.length).fill(-1)
	const next = [...palette]
	const full: string[] = []
	for (const c of chunks) {
		for (let k = 0; k < SLOTS; k++) {
			const b = base.chunkSlots[c * SLOTS + k]
			if (b === NO_TEXTURE || remap[b] >= 0) continue
			const path = basePalette[b]
			let i = paletteIndex(next, path)
			if (i < 0) {
				if (next.length >= MAX_PALETTE) {
					if (!full.includes(path)) full.push(path)
					continue
				}
				next.push(path)
				i = next.length - 1
			}
			remap[b] = i
		}
	}
	if (full.length) return { full }
	const changed = chunks.filter((c) => !sameChunk(target, base, remap, c, side, res))
	return { palette: next, remap, changed }
}

/** Whether chunk c of target already has base's paint, slots remapped. */
function sameChunk(target: PaintArrays, base: PaintArrays, remap: Int16Array, c: number, side: number, res: number): boolean {
	for (let k = 0; k < SLOTS; k++) {
		const b = base.chunkSlots[c * SLOTS + k]
		if (target.chunkSlots[c * SLOTS + k] !== (b === NO_TEXTURE ? NO_TEXTURE : remap[b])) return false
	}
	const per = res / side
	const x0 = (c % side) * per
	const z0 = Math.floor(c / side) * per
	for (let z = z0; z < z0 + per; z++) {
		const from = (z * res + x0) * SLOTS
		const to = from + per * SLOTS
		for (let i = from; i < to; i++) if (target.weights[i] !== base.weights[i]) return false
	}
	return true
}

/** Writes base's paint of chunk c into target, its slots remapped (planRestore's remap). */
export function restoreChunk(target: PaintArrays, base: PaintArrays, remap: Int16Array, c: number, side: number, res: number) {
	for (let k = 0; k < SLOTS; k++) {
		const b = base.chunkSlots[c * SLOTS + k]
		target.chunkSlots[c * SLOTS + k] = b === NO_TEXTURE ? NO_TEXTURE : remap[b]
	}
	const per = res / side
	const x0 = (c % side) * per
	const z0 = Math.floor(c / side) * per
	for (let z = z0; z < z0 + per; z++) {
		const from = (z * res + x0) * SLOTS
		target.weights.set(base.weights.subarray(from, from + per * SLOTS), from)
	}
}
