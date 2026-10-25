import { CHUNK_CELLS, MAX_PALETTE, NO_TEXTURE, SLOTS, SPLAT_PER_CELL, normalizeTexel } from '../terrain/chunkPaint'
import { LAYERS } from '../terrain/layers'
import { ALPHA_SIZE } from '../wow/format'

// Turns a 1.12 tile's texture layers into the editor's paint form. The tile's layers already sit in
// 8x8-cell chunks with at most four textures each, so this is a change of representation: the
// palette collects the tile's textures, each chunk's slots name them, and the alpha maps (64x64
// per chunk) become texel weights (down to SPLAT_PER_CELL texels a cell).

/** One texture layer of a chunk, as the tile has it. alpha is absent for the base layer. */
export interface TileLayerIn {
	texture: string
	/** 64x64 alpha, row-major, 0-255. */
	alpha?: Uint8Array
}

export interface TileChunkIn {
	indexX: number
	indexY: number
	layers: TileLayerIn[]
}

export interface TilePaint {
	palette: string[]
	/** SLOTS weights per splat texel, each texel summing to 255. */
	weights: Uint8Array
	/** SLOTS palette indices per paint chunk. */
	chunkSlots: Uint8Array
	/** Layers past the four a chunk allows, which were left out. */
	dropped: number
}

/** WoW's alpha maps are 64x64 per chunk. */
const ALPHA = ALPHA_SIZE

/** The bytes of one layer's alpha map (vmangos.AlphaBytes). */
export const ALPHA_BYTES = ALPHA * ALPHA

/**
 * Converts a tile's chunks to paint. side is the paint chunks a side of the tile (16), and
 * the splat texels a side of a chunk follow from SPLAT_PER_CELL. Go's adt.ClientWeights repeats this
 * conversion to the unit, so Compile can tell the chunks left unpainted (#526): change both together.
 */
export function tilePaint(chunks: TileChunkIn[], side: number): TilePaint {
	const palette: string[] = []
	const indexOf = (path: string) => {
		let i = palette.indexOf(path)
		if (i < 0) {
			if (palette.length >= MAX_PALETTE) throw new Error(`the tile uses more than ${MAX_PALETTE} textures`)
			palette.push(path)
			i = palette.length - 1
		}
		return i
	}

	const perChunk = CHUNK_CELLS * SPLAT_PER_CELL
	const res = side * perChunk
	const weights = new Uint8Array(res * res * SLOTS)
	const chunkSlots = new Uint8Array(side * side * SLOTS).fill(NO_TEXTURE)
	let dropped = 0
	const step = ALPHA / perChunk
	// Scratch for one texel: each layer's alpha, and its share of the texel.
	const alphas = new Float64Array(SLOTS)
	const w = new Float64Array(SLOTS)

	for (const chunk of chunks) {
		const c = chunk.indexY * side + chunk.indexX
		const layers = chunk.layers.slice(0, SLOTS)
		dropped += chunk.layers.length - layers.length
		if (layers.length === 0) {
			chunkSlots[c * SLOTS] = 0
			for (let t = 0; t < perChunk * perChunk; t++) {
				const x = chunk.indexX * perChunk + (t % perChunk)
				const z = chunk.indexY * perChunk + Math.floor(t / perChunk)
				weights[(z * res + x) * SLOTS] = 255
			}
			continue
		}
		layers.forEach((layer, k) => (chunkSlots[c * SLOTS + k] = indexOf(layer.texture)))

		const n = layers.length
		for (let v = 0; v < perChunk; v++) {
			for (let u = 0; u < perChunk; u++) {
				// Each texel covers a step x step block of alpha texels (64 over 32).
				for (let k = 0; k < n; k++) {
					const alpha = layers[k].alpha
					if (!alpha) {
						alphas[k] = 0
						continue
					}
					let sum = 0
					for (let by = 0; by < step; by++) {
						const row = (v * step + by) * ALPHA + u * step
						for (let bx = 0; bx < step; bx++) sum += alpha[row + bx]
					}
					alphas[k] = sum / (step * step) / 255
				}
				// WoW blends the layers in order: layer k shows alpha_k of what the layers above it leave.
				let rest = 1
				for (let k = n - 1; k >= 1; k--) {
					w[k] = alphas[k] * rest
					rest *= 1 - alphas[k]
				}
				w[0] = rest
				const x = chunk.indexX * perChunk + u
				const z = chunk.indexY * perChunk + v
				const base = (z * res + x) * SLOTS
				for (let k = 0; k < n; k++) weights[base + k] = Math.round(w[k] * 255)
				normalizeTexel(weights, base)
			}
		}
	}

	// Pad the palette with the default colours, so auto-paint's roles always have an entry.
	for (const l of LAYERS) if (palette.length < LAYERS.length) palette.push(l.swatch)
	return { palette, weights, chunkSlots, dropped }
}
