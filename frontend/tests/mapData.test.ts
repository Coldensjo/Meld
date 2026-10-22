import { describe, expect, test } from 'bun:test'
import type { MapSnapshot } from '../src/lib/engine/Engine'
import { dropOrphanParents, fromMapData, toMapData } from '../src/lib/io/mapData'
import type { mapfile } from '../wailsjs/go/models'
import { encodeLiquids, LIQUID_MAGMA, liquidKindsOf, LiquidMap, liquidType, newLayer, rememberLiquidKinds, tileLiquidType } from '../src/lib/water/liquids'

const SIZE = 16
const CHUNKS = (SIZE / 8) ** 2

function snapshot(known: boolean): MapSnapshot {
	return {
		name: 'test',
		size: SIZE,
		cellSize: 4,
		splatRes: 64,
		waterLevel: 0,
		waterEnabled: false,
		objects: [],
		region: { mapName: 'Azeroth', x: 32, y: 48, size: 1 },
		vmangos: null,
		palette: ['#5d8a2f'],
		roles: null,
		textureEffects: {},
		textureLooks: {},
		scopedEffects: { zones: {}, tiles: {} },
		reference: null,
		paths: [],
		heights: new Uint8Array((SIZE + 1) ** 2 * 4),
		weights: new Uint8Array(64 * 64 * 4),
		chunkSlots: new Uint8Array(CHUNKS * 4),
		holes: new Uint8Array(SIZE * SIZE),
		holesKnown: known,
		// No layers: a map that holds no liquids of its own.
		liquids: new Uint8Array(4),
		liquidsKnown: known,
		chunkData: { areaIds: new Uint32Array(CHUNKS), chunkFlags: new Uint8Array(CHUNKS), noEffect: new Uint8Array(SIZE * SIZE) },
		chunkDataKnown: known,
		shadows: null,
	}
}

/** The map as Go hands it back after a save: the JSON header and blobs, read as the given version. */
function reread(s: MapSnapshot, version: number): mapfile.MapData {
	return { ...JSON.parse(JSON.stringify(toMapData(s))), version } as mapfile.MapData
}

describe('the unknown state of holes, liquids and chunk data (#525, #663)', () => {
	test('a map opened without them keeps saying so across a save', () => {
		const m = fromMapData(reread(snapshot(false), 6))
		expect(m.holesKnown).toBe(false)
		expect(m.liquidsKnown).toBe(false)
		expect(m.chunkDataKnown).toBe(false)
		// What was drawn since still comes back.
		expect(m.liquids).not.toBeNull()
		expect(m.chunkData).not.toBeNull()
	})

	test('a map that has them writes no flag and reads back as known', () => {
		const data = toMapData(snapshot(true))
		expect(data.holesUnknown).toBeUndefined()
		expect(data.liquidsUnknown).toBeUndefined()
		expect(data.chunkDataUnknown).toBeUndefined()
		const m = fromMapData(reread(snapshot(true), 6))
		expect(m.holesKnown).toBe(true)
		expect(m.liquidsKnown).toBe(true)
		expect(m.chunkDataKnown).toBe(true)
	})

	test('a file older than the blobs opens without them', () => {
		// Version 2 has no holes blob: opened and saved again, it still keeps the client's holes.
		const v2 = fromMapData({ ...reread(snapshot(true), 2), holes: '' } as mapfile.MapData)
		expect(v2.holes.length).toBe(0)
		expect(v2.holesKnown).toBe(false)
		expect(fromMapData(reread({ ...v2, holes: new Uint8Array(SIZE * SIZE) }, 6)).holesKnown).toBe(false)
		const v3 = fromMapData(reread(snapshot(true), 3))
		expect(v3.holesKnown).toBe(true)
		expect(v3.liquids).toBeNull()
		expect(v3.liquidsKnown).toBe(false)
		expect(v3.chunkDataKnown).toBe(false)
		const v4 = fromMapData(reread(snapshot(true), 4))
		expect(v4.liquidsKnown).toBe(true)
		expect(v4.chunkData).toBeNull()
		expect(v4.chunkDataKnown).toBe(false)
	})
})

describe("a liquid layer's kind (#540)", () => {
	// 30 is a row no client table here holds: a building's liquid of another client.
	test('a layer of an ID the table lacks keeps its kind across a save, and draws and exports as it', () => {
		rememberLiquidKinds({ 30: 'magma' })
		const map = new LiquidMap(SIZE)
		const l = newLayer(30, 5)
		l.cells.fill(1)
		map.set(0, [l])
		const kinds = liquidKindsOf(map)
		expect(kinds).toEqual({ 30: 'magma' })
		const data = reread({ ...snapshot(true), liquids: encodeLiquids(map), liquidKinds: kinds }, 6)
		expect(data.liquidKinds).toEqual({ '30': 'magma' })
		const back = fromMapData(data)
		expect(back.liquidKinds).toEqual({ 30: 'magma' })
		rememberLiquidKinds(back.liquidKinds)
		expect(liquidType(30).kind).toBe('magma')
		expect(tileLiquidType(30)).toBe(LIQUID_MAGMA)
	})

	test('a map without building liquids writes no kinds, and a bad entry is dropped on read', () => {
		expect(toMapData(snapshot(true)).liquidKinds).toBeUndefined()
		const raw = reread(snapshot(true), 6)
		raw.liquidKinds = { '2': 'slime', '31': 'lava', '300': 'slime', x: 'river', '32': 'slime' }
		expect(fromMapData(raw).liquidKinds).toEqual({ 32: 'slime' })
	})

	test('an ID whose kind is unknown is left out rather than saved as water', () => {
		const map = new LiquidMap(SIZE)
		const l = newLayer(99, 5)
		l.cells.fill(1)
		map.set(0, [l, { ...newLayer(1, 5), cells: new Uint8Array(64).fill(1) }])
		expect(liquidKindsOf(map)).toBeUndefined()
	})
})

describe('dropOrphanParents', () => {
	test('clears a parent that is not in the map and keeps a present one', () => {
		const objs = [
			{ id: 1, type: 'm2:a', parent: undefined as number | undefined },
			{ id: 2, type: 'm2:b', parent: 1 as number | undefined },
			{ id: 3, type: 'm2:c', parent: 99 as number | undefined },
			{ id: 4, type: 'm2:d', parent: 4 as number | undefined },
		]
		const warn = console.warn
		console.warn = () => {}
		try {
			dropOrphanParents(objs)
		} finally {
			console.warn = warn
		}
		expect(objs.map((o) => o.parent)).toEqual([undefined, 1, undefined, undefined])
	})
})
