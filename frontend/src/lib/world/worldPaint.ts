import { MAX_PALETTE, NO_TEXTURE, SLOTS } from '../terrain/chunkPaint'
import { TILE_CHUNKS, TILE_YARDS } from '../wow/format'

// The world view's near ground in the client's own texture layers (#15): what /wow/groundpaint sends
// for a tile, and the palette the painted tiles share. No rendering here (world/WorldPainter.ts draws).

/** The paint texels a side of a tile: 32 a chunk, as the editor holds a chunk's paint (tilePaint). */
export const PAINT_SIDE = TILE_CHUNKS * 32

/**
 * How near the camera (tileDistance) a tile is drawn in its texture layers: the tiles drawn at every
 * sample or every second (groundStride); further off the minimap image stands in.
 */
export const PAINT_REACH = TILE_YARDS * 1.5

/** How far a painted tile goes before it lets go of its paint: half a tile past PAINT_REACH, so a camera on the line doesn't swap it back and forth. */
export const PAINT_DROP = PAINT_REACH + TILE_YARDS / 2

/** A tile's texture layers as /wow/groundpaint sends them (wow.EncodePaint). */
export interface TilePaintIn {
	/** The textures the tile names. */
	names: string[]
	/** Each chunk's SLOTS slots (16x16 chunks, rows running south): an index into names, NO_TEXTURE for none. */
	slots: Uint8Array
	/** SLOTS weights a texel, PAINT_SIDE squared, each texel summing to 255. */
	weights: Uint8Array
}

/** Reads a /wow/groundpaint reply: "PANT", the names (a uint16 count, each a uint16 length and its bytes), the slots, the weights. */
export function parsePaint(buf: ArrayBuffer): TilePaintIn {
	const bytes = new Uint8Array(buf)
	const dv = new DataView(buf)
	const bad = () => new Error(`not a tile's paint (${buf.byteLength} bytes)`)
	if (buf.byteLength < 6 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'PANT') throw bad()
	const count = dv.getUint16(4, true)
	const names: string[] = []
	let at = 6
	const text = new TextDecoder()
	for (let i = 0; i < count; i++) {
		if (at + 2 > buf.byteLength) throw bad()
		const n = dv.getUint16(at, true)
		at += 2
		if (at + n > buf.byteLength) throw bad()
		names.push(text.decode(bytes.subarray(at, at + n)))
		at += n
	}
	const slotBytes = TILE_CHUNKS * TILE_CHUNKS * SLOTS
	if (buf.byteLength !== at + slotBytes + PAINT_SIDE * PAINT_SIDE * SLOTS) throw bad()
	return { names, slots: bytes.subarray(at, at + slotBytes), weights: bytes.subarray(at + slotBytes) }
}

/**
 * The entries of the palette the world view's painted tiles share: a texture holds one entry however
 * many tiles name it, counted per tile that uses it. An entry no tile uses keeps its texture until its
 * slot is needed: a new texture takes it once the array is full at its depth (a power of two, as
 * PaletteArray grows it), so the array grows only when the tiles near the camera need more.
 */
export class PaletteSlots {
	readonly paths: string[] = []
	private uses: number[] = []
	private index = new Map<string, number>()

	/** `onEntry` writes entry i's texture into the array (PaletteArray.setEntry). */
	constructor(private onEntry: (i: number, path: string) => void) {}

	/** The entry showing `path`, counting one more use of it; -1 when every one of the MAX_PALETTE entries is in use. */
	acquire(path: string): number {
		const key = path.toLowerCase()
		let i = this.index.get(key)
		if (i === undefined) {
			const n = this.paths.length
			i = n >= 8 && (n & (n - 1)) === 0 ? this.uses.indexOf(0) : -1
			if (i < 0) {
				if (n >= MAX_PALETTE) return -1
				i = n
				this.paths.push('')
				this.uses.push(0)
			} else this.index.delete(this.paths[i].toLowerCase())
			this.paths[i] = path
			this.index.set(key, i)
			this.onEntry(i, path)
		}
		this.uses[i]++
		return i
	}

	/** One use fewer of entry i. */
	release(i: number) {
		if (this.uses[i] > 0) this.uses[i]--
	}

	/** How many tiles use entry i. */
	usesOf(i: number): number {
		return this.uses[i] ?? 0
	}
}

/**
 * A tile's chunk slots in the shared palette: each name's entry from `entries` (in the order of
 * names), and a chunk with no layer at all showing entry `bare` (the colour that stands in for it).
 */
export function sharedSlots(p: TilePaintIn, entries: readonly number[], bare: number): Uint8Array {
	const out = new Uint8Array(p.slots.length).fill(NO_TEXTURE)
	for (let c = 0; c < p.slots.length; c += SLOTS) {
		if (p.slots[c] === NO_TEXTURE) {
			out[c] = bare
			continue
		}
		for (let k = 0; k < SLOTS; k++) {
			const s = p.slots[c + k]
			if (s !== NO_TEXTURE) out[c + k] = entries[s]
		}
	}
	return out
}
