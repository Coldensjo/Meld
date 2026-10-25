// Run with: bun test tests/paletteBlocks.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	LAYER_BYTES,
	LEVELS,
	LEVEL_BYTES,
	LEVEL_SIDE,
	RES,
	blockResamplable,
	chainAlpha,
	chainColour,
	dxtLevels,
	encodeAlpha,
	encodeAlphaChain,
	encodeColour,
	encodeColourChain,
	levelOf,
	rgbaChain,
	solidLayer,
	writeAlpha,
	writeColour,
	type DxtLevel,
} from '../src/lib/terrain/paletteBlocks.ts'

/** Bytes of a layer's first level. */
const L0 = LEVEL_BYTES[0]

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
			const pal = four ? [p0, p1, p0.map((v, k) => Math.round((2 * v + p1[k]) / 3)), p0.map((v, k) => Math.round((v + 2 * p1[k]) / 3))] : [p0, p1, p0.map((v, k) => Math.round((v + p1[k]) / 2)), [0, 0, 0]]
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

/** Nearest resample to side² (RES² by default), as paletteArray.ts does it. */
function resample(px: Uint8Array, w: number, h: number, side = RES): Uint8Array {
	const out = new Uint8Array(side * side * 4)
	for (let y = 0; y < side; y++)
		for (let x = 0; x < side; x++) {
			const s = (Math.floor((y * h) / side) * w + Math.floor((x * w) / side)) * 4
			out.set(px.subarray(s, s + 4), (y * side + x) * 4)
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

/** A texture reply as `Client.TextureDXT` sends it: kind, size, level count, then each level. */
function reply(kind: 1 | 3, w: number, h: number, levels: Uint8Array[]): ArrayBuffer {
	const buf = new ArrayBuffer(16 + levels.reduce((a, l) => a + 4 + l.length, 0))
	const dv = new DataView(buf)
	;[68, 88, 84, 48 + kind].forEach((c, i) => dv.setUint8(i, c))
	dv.setUint32(4, w, true)
	dv.setUint32(8, h, true)
	dv.setUint32(12, levels.length, true)
	let o = 16
	for (const l of levels) {
		dv.setUint32(o, l.length, true)
		new Uint8Array(buf, o + 4, l.length).set(l)
		o += 4 + l.length
	}
	return buf
}

/** A full chain of random levels, w x h down to 1x1. */
function chain(kind: 1 | 3, w: number, h: number, mode: 'four' | 'any', seed: number): DxtLevel[] {
	const out: DxtLevel[] = []
	for (let lw = w, lh = h, i = 0; ; lw = Math.max(1, lw >> 1), lh = Math.max(1, lh >> 1), i++) {
		out.push(level(kind, lw, lh, blocks(lw, lh, kind, mode, seed + i)))
		if (lw === 1 && lh === 1) return out
	}
}

test('a texture reply gives its DXT levels, and none for RGBA or one cut short', () => {
	const ls = dxtLevels(reply(1, 8, 4, [new Uint8Array(16).fill(7), new Uint8Array(8).fill(8), new Uint8Array(8).fill(9)]))!
	assert.deepEqual(
		ls.map((l) => [l.kind, l.width, l.height, l.data.length, l.data[0]]),
		[
			[1, 8, 4, 16, 7],
			[1, 4, 2, 8, 8],
			[1, 2, 1, 8, 9],
		],
	)
	const cut = reply(1, 4, 4, [new Uint8Array(8)])
	new DataView(cut).setUint32(12, 2, true)
	assert.equal(dxtLevels(cut), null)
	const rgba = new ArrayBuffer(12 + 64)
	;[82, 71, 66, 65].forEach((c, i) => new DataView(rgba).setUint8(i, c))
	assert.equal(dxtLevels(rgba), null)
	assert.ok(blockResamplable(chain(1, 128, 256, 'four', 1)))
	assert.ok(!blockResamplable(chain(1, 128, 256, 'four', 1).slice(0, 8)))
	assert.ok(!blockResamplable(chain(1, 512, 512, 'four', 1)))
	assert.ok(!blockResamplable([level(1, 192, 256, new Uint8Array())]))
	assert.equal(LEVELS, 9)
	assert.equal(LAYER_BYTES, 87408)
})

test('a 256² tileset’s own mips become the layer’s levels, block for block', () => {
	const src = chain(1, 256, 256, 'four', 3)
	const out = new Uint8Array(LAYER_BYTES)
	chainColour(out, src)
	for (let k = 0; k < LEVELS; k++) {
		const lv = levelOf(out, k)
		for (let b = 0; b < lv.length / 16; b++) assert.deepEqual([...lv.subarray(b * 16 + 8, b * 16 + 16)], [...src[k].data.subarray(b * 8, b * 8 + 8)], `level ${k} block ${b}`)
	}
	const sheen = chain(3, 256, 256, 'any', 4)
	chainAlpha(out, sheen)
	for (let k = 0; k < LEVELS; k++) {
		const lv = levelOf(out, k)
		for (let b = 0; b < lv.length / 16; b++) assert.deepEqual([...lv.subarray(b * 16, b * 16 + 8)], [...sheen[k].data.subarray(b * 16, b * 16 + 8)], `alpha level ${k} block ${b}`)
	}
})

test('a smaller or oblong tileset fills the larger levels from its first and the rest from its own mips', () => {
	for (const [w, h] of [
		[128, 128],
		[64, 32],
		[128, 256],
	] as const) {
		const src = chain(1, w, h, 'four', w + h)
		const out = new Uint8Array(LAYER_BYTES)
		chainColour(out, src)
		const shift = Math.log2(RES / Math.max(w, h))
		for (let k = 0; k < LEVELS; k++) {
			const s = LEVEL_SIDE[k]
			const l = src[Math.max(0, k - shift)]
			// Below 4x4 a level is one block whose texels past the side are padding.
			const got = decode(levelOf(out, k), Math.max(4, s), Math.max(4, s), 3)
			const want = resample(decode(l.data, l.width, l.height, 1), l.width, l.height, s)
			for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) for (let c = 0; c < 3; c++) assert.equal(got[(y * Math.max(4, s) + x) * 4 + c], want[(y * s + x) * 4 + c], `${w}x${h} level ${k} at ${x},${y}`)
		}
	}
})

test('encoded layers get box-filtered mips, and a colour layer is one colour at every level', () => {
	const px = new Uint8Array(RES * RES * 4)
	for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) px.set([(x & 1) * 200, (y & 1) * 100, 60, ((x + y) & 1) * 255], (y * RES + x) * 4)
	const mips = rgbaChain(px)
	assert.equal(mips.length, LEVELS)
	assert.deepEqual([...mips[1].subarray(0, 4)], [100, 50, 60, 128])
	assert.deepEqual([...mips[LEVELS - 1]], [100, 50, 60, 128])
	const out = new Uint8Array(LAYER_BYTES)
	encodeColourChain(out, px)
	encodeAlphaChain(out, px)
	for (let k = 1; k < LEVELS; k++) {
		const s = Math.max(4, LEVEL_SIDE[k])
		const got = decode(levelOf(out, k), s, s, 3)
		assert.ok(Math.abs(got[0] - 100) <= 4 && Math.abs(got[1] - 50) <= 4 && Math.abs(got[2] - 60) <= 4, `level ${k}: ${[...got.subarray(0, 4)]}`)
		assert.equal(got[3], 136, `level ${k} alpha`)
	}
	const solid = solidLayer(200, 100, 30, 15)
	for (let k = 1; k < LEVELS; k++) assert.deepEqual([...levelOf(solid, k).subarray(0, 16)], [...levelOf(solid, 0).subarray(0, 16)])
})

test('a 256² four-colour DXT1 tileset is copied block for block', () => {
	const src = blocks(256, 256, 1, 'four', 1)
	const out = new Uint8Array(L0)
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
		const out = new Uint8Array(L0)
		writeColour(out, level(kind, w, h, src))
		const want = resample(decode(src, w, h, kind), w, h)
		assert.equal(maxDiff(decode(out, RES, RES, 3), want, [0, 1, 2]), 0, `${w}x${h} DXT${kind}`)
	}
})

test('DXT3 colour blocks with colour0 <= colour1 are flipped so either decode mode agrees', () => {
	const src = blocks(256, 256, 3, 'any', 5)
	const out = new Uint8Array(L0)
	writeColour(out, level(3, 256, 256, src))
	assert.equal(maxDiff(decode(out, RES, RES, 3), decode(src, 256, 256, 3), [0, 1, 2]), 0)
	for (let o = 8; o < L0; o += 16) {
		const c0 = out[o] | (out[o + 1] << 8)
		const c1 = out[o + 2] | (out[o + 3] << 8)
		const idx = out[o + 4] | out[o + 5] | out[o + 6] | out[o + 7]
		assert.ok(c0 > c1 || (c0 === c1 && idx === 0))
	}
	// So the output decodes the same read as DXT1 too.
	const asOne = new Uint8Array(L0 / 2)
	for (let b = 0; b < 64 * 64; b++) asOne.set(out.subarray(b * 16 + 8, b * 16 + 16), b * 8)
	assert.equal(maxDiff(decode(asOne, RES, RES, 1), decode(out, RES, RES, 3), [0, 1, 2]), 0)
})

test('three-colour DXT1 blocks keep their colours: exactly with only the ends used, closely otherwise', () => {
	const src = blocks(256, 256, 1, 'three', 9)
	// The first half of the blocks use only the two ends.
	for (let o = 0; o < src.length / 2; o += 8) for (let k = 4; k < 8; k++) src[o + k] &= 0x55
	const out = new Uint8Array(L0)
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
		const out = new Uint8Array(L0)
		writeAlpha(out, level(3, size, size, src))
		assert.equal(maxDiff(decode(out, RES, RES, 3), resample(decode(src, size, size, 3), size, size), [3]), 0)
	}
})

test('RGBA pixels encode closely, and a colour entry comes within one step of its colour', () => {
	const px = new Uint8Array(RES * RES * 4)
	for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) px.set([x, y, (x + y) >> 1, (x * 7) & 255], (y * RES + x) * 4)
	const out = new Uint8Array(L0)
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
