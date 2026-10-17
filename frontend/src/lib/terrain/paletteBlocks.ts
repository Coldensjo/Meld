// The tileset array's layers as DXT3 blocks (#216), for a renderer that samples S3TC: 64 KB a layer
// against the RGBA layer's 256 KB. DXT3 holds the colour as DXT1 does and the sheen mask as an
// explicit 4-bit alpha, which is what the client's `_s` twins are, so most layers are copied from the
// BLPs' own blocks: the base texture's colour blocks and the `_s` twin's alpha blocks. A tileset
// smaller than PALETTE_RES is nearest-resampled block by block, exactly, since every output block
// then reads one source block. Only what isn't a power-of-two DXT up to PALETTE_RES (an RGBA BLP,
// a colour entry) is encoded here, and DXT1 blocks in the three-colour mode, which DXT3 lacks, are
// refitted (0.6% of the client's tileset blocks).

export const RES = 256
const SIDE = RES / 4
/** Bytes of one DXT3 layer: 16 a block. */
export const LAYER_BYTES = SIDE * SIDE * 16

/** The first level of a DXT reply from the texture endpoint (`Client.TextureDXT`). */
export interface DxtLevel {
	kind: 1 | 3 | 5
	width: number
	height: number
	data: Uint8Array
}

/** The first level of a texture reply, or null for an RGBA one (magic "RGBA" or anything not DXT). */
export function dxtLevel(buf: ArrayBuffer): DxtLevel | null {
	const dv = new DataView(buf)
	if (buf.byteLength < 20 || dv.getUint8(0) !== 68 || dv.getUint8(1) !== 88 || dv.getUint8(2) !== 84) return null
	const k = dv.getUint8(3) - 48
	if (k !== 1 && k !== 3 && k !== 5) return null
	if (dv.getUint32(12, true) < 1) return null
	return { kind: k, width: dv.getUint32(4, true), height: dv.getUint32(8, true), data: new Uint8Array(buf, 20, dv.getUint32(16, true)) }
}

const pow2 = (n: number) => n > 0 && (n & (n - 1)) === 0

/** Whether a level is resampled to RES block by block: power-of-two sides, none above RES. */
export function blockResamplable(l: DxtLevel): boolean {
	return pow2(l.width) && pow2(l.height) && l.width <= RES && l.height <= RES
}

const rd16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const rd32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
function wr16(b: Uint8Array, o: number, v: number) {
	b[o] = v & 255
	b[o + 1] = (v >> 8) & 255
}
function wr32(b: Uint8Array, o: number, v: number) {
	b[o] = v & 255
	b[o + 1] = (v >>> 8) & 255
	b[o + 2] = (v >>> 16) & 255
	b[o + 3] = (v >>> 24) & 255
}

/**
 * The source texel index (0-15 within its block) of each of an output block's 16 texels, and the
 * source block's byte offset, for output block (bx, by): the nearest resample `resample` in
 * paletteArray.ts does, source x = floor(x * w / RES).
 */
function sourceOf(l: DxtLevel, bx: number, by: number, step: number, map: Uint8Array): number {
	const w = l.width
	const h = l.height
	const perRow = Math.max(1, (w + 3) >> 2)
	const sx0 = (bx * 4 * w) / RES
	const sy0 = (by * 4 * h) / RES
	for (let j = 0; j < 4; j++) {
		const sy = Math.floor(((by * 4 + j) * h) / RES)
		for (let i = 0; i < 4; i++) {
			const sx = Math.floor(((bx * 4 + i) * w) / RES)
			map[j * 4 + i] = (sy & 3) * 4 + (sx & 3)
		}
	}
	return ((Math.floor(sy0) >> 2) * perRow + (Math.floor(sx0) >> 2)) * step
}

const texMap = new Uint8Array(16)
const rgb = new Uint8Array(48)

/**
 * Writes the colour half (bytes 8-15) of each of `out`'s blocks from a level that
 * `blockResamplable` allows. Every block is left in the four-colour mode with colour0 > colour1, or
 * one colour with every index 0, so it decodes the same whichever mode the GPU reads DXT3 in.
 */
export function writeColour(out: Uint8Array, l: DxtLevel) {
	const step = l.kind === 1 ? 8 : 16
	const off = l.kind === 1 ? 0 : 8
	for (let by = 0; by < SIDE; by++) {
		for (let bx = 0; bx < SIDE; bx++) {
			const s = sourceOf(l, bx, by, step, texMap) + off
			const c0 = rd16(l.data, s)
			const c1 = rd16(l.data, s + 2)
			const idx = rd32(l.data, s + 4)
			let ni = 0
			let used = 0
			for (let t = 0; t < 16; t++) {
				const v = (idx >>> (texMap[t] * 2)) & 3
				ni |= v << (t * 2)
				used |= 1 << v
			}
			const o = (by * SIDE + bx) * 16 + 8
			if (l.kind === 1 && c0 <= c1 && used & 12) {
				// Three-colour mode with the midpoint or black in use: decode and fit four colours.
				decodeThree(c0, c1, ni >>> 0, rgb)
				encodeBlock(rgb, out, o, c0, c1)
			} else {
				putFour(out, o, c0, c1, ni >>> 0)
			}
		}
	}
}

/** Writes a four-colour block, colour0 > colour1, swapping the ends (and the indices) where needed. */
function putFour(out: Uint8Array, o: number, c0: number, c1: number, idx: number) {
	if (c0 === c1) {
		idx = 0
	} else if (c0 < c1) {
		const t = c0
		c0 = c1
		c1 = t
		// 0 <-> 1 and 2 <-> 3: each end and each third swaps with its mirror.
		idx = (idx ^ 0x55555555) >>> 0
	}
	wr16(out, o, c0)
	wr16(out, o + 2, c1)
	wr32(out, o + 4, idx)
}

/** Writes the alpha half (bytes 0-7) of each of `out`'s blocks from a DXT3 level's explicit alpha. */
export function writeAlpha(out: Uint8Array, l: DxtLevel) {
	for (let by = 0; by < SIDE; by++) {
		for (let bx = 0; bx < SIDE; bx++) {
			const s = sourceOf(l, bx, by, 16, texMap)
			const o = (by * SIDE + bx) * 16
			for (let t = 0; t < 16; t += 2) {
				const a = (l.data[s + (texMap[t] >> 1)] >> ((texMap[t] & 1) * 4)) & 15
				const b = (l.data[s + (texMap[t + 1] >> 1)] >> ((texMap[t + 1] & 1) * 4)) & 15
				out[o + (t >> 1)] = a | (b << 4)
			}
		}
	}
}

/** Writes the alpha half of each block from the alpha of RES² RGBA pixels, or 0 for none. */
export function encodeAlpha(out: Uint8Array, px: Uint8Array | null) {
	for (let by = 0; by < SIDE; by++) {
		for (let bx = 0; bx < SIDE; bx++) {
			const o = (by * SIDE + bx) * 16
			for (let t = 0; t < 16; t += 2) {
				if (!px) {
					out[o + (t >> 1)] = 0
					continue
				}
				const p = ((by * 4 + (t >> 2)) * RES + bx * 4 + (t & 3)) * 4 + 3
				out[o + (t >> 1)] = four(px[p]) | (four(px[p + 4]) << 4)
			}
		}
	}
}

const four = (a: number) => Math.round((a * 15) / 255)

/** Writes the colour half of each block from RES² RGBA pixels. */
export function encodeColour(out: Uint8Array, px: Uint8Array) {
	for (let by = 0; by < SIDE; by++) {
		for (let bx = 0; bx < SIDE; bx++) {
			for (let t = 0; t < 16; t++) {
				const p = ((by * 4 + (t >> 2)) * RES + bx * 4 + (t & 3)) * 4
				rgb[t * 3] = px[p]
				rgb[t * 3 + 1] = px[p + 1]
				rgb[t * 3 + 2] = px[p + 2]
			}
			encodeBlock(rgb, out, (by * SIDE + bx) * 16 + 8)
		}
	}
}

/** A layer of one colour, as near as a block gets it, `alpha` (0-15) in every texel's alpha. */
export function solidLayer(r: number, g: number, b: number, alpha = 0): Uint8Array {
	const out = new Uint8Array(LAYER_BYTES)
	for (let t = 0; t < 16; t++) rgb.set([r, g, b], t * 3)
	encodeBlock(rgb, out, 8)
	out.fill(alpha | (alpha << 4), 0, 8)
	for (let o = 16; o < LAYER_BYTES; o += 16) out.copyWithin(o, 0, 16)
	return out
}

function to565(r: number, g: number, b: number): number {
	return (Math.round((r * 31) / 255) << 11) | (Math.round((g * 63) / 255) << 5) | Math.round((b * 31) / 255)
}

/** The colour a 5:6:5 value decodes to, as the GPU widens it. */
function from565(c: number, out: Float32Array, o: number) {
	const r = (c >> 11) & 31
	const g = (c >> 5) & 63
	const b = c & 31
	out[o] = (r << 3) | (r >> 2)
	out[o + 1] = (g << 2) | (g >> 4)
	out[o + 2] = (b << 3) | (b >> 2)
}

const pal = new Float32Array(12)

/** The 16 colours of a three-colour DXT1 block: the ends, their midpoint and black. */
function decodeThree(c0: number, c1: number, idx: number, out: Uint8Array) {
	from565(c0, pal, 0)
	from565(c1, pal, 3)
	for (let k = 0; k < 3; k++) {
		pal[6 + k] = (pal[k] + pal[3 + k]) / 2
		pal[9 + k] = 0
	}
	for (let t = 0; t < 16; t++) {
		const v = ((idx >>> (t * 2)) & 3) * 3
		out[t * 3] = Math.round(pal[v])
		out[t * 3 + 1] = Math.round(pal[v + 1])
		out[t * 3 + 2] = Math.round(pal[v + 2])
	}
}

/** Sum of squared errors of 16 colours against the four-colour palette of c0, c1, with the indices. */
function fitFour(px: Uint8Array, c0: number, c1: number): { err: number; idx: number } {
	from565(c0, pal, 0)
	from565(c1, pal, 3)
	for (let k = 0; k < 3; k++) {
		pal[6 + k] = (2 * pal[k] + pal[3 + k]) / 3
		pal[9 + k] = (pal[k] + 2 * pal[3 + k]) / 3
	}
	let err = 0
	let idx = 0
	for (let t = 0; t < 16; t++) {
		let best = Infinity
		let bi = 0
		for (let v = 0; v < 4; v++) {
			const dr = px[t * 3] - pal[v * 3]
			const dg = px[t * 3 + 1] - pal[v * 3 + 1]
			const db = px[t * 3 + 2] - pal[v * 3 + 2]
			const d = dr * dr + dg * dg + db * db
			if (d < best) {
				best = d
				bi = v
			}
		}
		err += best
		idx |= bi << (t * 2)
	}
	return { err, idx: idx >>> 0 }
}

/**
 * For each 8-bit value, the 5-bit (first 512 bytes) and 6-bit (last 512) pair of ends whose
 * one-third point comes nearest it, as stb_dxt's single-colour tables: a flat block hits its colour
 * closer than with both ends on the nearest 5:6:5 colour.
 */
let thirds: Uint8Array | null = null
function thirdsTable(): Uint8Array {
	if (thirds) return thirds
	thirds = new Uint8Array(1024)
	for (const [bits, base] of [
		[5, 0],
		[6, 512],
	]) {
		const top = (1 << bits) - 1
		const wide = (e: number) => (bits === 5 ? (e << 3) | (e >> 2) : (e << 2) | (e >> 4))
		for (let v = 0; v < 256; v++) {
			let best = Infinity
			for (let a = 0; a <= top; a++)
				for (let b = 0; b <= top; b++) {
					const d = Math.abs((2 * wide(a) + wide(b)) / 3 - v)
					if (d < best) {
						best = d
						thirds[base + v * 2] = a
						thirds[base + v * 2 + 1] = b
					}
				}
		}
	}
	return thirds
}

/**
 * Encodes 16 RGB colours as a four-colour block at `o`, with the ends that fit best of: the colours
 * furthest apart along the block's principal axis, its bounding box's corners, the pair whose third
 * is the block's mean colour (`thirdsTable`), and `e0`, `e1` where given (a refitted block's own
 * ends).
 */
function encodeBlock(px: Uint8Array, out: Uint8Array, o: number, e0 = -1, e1 = -1) {
	let mr = 0
	let mg = 0
	let mb = 0
	for (let t = 0; t < 16; t++) {
		mr += px[t * 3]
		mg += px[t * 3 + 1]
		mb += px[t * 3 + 2]
	}
	mr /= 16
	mg /= 16
	mb /= 16
	let xx = 0
	let xy = 0
	let xz = 0
	let yy = 0
	let yz = 0
	let zz = 0
	for (let t = 0; t < 16; t++) {
		const r = px[t * 3] - mr
		const g = px[t * 3 + 1] - mg
		const b = px[t * 3 + 2] - mb
		xx += r * r
		xy += r * g
		xz += r * b
		yy += g * g
		yz += g * b
		zz += b * b
	}
	// Power iteration from the widest channel.
	let ax = xx >= yy && xx >= zz ? 1 : 0
	let ay = ax === 0 && yy >= zz ? 1 : 0
	let az = ax === 0 && ay === 0 ? 1 : 0
	for (let i = 0; i < 6; i++) {
		const nx = xx * ax + xy * ay + xz * az
		const ny = xy * ax + yy * ay + yz * az
		const nz = xz * ax + yz * ay + zz * az
		const m = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz))
		if (m === 0) break
		ax = nx / m
		ay = ny / m
		az = nz / m
	}
	let lo = Infinity
	let hi = -Infinity
	let li = 0
	let hiI = 0
	let minR = 255
	let minG = 255
	let minB = 255
	let maxR = 0
	let maxG = 0
	let maxB = 0
	for (let t = 0; t < 16; t++) {
		const r = px[t * 3]
		const g = px[t * 3 + 1]
		const b = px[t * 3 + 2]
		const d = r * ax + g * ay + b * az
		if (d < lo) {
			lo = d
			li = t
		}
		if (d > hi) {
			hi = d
			hiI = t
		}
		minR = Math.min(minR, r)
		minG = Math.min(minG, g)
		minB = Math.min(minB, b)
		maxR = Math.max(maxR, r)
		maxG = Math.max(maxG, g)
		maxB = Math.max(maxB, b)
	}
	let c0 = to565(px[hiI * 3], px[hiI * 3 + 1], px[hiI * 3 + 2])
	let c1 = to565(px[li * 3], px[li * 3 + 1], px[li * 3 + 2])
	let best = fitFour(px, c0, c1)
	const b0 = to565(maxR, maxG, maxB)
	const b1 = to565(minR, minG, minB)
	const box = fitFour(px, b0, b1)
	if (box.err < best.err) {
		best = box
		c0 = b0
		c1 = b1
	}
	const t = thirdsTable()
	const r = Math.round(mr)
	const g = Math.round(mg)
	const b = Math.round(mb)
	const m0 = (t[r * 2] << 11) | (t[512 + g * 2] << 5) | t[b * 2]
	const m1 = (t[r * 2 + 1] << 11) | (t[512 + g * 2 + 1] << 5) | t[b * 2 + 1]
	const mean = fitFour(px, m0, m1)
	if (mean.err < best.err) {
		best = mean
		c0 = m0
		c1 = m1
	}
	if (e0 >= 0) {
		const own = fitFour(px, e0, e1)
		if (own.err < best.err) {
			best = own
			c0 = e0
			c1 = e1
		}
	}
	putFour(out, o, c0, c1, best.idx)
}
