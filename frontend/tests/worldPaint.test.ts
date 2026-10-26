// Run with: bun test tests/worldPaint.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NO_TEXTURE, SLOTS } from '../src/lib/terrain/chunkPaint.ts'
import { PAINT_SIDE, PaletteSlots, parsePaint, sharedSlots } from '../src/lib/world/worldPaint.ts'

const CHUNKS = 16 * 16

/** A /wow/groundpaint reply (wow.EncodePaint) naming `names`, with chunk slots `slots` and weights `w(i)` a byte. */
function reply(names: string[], slots: Uint8Array, w: (i: number) => number): ArrayBuffer {
	const enc = new TextEncoder()
	const bytes = names.map((n) => enc.encode(n))
	const head = 6 + bytes.reduce((a, b) => a + 2 + b.length, 0)
	const buf = new ArrayBuffer(head + slots.length + PAINT_SIDE * PAINT_SIDE * SLOTS)
	const u = new Uint8Array(buf)
	const v = new DataView(buf)
	u.set([...'PANT'].map((c) => c.charCodeAt(0)))
	v.setUint16(4, names.length, true)
	let at = 6
	for (const b of bytes) {
		v.setUint16(at, b.length, true)
		u.set(b, at + 2)
		at += 2 + b.length
	}
	u.set(slots, at)
	for (let i = head + slots.length; i < buf.byteLength; i++) u[i] = w(i - head - slots.length)
	return buf
}

test('a paint reply reads back as its names, slots and weights, and a bad one is refused', () => {
	const slots = new Uint8Array(CHUNKS * SLOTS).fill(NO_TEXTURE)
	slots.set([1, 0], 37 * SLOTS)
	const p = parsePaint(reply(['Tileset\\A.blp', 'Tileset\\Bé.blp'], slots, (i) => i % 7))
	assert.deepEqual(p.names, ['Tileset\\A.blp', 'Tileset\\Bé.blp'])
	assert.deepEqual([...p.slots.subarray(37 * SLOTS, 38 * SLOTS)], [1, 0, NO_TEXTURE, NO_TEXTURE])
	assert.equal(p.weights.length, PAINT_SIDE * PAINT_SIDE * SLOTS)
	assert.equal(p.weights[100], 100 % 7)
	assert.throws(() => parsePaint(new ArrayBuffer(12)))
	assert.throws(() => parsePaint(reply(['x'], slots, () => 0).slice(0, 4000)))
})

test('the painted tiles share a palette entry a texture, counted per use, and a full array reuses an unused entry before it grows', () => {
	const written: Array<[number, string]> = []
	const s = new PaletteSlots((i, path) => written.push([i, path]))
	assert.equal(s.acquire('A'), 0)
	// Another tile naming it (in any case) shares the entry and writes nothing.
	assert.equal(s.acquire('a'), 0)
	assert.equal(written.length, 1)
	for (let k = 1; k < 8; k++) assert.equal(s.acquire(`T${k}`), k)
	// Eight entries fill an array of 8: with none free it grows.
	assert.equal(s.acquire('N'), 8)
	s.release(0)
	assert.equal(s.usesOf(0), 1)
	s.release(0)
	// Not full at its depth (9 of 16): a new texture takes a new entry, and A's stays for a tile coming back.
	for (let k = 9; k < 16; k++) assert.equal(s.acquire(`U${k}`), k)
	assert.equal(s.acquire('A'), 0)
	s.release(0)
	// Full at 16: the unused entry 0 goes to the new texture, and A is no longer there.
	assert.equal(s.acquire('V'), 0)
	assert.deepEqual(written.at(-1), [0, 'V'])
	assert.equal(s.acquire('A'), 16)
})

test("a tile's slots name the shared entries, and a chunk with no layer shows the bare entry", () => {
	const slots = new Uint8Array(CHUNKS * SLOTS).fill(NO_TEXTURE)
	slots.set([1, 0, 2], 5 * SLOTS)
	const p = { names: ['a', 'b', 'c'], slots, weights: new Uint8Array(0) }
	const out = sharedSlots(p, [10, 20, 30], 7)
	assert.deepEqual([...out.subarray(5 * SLOTS, 6 * SLOTS)], [20, 10, 30, NO_TEXTURE])
	assert.deepEqual([...out.subarray(0, SLOTS)], [7, NO_TEXTURE, NO_TEXTURE, NO_TEXTURE])
})
