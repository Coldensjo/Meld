// Run with: node --import ./tests/register.mjs --test tests/paletteBlocks.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	LAYER_BYTES,
	RES,
	blockResamplable,
	dxtLevel,
	encodeAlpha,
	encodeColour,
	solidLayer,
	writeAlpha,
	writeColour,
	type DxtLevel,
} from '../src/lib/terrain/paletteBlocks.ts'

// A reference decoder: RGBA of a level, colour blocks in DXT1's two modes (kind 1) or always four
// colours (DXT3), and DXT3's explicit alpha.
function widen(c: number): number[] {
	const r = (c >> 11) & 31
	const g = (c >> 5) & 63
	const b = c & 31
	return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]
}

function decode(data: Uint8Array, w: number, h: number, kind: 1 | 3): Uint8Array {
	const out = new Uint8Array(w * h * 4)
	const step = kind === 1 ? 8 : 16
	const perRow = Math.max(1, (w + 3) >> 2)
	for (let by = 0; by * 4 < h; by++) {
		for (let bx = 0; bx * 4 < w; bx++) {
			const s = (by * perRow + bx) * step
			const cs = s + (kind === 1 ? 0 : 8)
			const c0 = data[cs] | (data[cs + 1] << 8)
			const c1 = data[cs + 2] | (data[cs + 3] << 8)
			const p0 = widen(c0)
			const p1 = widen(c1)
			const four = kind !== 1 || c0 > c1
			const pal = four
				? [p0, p1, p0.map((v, k) => Math.round((2 * v + p1[k]) / 3)), p0.map((v, k) => Math.round((v + 2 * p1[k]) / 3))]
				: [p0, p1, p0.map((v, k) => Math.round((v + p1[k]) / 2)), [0, 0, 0]]
			const idx = (data[cs + 4] | (data[cs + 5] << 8) | (data[cs + 6] << 16) | (data[cs + 7] << 24)) >>> 0
			for (let t = 0; t < 16; t++) {
				const x = bx * 4 + (t & 3)
				const y = by * 4 + (t >> 2)
				if (x >= w || y >= h) continue
				const c = pal[(idx >>> (t * 2)) & 3]
				const o = (y * w + x) * 4
				out.set(c, o)
				out[o + 3] = kind === 1 ? 255 : ((data[s + (t >> 1)] >> ((t & 1) * 4)) & 15) * 17
			}
		}
	}
	return out
}

/** Nearest resample to RES², as paletteArray.ts does it. */
function resample(px: Uint8Array, w: number, h: number): Uint8Array {
	const out = new Uint8Array(RES * RES * 4)
	for (let y = 0; y < RES; y++)
		for (let x = 0; x < RES; x++) {
			const s = (Math.floor((y * h) / RES) * w + Math.floor((x * w) / RES)) * 4
			out.set(px.subarray(s, s + 4), (y * RES + x) * 4)
		}
	return out
}

/** Seeded random bytes, so a failure repeats. */
function bytes(n: number, seed: number): Uint8Array {
	const out = new Uint8Array(n)
	let s = seed
	for (let i = 0; i < n; i++) {
		s = (s * 1103515245 + 12345) >>> 0
		out[i] = s >>> 24
	}
	return out
}

/** Random DXT blocks, each DXT1 one forced into the four-colour mode (colour0 > colour1) or not. */
function blocks(w: number, h: number, kind: 1 | 3, mode: 'four' | 'three' | 'any', seed: number): Uint8Array {
	const step = kind === 1 ? 8 : 16
	const data = bytes(Math.max(1, w >> 2) * Math.max(1, h >> 2) * step, seed)
	if (kind === 1 && mode !== 'any') {
		for (let o = 0; o < data.length; o += 8) {
			const c0 = data[o] | (data[o + 1] << 8)
			const c1 = data[o + 2] | (data[o + 3] << 8)
			if ((mode === 'four') !== c0 > c1 || c0 === c1) {
				const [a, b] = mode === 'four' ? [Math.max(c0, c1) | 1, Math.min(c0, c1) & ~1] : [Math.min(c0, c1) & ~1, Math.max(c0, c1) | 1]
				data[o] = a & 255
				data[o + 1] = a >> 8
				data[o + 2] = b & 255
				data[o + 3] = b >> 8
			}
		}
	}
	return data
}

const level = (kind: 1 | 3, width: number, height: number, data: Uint8Array): DxtLevel => ({ kind, width, height, data })

function maxDiff(a: Uint8Array, b: Uint8Array, channels: number[]): number {
	let m = 0
	for (let i = 0; i < a.length; i += 4) for (const c of channels) m = Math.max(m, Math.abs(a[i + c] - b[i + c]))
	return m
}

test('a texture reply gives its first DXT level, and none for RGBA', () => {
	const buf = new ArrayBuffer(16 + 4 + 8 + 4 + 8)
	const dv = new DataView(buf)
	;[68, 88, 84, 49].forEach((c, i) => dv.setUint8(i, c))
	dv.setUint32(4, 4, true)
	dv.setUint32(8, 4, true)
	dv.setUint32(12, 2, true)
	dv.setUint32(16, 8, true)
	new Uint8Array(buf, 20, 8).fill(7)
	const l = dxtLevel(buf)!
	assert.equal(l.kind, 1)
	assert.equal(l.width, 4)
	assert.deepEqual([...l.data], new Array(8).fill(7))
	const rgba = new ArrayBuffer(12 + 64)
	;[82, 71, 66, 65].forEach((c, i) => new DataView(rgba).setUint8(i, c))
	assert.equal(dxtLevel(rgba), null)
	assert.ok(blockResamplable(level(1, 128, 256, new Uint8Array())))
	assert.ok(!blockResamplable(level(1, 512, 512, new Uint8Array())))
	assert.ok(!blockResamplable(level(1, 192, 256, new Uint8Array())))
})

test('a 256² four-colour DXT1 tileset is copied block for block', () => {
	const src = blocks(256, 256, 1, 'four', 1)
	const out = new Uint8Array(LAYER_BYTES)
	writeColour(out, level(1, 256, 256, src))
	for (let b = 0; b < 64 * 64; b++) assert.deepEqual([...out.subarray(b * 16 + 8, b * 16 + 16)], [...src.subarray(b * 8, b * 8 + 8)])
})

test('smaller tilesets resample block by block to exactly the nearest resample of their pixels', () => {
	for (const [w, h, kind] of [
		[128, 128, 1],
		[64, 32, 1],
		[8, 8, 1],
		[128, 128, 3],
	] as const) {
		const src = blocks(w, h, kind, 'four', w + h + kind)
		const out = new Uint8Array(LAYER_BYTES)
		writeColour(out, level(kind, w, h, src))
		const want = resample(decode(src, w, h, kind), w, h)
		assert.equal(maxDiff(decode(out, RES, RES, 3), want, [0, 1, 2]), 0, `${w}x${h} DXT${kind}`)
	}
})

test('DXT3 colour blocks with colour0 <= colour1 are flipped so either decode mode agrees', () => {
	const src = blocks(256, 256, 3, 'any', 5)
	const out = new Uint8Array(LAYER_BYTES)
	writeColour(out, level(3, 256, 256, src))
	assert.equal(maxDiff(decode(out, RES, RES, 3), decode(src, 256, 256, 3), [0, 1, 2]), 0)
	for (let o = 8; o < LAYER_BYTES; o += 16) {
		const c0 = out[o] | (out[o + 1] << 8)
		const c1 = out[o + 2] | (out[o + 3] << 8)
		const idx = out[o + 4] | out[o + 5] | out[o + 6] | out[o + 7]
		assert.ok(c0 > c1 || (c0 === c1 && idx === 0))
	}
	// So the output decodes the same read as DXT1 too.
	const asOne = new Uint8Array(LAYER_BYTES / 2)
	for (let b = 0; b < 64 * 64; b++) asOne.set(out.subarray(b * 16 + 8, b * 16 + 16), b * 8)
	assert.equal(maxDiff(decode(asOne, RES, RES, 1), decode(out, RES, RES, 3), [0, 1, 2]), 0)
})

test('three-colour DXT1 blocks keep their colours: exactly with only the ends used, closely otherwise', () => {
	const src = blocks(256, 256, 1, 'three', 9)
	// The first half of the blocks use only the two ends.
	for (let o = 0; o < src.length / 2; o += 8) for (let k = 4; k < 8; k++) src[o + k] &= 0x55
	const out = new Uint8Array(LAYER_BYTES)
	writeColour(out, level(1, 256, 256, src))
	const got = decode(out, RES, RES, 3)
	const want = decode(src, 256, 256, 1)
	const half = got.length / 2
	assert.equal(maxDiff(got.subarray(0, half), want.subarray(0, half), [0, 1, 2]), 0)
	// Random ends with black among them is the worst case: a four-colour fit is near, not exact.
	let sum = 0
	for (let i = half; i < got.length; i += 4) for (let c = 0; c < 3; c++) sum += Math.abs(got[i + c] - want[i + c])
	assert.ok(sum / ((half / 4) * 3) < 24, `mean error ${sum / ((half / 4) * 3)}`)
})

test('the sheen comes from the _s twin’s explicit alpha, resampled exactly', () => {
	for (const size of [256, 64]) {
		const src = blocks(size, size, 3, 'any', size)
		const out = new Uint8Array(LAYER_BYTES)
		writeAlpha(out, level(3, size, size, src))
		assert.equal(maxDiff(decode(out, RES, RES, 3), resample(decode(src, size, size, 3), size, size), [3]), 0)
	}
})

test('RGBA pixels encode closely, and a colour entry comes within one step of its colour', () => {
	const px = new Uint8Array(RES * RES * 4)
	for (let y = 0; y < RES; y++)
		for (let x = 0; x < RES; x++) px.set([x, y, (x + y) >> 1, (x * 7) & 255], (y * RES + x) * 4)
	const out = new Uint8Array(LAYER_BYTES)
	encodeColour(out, px)
	encodeAlpha(out, px)
	const got = decode(out, RES, RES, 3)
	assert.ok(maxDiff(got, px, [0, 1, 2]) <= 8, `colour ${maxDiff(got, px, [0, 1, 2])}`)
	assert.ok(maxDiff(got, px, [3]) <= 8)
	encodeAlpha(out, null)
	assert.equal(maxDiff(decode(out, RES, RES, 3), new Uint8Array(RES * RES * 4), [3]), 0)

	const s = decode(solidLayer(200, 100, 30, 15), RES, RES, 3)
	assert.ok(Math.abs(s[0] - 200) <= 1 && Math.abs(s[1] - 100) <= 1 && Math.abs(s[2] - 30) <= 1 && s[3] === 255, `${[...s.subarray(0, 4)]}`)
	for (let i = 4; i < s.length; i += 4) assert.ok(s[i] === s[0] && s[i + 1] === s[1] && s[i + 2] === s[2] && s[i + 3] === 255)
})
