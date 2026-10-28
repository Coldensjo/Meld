// Run with: bun test tests/paintRules.test.ts
// The paint rules on a real Terrain, the brush's paintPixel and TerrainStroke and the clipboard: the
// four-texture rule, undo and redo, copy and paste across palettes, and auto-paint on a 512-cell map.
// Ported from the old frontend/tests/browser/paint.html, which only a hand-run headless Chrome ran (#613);
// a Terrain needs no WebGL context to be built and painted.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Terrain } from '../src/lib/terrain/Terrain.ts'
import { NO_TEXTURE, SLOTS } from '../src/lib/terrain/chunkPaint.ts'
import { paintPixel, TerrainStroke } from '../src/lib/tools/brush.ts'
import { copyRegion, pasteRegion } from '../src/lib/world/clipboard.ts'
import { ObjectLayer } from '../src/lib/world/ObjectLayer.ts'

const PALETTE = ['#5d8a2f', '#3f6b25', '#7a5a3a', '#7d7a76', '#d2bb84', '#e8eef5', '#8b857c', '#a07a50']

function terrain(size: number, palette = PALETTE): Terrain {
	const t = new Terrain(size)
	t.setPalette(palette)
	return t
}

/** The chunks with more than four textures or a texture twice. */
function overFour(t: Terrain): number[] {
	const bad: number[] = []
	for (let c = 0; c < t.paintChunksPerSide ** 2; c++) {
		const used = [...t.chunkSlots.slice(c * SLOTS, c * SLOTS + SLOTS)].filter((v) => v !== NO_TEXTURE)
		if (used.length > 4 || new Set(used).size !== used.length) bad.push(c)
	}
	return bad
}

test('auto-paint keeps every chunk within four textures and every texel summing to 255', () => {
	const t = terrain(128)
	t.generate('hills', 7)
	t.autoPaint(0, true)
	assert.deepEqual(overFour(t), [])
	let off = 0
	for (let p = 0; p < t.splatRes * t.splatRes; p++) {
		if (t.weights[p * 4] + t.weights[p * 4 + 1] + t.weights[p * 4 + 2] + t.weights[p * 4 + 3] !== 255) off++
	}
	assert.equal(off, 0, 'texels not summing to 255')
})

test('a chunk takes three textures beside its first, refuses a fifth, and still paints one it has', () => {
	const t = terrain(128)
	assert.ok(paintPixel(t, 0, 1, 0.5), 'first extra texture')
	assert.ok(paintPixel(t, 0, 2, 0.5), 'second extra texture')
	assert.ok(paintPixel(t, 0, 3, 0.5), 'third extra texture')
	assert.equal(paintPixel(t, 0, 4, 0.5), false, 'a fifth texture is refused')
	assert.ok(paintPixel(t, 0, 2, 0.1), 'a texture the chunk has still paints')
	assert.equal(t.weights[0] + t.weights[1] + t.weights[2] + t.weights[3], 255)
	assert.deepEqual([...t.chunkSlots.slice(0, 4)], [0, 1, 2, 3])
})

test("undo and redo of a paint stroke restore the weights and the chunks' slots", () => {
	const t = terrain(128)
	for (const tex of [1, 2, 3]) paintPixel(t, 0, tex, 0.5)
	const before = { w: t.weights.slice(), s: t.chunkSlots.slice() }
	// Chunk 1 (its texels start at x 32) has room, so the stroke changes its slots.
	const rect = { x0: 32, z0: 0, x1: 47, z1: 0 }
	const stroke = new TerrainStroke(t, 'Test', { splat: true })
	stroke.reserveSplat(rect)
	for (let p = rect.x0; p <= rect.x1; p++) paintPixel(t, p, 6, 1)
	stroke.touchSplat(rect)
	const cmd = stroke.finish()
	const after = { w: t.weights.slice(), s: t.chunkSlots.slice() }
	assert.ok(cmd, 'the stroke is recorded')
	assert.notDeepEqual(after.s, before.s, 'the stroke changed the slots')
	cmd.undo()
	assert.deepEqual(t.weights, before.w, 'undo: weights')
	assert.deepEqual(t.chunkSlots, before.s, 'undo: slots')
	cmd.redo()
	assert.deepEqual(t.weights, after.w, 'redo: weights')
	assert.deepEqual(t.chunkSlots, after.s, 'redo: slots')
})

test('a paste into another palette adds the texture, keeps four a chunk in full chunks, and its undo puts the palette back', () => {
	const src = terrain(128, ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888', '#999999'])
	for (let p = 0; p < 64; p++) paintPixel(src, p, 8, 1) // the source's ninth texture, in one chunk
	const clip = copyRegion(src, new ObjectLayer(src), { x0: 0, z0: 0, x1: 16, z1: 16 }, src.palette.entries)
	assert.ok(clip.palette.includes('#999999'), 'the clip carries its texture')

	const dst = terrain(128)
	let palette = [...PALETTE]
	// Fill every chunk's free slots, so the paste has to fit into full chunks.
	for (let p = 0; p < dst.splatRes * dst.splatRes; p++) for (const tex of [1, 2, 3]) paintPixel(dst, p, tex, 0.3)
	const slots = dst.chunkSlots.slice()
	const cmd = pasteRegion(
		dst,
		new ObjectLayer(dst),
		palette,
		(next) => (palette = next),
		clip,
		4,
		4,
		{ terrain: false, textures: true, objects: false, blend: 0, heightOffset: 0 },
		() => {},
	)
	assert.ok(cmd, 'the paste applies')
	assert.ok(palette.includes('#999999'), 'the palette gains the clip texture')
	assert.deepEqual(overFour(dst), [])
	cmd.undo()
	assert.deepEqual(palette, PALETTE, 'undo: palette')
	assert.deepEqual(dst.chunkSlots, slots, 'undo: slots')
})

test('auto-paint on a 512-cell map keeps four textures a chunk', () => {
	const t = terrain(512)
	t.generate('mountains', 11)
	t.autoPaint(0, true)
	assert.deepEqual(overFour(t), [])
})
