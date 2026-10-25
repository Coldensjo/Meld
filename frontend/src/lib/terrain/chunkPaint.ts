// Texture painting in the 1.12 style: the map is split into chunks of CHUNK_CELLS cells (the
// server's MCNK chunks), and each chunk uses at most SLOTS textures. Every texel of a chunk
// blends the same textures, so a finished map exports as game chunks with no conversion.
//
// This module is plain data handling with no rendering dependency, so the rules can be tested
// on their own (see chunkPaint.test.ts).

/** A chunk is 8x8 cells, and holds up to four texture layers (SLOTS), as in the 1.12 terrain format. */
import { CHUNK_CELLS, SLOTS } from '../wow/format'
export { CHUNK_CELLS, SLOTS }
/** Palette index meaning "no texture in this slot". */
export const NO_TEXTURE = 255
/** Palette entries a map can hold (indices 0 to 254). */
export const MAX_PALETTE = 255
/** Splat texels per cell along each side. */
export const SPLAT_PER_CELL = 4

/** Chunks along one side of a map. The map's size must be a multiple of CHUNK_CELLS. */
export function chunksPerSide(size: number): number {
	return size / CHUNK_CELLS
}

/** Index of the chunk holding the cell (or texel, once scaled) at (x, z). */
export function chunkOf(x: number, z: number, side: number): number {
	return z * side + x
}

/** The slot of chunk c that holds palette index tex, or -1. */
export function findSlot(slots: Uint8Array, c: number, tex: number): number {
	for (let k = 0; k < SLOTS; k++) if (slots[c * SLOTS + k] === tex) return k
	return -1
}

/**
 * The slot of chunk c that tex should paint into: its own slot if the chunk has it, else a free
 * one. Returns -1 when the chunk already has SLOTS other textures.
 */
export function acquireSlot(slots: Uint8Array, c: number, tex: number): number {
	const have = findSlot(slots, c, tex)
	if (have >= 0) return have
	for (let k = 0; k < SLOTS; k++) {
		if (slots[c * SLOTS + k] === NO_TEXTURE) {
			slots[c * SLOTS + k] = tex
			return k
		}
	}
	return -1
}

/**
 * Like acquireSlot, but when the chunk is full it first frees the slots that a stroke has emptied, so a
 * texture painted away earlier in the same stroke makes room at once. Returns -1 only when the chunk
 * really holds SLOTS textures in use.
 */
export function acquireSlotCompacting(side: number, res: number, slots: Uint8Array, weights: Uint8Array, c: number, tex: number): number {
	const k = acquireSlot(slots, c, tex)
	if (k >= 0) return k
	if (!compactChunk(side, res, slots, weights, c)) return -1
	return acquireSlot(slots, c, tex)
}

/**
 * Frees the slot of chunk c whose texture covers the least of it, other than the texture `keep`. Each
 * texel's weight in it moves to the texel's strongest other texture, so every texel still sums to 255.
 * Returns the freed slot, or -1 if the chunk has nothing else to give up.
 */
export function evictWeakest(side: number, res: number, slots: Uint8Array, weights: Uint8Array, c: number, keep: number): number {
	const per = res / side
	const x0 = (c % side) * per
	const z0 = Math.floor(c / side) * per
	const sums = new Array<number>(SLOTS).fill(0)
	for (let z = z0; z < z0 + per; z++) {
		for (let x = x0; x < x0 + per; x++) {
			const base = (z * res + x) * SLOTS
			for (let k = 0; k < SLOTS; k++) sums[k] += weights[base + k]
		}
	}
	let weak = -1
	for (let k = 0; k < SLOTS; k++) {
		const tex = slots[c * SLOTS + k]
		if (tex === NO_TEXTURE || tex === keep) continue
		if (weak < 0 || sums[k] < sums[weak]) weak = k
	}
	if (weak < 0) return -1
	// Where a texel has nothing else, the weight goes to the chunk's biggest remaining texture.
	let fallback = -1
	for (let k = 0; k < SLOTS; k++) {
		if (k === weak || slots[c * SLOTS + k] === NO_TEXTURE) continue
		if (fallback < 0 || sums[k] > sums[fallback]) fallback = k
	}
	if (fallback < 0) return -1
	for (let z = z0; z < z0 + per; z++) {
		for (let x = x0; x < x0 + per; x++) {
			const base = (z * res + x) * SLOTS
			const w = weights[base + weak]
			if (w === 0) continue
			let to = -1
			for (let k = 0; k < SLOTS; k++) {
				if (k === weak || slots[c * SLOTS + k] === NO_TEXTURE || weights[base + k] === 0) continue
				if (to < 0 || weights[base + k] > weights[base + to]) to = k
			}
			if (to < 0) to = fallback
			weights[base + to] += w
			weights[base + weak] = 0
		}
	}
	slots[c * SLOTS + weak] = NO_TEXTURE
	return weak
}

/**
 * Like acquireSlotCompacting, but a chunk that really holds SLOTS textures gives up its weakest one
 * (never `keep`, which defaults to `tex`), so painting over a full chunk replaces instead of refusing.
 */
export function acquireSlotReplacing(side: number, res: number, slots: Uint8Array, weights: Uint8Array, c: number, tex: number, keep = tex): number {
	const k = acquireSlotCompacting(side, res, slots, weights, c, tex)
	if (k >= 0) return k
	const freed = evictWeakest(side, res, slots, weights, c, keep)
	if (freed < 0) return -1
	slots[c * SLOTS + freed] = tex
	return freed
}

/**
 * Frees the slots of chunk c that no texel in it uses (weight 0 everywhere), and moves the used ones
 * down to the lowest slots, so slot 0 stays the base. Every texel keeps its blend; only the order of
 * its weights changes. Returns true when the chunk's slots or weights changed. res and side are as in
 * packRoles.
 */
export function compactChunk(side: number, res: number, slots: Uint8Array, weights: Uint8Array, c: number): boolean {
	const per = res / side
	const x0 = (c % side) * per
	const z0 = Math.floor(c / side) * per
	const keep: number[] = []
	for (let k = 0; k < SLOTS; k++) {
		if (slots[c * SLOTS + k] === NO_TEXTURE) continue
		let used = false
		for (let z = z0; z < z0 + per && !used; z++) {
			for (let x = x0; x < x0 + per; x++) {
				if (weights[(z * res + x) * SLOTS + k] > 0) {
					used = true
					break
				}
			}
		}
		if (used) keep.push(k)
	}
	if (keep.length === 0) return false
	const next = new Uint8Array(SLOTS).fill(NO_TEXTURE)
	keep.forEach((k, j) => (next[j] = slots[c * SLOTS + k]))
	let same = true
	for (let k = 0; k < SLOTS; k++) if (next[k] !== slots[c * SLOTS + k]) same = false
	if (same) return false
	const old = new Uint8Array(SLOTS)
	for (let z = z0; z < z0 + per; z++) {
		for (let x = x0; x < x0 + per; x++) {
			const base = (z * res + x) * SLOTS
			for (let k = 0; k < SLOTS; k++) old[k] = weights[base + k]
			for (let j = 0; j < SLOTS; j++) weights[base + j] = j < keep.length ? old[keep[j]] : 0
		}
	}
	slots.set(next, c * SLOTS)
	return true
}

/** Whether chunk c has a texture whose weight is 0 on every texel of the chunk (which compactChunk frees). */
export function hasEmptySlot(side: number, res: number, slots: Uint8Array, weights: Uint8Array, c: number): boolean {
	const per = res / side
	const x0 = (c % side) * per
	const z0 = Math.floor(c / side) * per
	let empty = 0
	let used = 0
	for (let k = 0; k < SLOTS; k++) {
		if (slots[c * SLOTS + k] === NO_TEXTURE) continue
		let any = false
		for (let z = z0; z < z0 + per && !any; z++) {
			for (let x = x0; x < x0 + per; x++) {
				if (weights[(z * res + x) * SLOTS + k] > 0) {
					any = true
					break
				}
			}
		}
		if (any) used++
		else empty++
	}
	// A chunk with no used texture at all is left as it is, as compactChunk leaves it.
	return empty > 0 && used > 0
}

/** Makes the four weights of a texel sum to 255, adjusting the largest one by any rounding error. */
export function normalizeTexel(w: Uint8Array, base: number): void {
	let sum = 0
	for (let k = 0; k < SLOTS; k++) sum += w[base + k]
	if (sum === 255) return
	if (sum === 0) {
		w[base] = 255
		return
	}
	let largest = 0
	for (let k = 1; k < SLOTS; k++) if (w[base + k] > w[base + largest]) largest = k
	let total = 0
	for (let k = 0; k < SLOTS; k++) {
		w[base + k] = Math.round((w[base + k] * 255) / sum)
		total += w[base + k]
	}
	w[base + largest] = Math.max(0, Math.min(255, w[base + largest] + 255 - total))
}

/**
 * Adds `amount` (0 to 1) of slot k to the texel whose weights start at base, taking the weight
 * proportionally from the other slots so the four still sum to 255.
 */
export function addWeight(w: Uint8Array, base: number, k: number, amount: number): void {
	const cur = w[base + k]
	const next = Math.min(255, cur + amount * 255)
	let others = 0
	for (let j = 0; j < SLOTS; j++) if (j !== k) others += w[base + j]
	const scale = others > 0 ? (255 - next) / others : 0
	for (let j = 0; j < SLOTS; j++) {
		if (j === k) w[base + j] = Math.round(next)
		else w[base + j] = Math.round(w[base + j] * scale)
	}
	if (others === 0) w[base + k] = 255
	normalizeTexel(w, base)
}

/**
 * Packs per-texel weights over `roles` candidate textures into the chunk form: each chunk keeps
 * the SLOTS roles with the most weight in it, and each texel's weights are redistributed over them.
 * fill(x, z, out) writes the `roles` weights of texel (x, z), each on a 0-255 scale, into out. It's
 * called once per texel, a chunk at a time, so the whole map's weights never sit in memory at once.
 * res is the splat's texels a side and side the paint chunks a side.
 */
export function packRoles(side: number, res: number, roles: number, fill: (x: number, z: number, out: Float32Array) => void): { weights: Uint8Array; chunkSlots: Uint8Array } {
	const chunks = side * side
	const per = res / side
	const weights = new Uint8Array(res * res * SLOTS)
	const chunkSlots = new Uint8Array(chunks * SLOTS).fill(NO_TEXTURE)
	const chunkRoles = new Float32Array(per * per * roles)
	const texel = new Float32Array(roles)
	const totals = new Float32Array(roles)

	for (let c = 0; c < chunks; c++) {
		const cx = c % side
		const cz = Math.floor(c / side)
		totals.fill(0)
		for (let lz = 0; lz < per; lz++) {
			for (let lx = 0; lx < per; lx++) {
				fill(cx * per + lx, cz * per + lz, texel)
				const p = (lz * per + lx) * roles
				for (let r = 0; r < roles; r++) {
					chunkRoles[p + r] = texel[r]
					totals[r] += texel[r]
				}
			}
		}
		const picked = Array.from({ length: roles }, (_, r) => r)
			.filter((r) => totals[r] > 0)
			.sort((a, b) => totals[b] - totals[a])
			.slice(0, SLOTS)
		// A chunk nothing was painted in still needs a texture: the first palette entry.
		if (picked.length === 0) chunkSlots[c * SLOTS] = 0
		picked.forEach((r, k) => (chunkSlots[c * SLOTS + k] = r))

		for (let lz = 0; lz < per; lz++) {
			for (let lx = 0; lx < per; lx++) {
				const p = (lz * per + lx) * roles
				const base = ((cz * per + lz) * res + cx * per + lx) * SLOTS
				let sum = 0
				for (let k = 0; k < picked.length; k++) sum += chunkRoles[p + picked[k]]
				if (sum > 0) {
					for (let k = 0; k < picked.length; k++) weights[base + k] = Math.round((chunkRoles[p + picked[k]] * 255) / sum)
					normalizeTexel(weights, base)
				} else {
					weights[base] = 255
				}
			}
		}
	}
	return { weights, chunkSlots }
}

/**
 * Converts a map saved with eight global paint layers (format 1) to chunks. Each old layer is its
 * own palette index, so the palette keeps the layer order. The old splat is upsampled from
 * oldRes to res texels a side, and each chunk keeps its four strongest layers.
 */
export function convertGlobalLayers(side: number, res: number, oldRes: number, splatA: Uint8Array, splatB: Uint8Array): { weights: Uint8Array; chunkSlots: Uint8Array } {
	const layers = 8
	const scale = oldRes / res
	return packRoles(side, res, layers, (x, z, out) => {
		const o = (Math.floor(z * scale) * oldRes + Math.floor(x * scale)) * 4
		for (let k = 0; k < 4; k++) {
			out[k] = splatA[o + k]
			out[4 + k] = splatB[o + k]
		}
	})
}

/**
 * Share of the painted map each palette entry takes, sampled every few texels (0 to 1 per entry).
 * res is the splat's texels a side and side the paint chunks a side.
 */
export function paletteCoverage(weights: Uint8Array, chunkSlots: Uint8Array, res: number, side: number, entries: number): number[] {
	const out = new Array<number>(entries).fill(0)
	const per = res / side
	const step = 7
	let total = 0
	for (let t = 0; t < res * res; t += step) {
		const x = t % res
		const z = Math.floor(t / res)
		const c = chunkOf(Math.floor(x / per), Math.floor(z / per), side)
		for (let k = 0; k < SLOTS; k++) {
			const tex = chunkSlots[c * SLOTS + k]
			const w = weights[t * SLOTS + k]
			if (tex === NO_TEXTURE || tex >= entries || w === 0) continue
			out[tex] += w
			total += w
		}
	}
	return out.map((v) => (total > 0 ? v / total : 0))
}

/** Index of path in palette (case-insensitive), or -1. */
export function paletteIndex(palette: readonly string[], path: string): number {
	const want = path.toLowerCase()
	return palette.findIndex((p) => p.toLowerCase() === want)
}

/**
 * Replaces palette texture `from` with `to` across the whole map. A chunk that has `to` already folds
 * `from`'s weight into it; otherwise the slot is renamed. res is the splat's texels a side and side the
 * paint chunks a side.
 */
export function replacePalette(side: number, res: number, slots: Uint8Array, weights: Uint8Array, from: number, to: number): void {
	if (from === to) return
	for (let c = 0; c < side * side; c++) {
		const fromSlot = findSlot(slots, c, from)
		if (fromSlot < 0) continue
		const toSlot = findSlot(slots, c, to)
		if (toSlot < 0) {
			slots[c * SLOTS + fromSlot] = to
			continue
		}
		mergeSlot(side, res, weights, c, fromSlot, toSlot)
		slots[c * SLOTS + fromSlot] = NO_TEXTURE
	}
}

/** Folds every texel's weight in slot `from` of chunk c into slot `to`. The caller frees the slot. */
function mergeSlot(side: number, res: number, weights: Uint8Array, c: number, from: number, to: number): void {
	const per = res / side
	const x0 = (c % side) * per
	const z0 = Math.floor(c / side) * per
	for (let z = z0; z < z0 + per; z++) {
		for (let x = x0; x < x0 + per; x++) {
			const base = (z * res + x) * SLOTS
			weights[base + to] = Math.min(255, weights[base + to] + weights[base + from])
			weights[base + from] = 0
			normalizeTexel(weights, base)
		}
	}
}

/**
 * Replaces the texture in slot `slot` of chunk c with palette texture `to`, in that chunk only. If the
 * chunk already has `to`, the slot's weight folds into it and the slot is freed.
 */
export function replaceInChunk(side: number, res: number, slots: Uint8Array, weights: Uint8Array, c: number, slot: number, to: number): void {
	const from = slots[c * SLOTS + slot]
	if (from === NO_TEXTURE || from === to) return
	const toSlot = findSlot(slots, c, to)
	if (toSlot < 0) {
		slots[c * SLOTS + slot] = to
		return
	}
	mergeSlot(side, res, weights, c, slot, toSlot)
	slots[c * SLOTS + slot] = NO_TEXTURE
}

/**
 * Empties one slot of chunk c: each texel's weight in it goes to the texel's strongest other texture
 * (else the chunk's biggest one), so every texel still sums to 255, and the chunk's used slots move
 * down so slot 0 stays the base. A chunk whose only texture is removed is empty (every slot
 * NO_TEXTURE): the ground draws black and exports without layers, until something is painted there.
 */
export function removeSlot(side: number, res: number, slots: Uint8Array, weights: Uint8Array, c: number, slot: number): void {
	if (slots[c * SLOTS + slot] === NO_TEXTURE) return
	const per = res / side
	const x0 = (c % side) * per
	const z0 = Math.floor(c / side) * per
	const sums = new Array<number>(SLOTS).fill(0)
	for (let z = z0; z < z0 + per; z++) {
		for (let x = x0; x < x0 + per; x++) {
			const base = (z * res + x) * SLOTS
			for (let k = 0; k < SLOTS; k++) sums[k] += weights[base + k]
		}
	}
	let fallback = -1
	for (let k = 0; k < SLOTS; k++) {
		if (k === slot || slots[c * SLOTS + k] === NO_TEXTURE) continue
		if (fallback < 0 || sums[k] > sums[fallback]) fallback = k
	}
	for (let z = z0; z < z0 + per; z++) {
		for (let x = x0; x < x0 + per; x++) {
			const base = (z * res + x) * SLOTS
			const w = weights[base + slot]
			if (w === 0) continue
			let to = -1
			for (let k = 0; k < SLOTS; k++) {
				if (k === slot || slots[c * SLOTS + k] === NO_TEXTURE || weights[base + k] === 0) continue
				if (to < 0 || weights[base + k] > weights[base + to]) to = k
			}
			if (to < 0) to = fallback
			weights[base + slot] = 0
			// The last texture's weight has nowhere to go: slot 0 keeps the sum at 255 (it's ignored while empty).
			weights[base + (to < 0 ? 0 : to)] += w
		}
	}
	slots[c * SLOTS + slot] = NO_TEXTURE
	if (fallback >= 0) compactChunk(side, res, slots, weights, c)
}

/**
 * The first painted layer (slot 1 to 3; the base is kept) of chunk `c` whose strongest texel weighs
 * less than `below` (0 to 255), or -1 for none: a layer too faint to see that still takes a slot.
 */
export function faintSlot(side: number, res: number, slots: Uint8Array, weights: Uint8Array, c: number, below: number): number {
	const per = res / side
	const x0 = (c % side) * per
	const z0 = Math.floor(c / side) * per
	for (let k = 1; k < SLOTS; k++) {
		if (slots[c * SLOTS + k] === NO_TEXTURE) continue
		let peak = 0
		for (let z = z0; z < z0 + per && peak < below; z++) {
			for (let x = x0; x < x0 + per; x++) peak = Math.max(peak, weights[(z * res + x) * SLOTS + k])
		}
		if (peak < below) return k
	}
	return -1
}

/**
 * Removes chunk `c`'s faint layers (faintSlot), each one's weight going to the strongest other
 * texture of each texel. Returns how many went.
 */
export function dropFaintLayers(side: number, res: number, slots: Uint8Array, weights: Uint8Array, c: number, below: number): number {
	let n = 0
	// Removing a layer can compact the chunk's slots, so look again after each.
	for (let k = faintSlot(side, res, slots, weights, c, below); k >= 0; k = faintSlot(side, res, slots, weights, c, below)) {
		removeSlot(side, res, slots, weights, c, k)
		n++
	}
	return n
}

/**
 * Merges chunk `c`'s slots that hold the same palette texture into the first of them, each texel's
 * weights added, and frees the others (Noggit Red's "Remove texture duplicates"). Returns how many
 * slots went.
 */
export function mergeDuplicateSlots(side: number, res: number, slots: Uint8Array, weights: Uint8Array, c: number): number {
	const per = res / side
	const x0 = (c % side) * per
	const z0 = Math.floor(c / side) * per
	let n = 0
	for (let a = 0; a < SLOTS; a++) {
		const tex = slots[c * SLOTS + a]
		if (tex === NO_TEXTURE) continue
		for (let b = a + 1; b < SLOTS; b++) {
			if (slots[c * SLOTS + b] !== tex) continue
			for (let z = z0; z < z0 + per; z++) {
				for (let x = x0; x < x0 + per; x++) {
					const o = (z * res + x) * SLOTS
					weights[o + a] += weights[o + b]
					weights[o + b] = 0
				}
			}
			slots[c * SLOTS + b] = NO_TEXTURE
			n++
		}
	}
	if (n) compactChunk(side, res, slots, weights, c)
	return n
}

/** Sets every chunk to one texture, fully painted, which is how a map starts. */
export function clearPalette(side: number, res: number, slots: Uint8Array, weights: Uint8Array, to = 0): void {
	slots.fill(NO_TEXTURE)
	for (let c = 0; c < side * side; c++) slots[c * SLOTS] = to
	for (let t = 0; t < res * res; t++) {
		weights[t * SLOTS] = 255
		weights[t * SLOTS + 1] = 0
		weights[t * SLOTS + 2] = 0
		weights[t * SLOTS + 3] = 0
	}
}

/**
 * Moves one texel's four weights toward the base texture (slot 0 at 255) by `f`, and keeps them
 * summing to 255. `o` is the texel's first weight in the array.
 */
export function resetTexel(w: Uint8Array, o: number, f: number) {
	for (let k = 0; k < SLOTS; k++) {
		const target = k === 0 ? 255 : 0
		w[o + k] = Math.round(w[o + k] + (target - w[o + k]) * f)
	}
	// Rounding can leave the four weights a unit off 255; the base takes the difference.
	w[o] += 255 - (w[o] + w[o + 1] + w[o + 2] + w[o + 3])
}

/** The paint chunk that holds splat texel `pixel`, when res texels a side cover side chunks a side. */
export function chunkOfTexel(side: number, res: number, pixel: number): number {
	const per = res / side
	return chunkOf(Math.floor((pixel % res) / per), Math.floor(Math.floor(pixel / res) / per), side)
}

/**
 * Moves `amount` (0 to 1) of the weight that texel `pixel` gives palette texture `from` onto palette
 * texture `to`, in the paint chunk that holds it. The four weights still sum to 255. Returns false when
 * that chunk has no slot left for `to`, since 1.12 allows four textures per chunk.
 */
export function swapTexel(side: number, res: number, slots: Uint8Array, weights: Uint8Array, pixel: number, from: number, to: number, amount: number): boolean {
	const c = chunkOfTexel(side, res, pixel)
	const base = pixel * SLOTS
	const src0 = findSlot(slots, c, from)
	if (src0 < 0) return true
	const d = Math.min(weights[base + src0], Math.round(weights[base + src0] * amount))
	if (d <= 0) return true
	const k = acquireSlotReplacing(side, res, slots, weights, c, to, from)
	if (k < 0) return false
	// Compaction or eviction may have moved the source texture to another slot, so look it up again.
	const src = findSlot(slots, c, from)
	weights[base + src] -= d
	weights[base + k] += d
	return true
}

/** Palette index of the texture with the most weight at texel `pixel`, or -1 if none has weight there. */
export function dominantTexel(side: number, res: number, slots: Uint8Array, weights: Uint8Array, pixel: number): number {
	const c = chunkOfTexel(side, res, pixel)
	const base = pixel * SLOTS
	let best = -1
	let bestWeight = 0
	for (let k = 0; k < SLOTS; k++) {
		const tex = slots[c * SLOTS + k]
		if (tex !== NO_TEXTURE && weights[base + k] > bestWeight) {
			bestWeight = weights[base + k]
			best = tex
		}
	}
	return best
}

/** The weight (0 to 1) of palette texture `tex` at texel `pixel`; 0 where its chunk doesn't use it. */
export function textureWeightTexel(side: number, res: number, slots: Uint8Array, weights: Uint8Array, pixel: number, tex: number): number {
	const c = chunkOfTexel(side, res, pixel)
	for (let k = 0; k < SLOTS; k++) if (slots[c * SLOTS + k] === tex) return weights[pixel * SLOTS + k] / 255
	return 0
}

/** A texture in one chunk: its palette index, and the share of the chunk's paint it takes (0 to 1). */
export interface ChunkTexture {
	slot: number
	tex: number
	share: number
}

/**
 * The textures chunk c uses, in slot order. The share is the texture's weight over every texel of
 * the chunk, out of the 255 each texel holds. Entries past the palette are left out.
 */
export function chunkTextures(side: number, res: number, slots: Uint8Array, weights: Uint8Array, c: number, entries: number): ChunkTexture[] {
	const per = res / side
	const x0 = (c % side) * per
	const z0 = Math.floor(c / side) * per
	const sums = new Array<number>(SLOTS).fill(0)
	for (let z = z0; z < z0 + per; z++) {
		for (let x = x0; x < x0 + per; x++) {
			const p = (z * res + x) * SLOTS
			for (let k = 0; k < SLOTS; k++) sums[k] += weights[p + k]
		}
	}
	const out: ChunkTexture[] = []
	for (let k = 0; k < SLOTS; k++) {
		const tex = slots[c * SLOTS + k]
		if (tex === NO_TEXTURE || tex >= entries) continue
		out.push({ slot: k, tex, share: sums[k] / (per * per * 255) })
	}
	return out
}
