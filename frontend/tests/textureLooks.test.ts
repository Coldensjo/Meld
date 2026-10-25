// Run with: bun test tests/textureLooks.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lookFlags, lookOf, looksByIndex } from '../src/lib/world/textureLooks.ts'
import { mapToTiles } from '../src/lib/io/vmangosExport.ts'

test('a look round-trips through the layer flags the tile keeps', () => {
	// Burning Steppes' lava in the client: 0xf2 is scrolling at speed 6, turned 90 degrees, overbright.
	assert.deepEqual(lookOf(0xf2), { animate: true, turn: 2, speed: 6, overbright: true })
	assert.equal(lookFlags(lookOf(0xf2)), 0xf2)
	assert.equal(lookFlags({ animate: false, turn: 0, speed: 0, overbright: false }), 0)
})

test("the export sends a chunk's flags only when the map sets a look, -1 keeping the tile's own", () => {
	const lava = 'Tileset\Lava.blp'
	const rock = 'Tileset\Rock.blp'
	const palette = [rock, lava]
	assert.deepEqual(looksByIndex(palette, { [lava]: 0xf2 }), [-1, 0xf2])
	const size = 128
	const splat = size * 8
	const chunkSlots = new Uint8Array((size / 8) ** 2 * 4).fill(255)
	chunkSlots[0] = 0
	chunkSlots[1] = 1
	const weights = new Uint8Array(splat * splat * 4)
	for (let i = 0; i < splat * splat; i++) weights[i * 4] = 255
	const base = { size, cellSize: 2, heights: new Float32Array((size + 1) ** 2), weights, chunkSlots, palette, objects: [], waterEnabled: false, waterLevel: 0 }
	const plain = mapToTiles(base).tiles[0].Paint[0]
	assert.equal(plain.Flags, undefined)
	const looked = mapToTiles({ ...base, looks: looksByIndex(palette, { [lava]: 0xf2 }) }).tiles[0].Paint[0]
	assert.deepEqual(looked.Flags, [-1, 0xf2])
})
