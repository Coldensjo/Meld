// Run with: bun test tests/textureFrom.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { textureFrom } from '../src/lib/wow/textureReply.ts'

/** A texture reply as Go's TextureDXT writes it: magic, size, mip count, then each level's bytes. */
function dxtReply(kind: number, w: number, h: number, levels: number[][]) {
	const size = 16 + levels.reduce((n, l) => n + 4 + l.length, 0)
	const buf = new ArrayBuffer(size)
	const dv = new DataView(buf)
	'DXT'.split('').forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)))
	dv.setUint8(3, 48 + kind)
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

test('a DXT reply becomes a compressed texture with the BLP’s own mips', () => {
	const buf = dxtReply(5, 8, 4, [new Array(32).fill(1), new Array(16).fill(2), new Array(16).fill(3), new Array(16).fill(4)])
	const t = textureFrom(buf) as THREE.CompressedTexture
	assert.ok(t.isCompressedTexture)
	assert.equal(t.format, THREE.RGBA_S3TC_DXT5_Format)
	assert.equal(t.generateMipmaps, false)
	const mips = t.mipmaps as unknown as { data: Uint8Array; width: number; height: number }[]
	assert.deepEqual(
		mips.map((m) => [m.width, m.height, m.data.length, m.data[0]]),
		[
			[8, 4, 32, 1],
			[4, 2, 16, 2],
			[2, 1, 16, 3],
			[1, 1, 16, 4],
		],
	)
	assert.equal(textureFrom(dxtReply(1, 4, 4, [new Array(8).fill(0), [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]])).format, THREE.RGBA_S3TC_DXT1_Format)
})

test('an RGBA reply stays a data texture whose mips the GPU makes', () => {
	const buf = new ArrayBuffer(12 + 2 * 1 * 4)
	const dv = new DataView(buf)
	'RGBA'.split('').forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)))
	dv.setUint32(4, 2, true)
	dv.setUint32(8, 1, true)
	new Uint8Array(buf, 12).set([1, 2, 3, 4, 5, 6, 7, 8])
	const t = textureFrom(buf) as THREE.DataTexture
	assert.ok(t.isDataTexture)
	assert.equal(t.generateMipmaps, true)
	assert.deepEqual(Array.from(t.image.data as Uint8Array), [1, 2, 3, 4, 5, 6, 7, 8])
	assert.equal(t.image.width, 2)
})
