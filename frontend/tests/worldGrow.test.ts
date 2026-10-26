// Run with: bun test tests/worldGrow.test.ts
import { describe, expect, test } from 'bun:test'
import type { MapSnapshot } from '../src/lib/engine/Engine'
import { growSnapshot } from '../src/lib/io/worldGrow'
import { mapToTiles } from '../src/lib/io/vmangosExport'
import { NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../src/lib/terrain/chunkPaint'
import { LIQUID_RECORD_BYTES, TILE_CELLS, TILE_YARDS } from '../src/lib/wow/format'
import { base64ToFloats } from '../src/lib/io/base64'

/** A one-tile map: heights counting up, paint, a hole, a zone, a shadow texel, a liquid, a model on a model, a path and a tile's effect. */
function oneTile(): MapSnapshot {
	const C = TILE_CELLS
	const V = C + 1
	const h = new Float32Array(V * V)
	for (let i = 0; i < h.length; i++) h[i] = i
	const R = C * SPLAT_PER_CELL
	const weights = new Uint8Array(R * R * SLOTS)
	for (let i = 0; i < weights.length; i += SLOTS) weights[i + 1] = 255
	const chunks = (C / 8) ** 2
	const chunkSlots = new Uint8Array(chunks * SLOTS).fill(NO_TEXTURE)
	for (let c = 0; c < chunks; c++) chunkSlots[c * SLOTS + 1] = 2
	const holes = new Uint8Array(C * C)
	holes[3 * C + 5] = 1
	const areaIds = new Uint32Array(chunks)
	areaIds[17] = 12
	const liquids = new Uint8Array(4 + LIQUID_RECORD_BYTES)
	new DataView(liquids.buffer).setUint32(0, 1, true)
	new DataView(liquids.buffer).setUint32(4, 17, true)
	const shadowSide = C * 8
	const shadows = new Uint8Array((shadowSide * shadowSide) / 8)
	shadows[0] = 1
	return {
		name: 'Isle',
		size: C,
		cellSize: TILE_YARDS / C,
		splatRes: R,
		waterLevel: 0,
		waterEnabled: true,
		objects: [
			{ id: 1, type: 'm2:a.m2', x: 10, z: 20, yOff: 0, rotY: 0, scale: 1 },
			{ id: 2, parent: 1, type: 'm2:b.m2', x: 1, z: 2, yOff: 0, rotY: 0, scale: 1 },
		],
		region: null,
		vmangos: { dir: 'Isle', mapId: 1900, tileX: 31, tileY: 31 },
		palette: ['a', 'b', 'c'],
		roles: null,
		textureEffects: {},
		textureLooks: {},
		scopedEffects: { zones: {}, tiles: { '0,0': { a: 3 } } },
		reference: null,
		paths: [{ id: 1, name: 'r', kind: 'road', points: [{ x: 5, y: 0, z: 6 }], width: 2, falloff: 0, grade: 0, texture: '', edge: 0, depth: 0, liquid: 0, model: '', spacing: 0, turn: 0 }],
		heights: new Uint8Array(h.buffer),
		weights,
		chunkSlots,
		holes,
		holesKnown: true,
		liquids,
		liquidsKnown: true,
		chunkData: { areaIds, chunkFlags: new Uint8Array(chunks), noEffect: new Uint8Array(C * C) },
		chunkDataKnown: true,
		shadows,
	}
}

describe("growing a map made for the client to a bigger square (#46, Map Properties' tiles)", () => {
	test('the old square moves in whole, and the new tiles are flat, unpainted ground', () => {
		const s = oneTile()
		// The old tile becomes the north-east one of a 2×2 square: one tile in from the west.
		const g = growSnapshot(s, 1, 0, 2, -6)
		const C = TILE_CELLS
		expect(g.size).toBe(2 * C)
		expect(g.splatRes).toBe(2 * C * SPLAT_PER_CELL)
		const h = new Float32Array(g.heights.slice().buffer)
		const V = 2 * C + 1
		expect(h[0]).toBe(-6)
		// The old (0, 0) is now (C, 0), and its far corner (C, C) is (2C, C).
		expect(h[C]).toBe(0)
		expect(h[C * V + 2 * C]).toBe((C + 1) * (C + 1) - 1)
		// Paint: the new tile is slot 0 of palette 0, the old keeps slot 1 of palette 2.
		const R = g.splatRes
		expect([...g.weights.subarray(0, 4)]).toEqual([255, 0, 0, 0])
		expect([...g.weights.subarray((0 * R + C * SPLAT_PER_CELL) * 4, (0 * R + C * SPLAT_PER_CELL) * 4 + 4)]).toEqual([0, 255, 0, 0])
		const side = (2 * C) / 8
		expect([...g.chunkSlots.subarray(0, 4)]).toEqual([0, NO_TEXTURE, NO_TEXTURE, NO_TEXTURE])
		expect(g.chunkSlots[(0 * side + C / 8) * 4 + 1]).toBe(2)
		// The hole, the zone, the liquid's chunk and the shadow texel move with it.
		expect(g.holes[3 * 2 * C + 5 + C]).toBe(1)
		expect(g.holes.reduce((a, b) => a + b, 0)).toBe(1)
		const oldSide = C / 8
		const chunk17 = Math.floor(17 / oldSide) * side + (17 % oldSide) + C / 8
		expect(g.chunkData!.areaIds[chunk17]).toBe(12)
		expect(new DataView(g.liquids!.buffer).getUint32(4, true)).toBe(chunk17)
		const S = 2 * C * 8
		const bit = C * 8
		expect((g.shadows![bit >> 3] >> (bit & 7)) & 1).toBe(1)
		expect(g.shadows!.length).toBe((S * S) / 8)
		// The root model and the path move a tile east; the attached model stays on its parent.
		expect(g.objects.map((o) => [o.x, o.z])).toEqual([
			[10 + TILE_YARDS, 20],
			[1, 2],
		])
		expect(g.paths[0].points[0]).toEqual({ x: 5 + TILE_YARDS, y: 0, z: 6 })
		expect(g.scopedEffects.tiles).toEqual({ '1,0': { a: 3 } })
		// The snapshot it came from is left as it was.
		expect(s.size).toBe(C)
		expect(s.objects[0].x).toBe(10)
	})

	test('a square that does not hold the old one is refused', () => {
		expect(() => growSnapshot(oneTile(), 2, 0, 2, 0)).toThrow()
	})
})

describe("publishing a map's picked tiles where they are on the grid (#46)", () => {
	test("only the present tiles are written, numbered from the map's corner on the grid, and a model on a tile left out is counted outside", () => {
		const s = growSnapshot(oneTile(), 1, 0, 2, -6)
		const heights = new Float32Array(s.heights.slice().buffer)
		const input = {
			size: s.size,
			cellSize: s.cellSize,
			heights,
			weights: s.weights,
			chunkSlots: s.chunkSlots,
			palette: ['Tileset\\A.blp', 'Tileset\\B.blp', 'Tileset\\C.blp'],
			objects: [
				{ type: 'm2:a.m2', x: TILE_YARDS + 10, y: 0, z: 20, rotY: 0, scale: 1 },
				{ type: 'm2:b.m2', x: 10, y: 0, z: TILE_YARDS + 20, rotY: 0, scale: 1 },
			],
			waterEnabled: true,
			waterLevel: 0,
		}
		// The north-east and south-west tiles: an L of two.
		const out = mapToTiles(input, { x: 30, y: 31, present: new Uint8Array([0, 1, 1, 0]) })
		expect(out.tiles.map((t) => [t.X, t.Y])).toEqual([
			[31, 31],
			[30, 32],
		])
		expect(out.outside).toBe(0)
		const ne = out.tiles[0]
		expect(base64ToFloats(ne.Outer)[0]).toBe(0)
		expect(ne.Objects.map((o) => [o.X, o.Z])).toEqual([[10, 20]])
		// Leave the south-west tile out too: its model is outside.
		const one = mapToTiles(input, { x: 30, y: 31, present: new Uint8Array([0, 1, 0, 0]) })
		expect(one.tiles.length).toBe(1)
		expect(one.outside).toBe(1)
		// Without a layout every tile is written from 0,0, as before.
		expect(mapToTiles(input).tiles.map((t) => [t.X, t.Y])).toEqual([
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1],
		])
	})
})
