import { describe, expect, test } from 'bun:test'
import type { MapSnapshot } from '../src/lib/engine/Engine'
import { fromMapData, toMapData } from '../src/lib/io/mapData'
import type { mapfile } from '../wailsjs/go/models'

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

describe('the unknown state of liquids and chunk data (#525)', () => {
	test('a map opened without them keeps saying so across a save', () => {
		const m = fromMapData(reread(snapshot(false), 6))
		expect(m.liquidsKnown).toBe(false)
		expect(m.chunkDataKnown).toBe(false)
		// What was drawn since still comes back.
		expect(m.liquids).not.toBeNull()
		expect(m.chunkData).not.toBeNull()
	})

	test('a map that has them writes no flag and reads back as known', () => {
		const data = toMapData(snapshot(true))
		expect(data.liquidsUnknown).toBeUndefined()
		expect(data.chunkDataUnknown).toBeUndefined()
		const m = fromMapData(reread(snapshot(true), 6))
		expect(m.liquidsKnown).toBe(true)
		expect(m.chunkDataKnown).toBe(true)
	})

	test('a file older than the blobs opens without them', () => {
		const v3 = fromMapData(reread(snapshot(true), 3))
		expect(v3.liquids).toBeNull()
		expect(v3.liquidsKnown).toBe(false)
		expect(v3.chunkDataKnown).toBe(false)
		const v4 = fromMapData(reread(snapshot(true), 4))
		expect(v4.liquidsKnown).toBe(true)
		expect(v4.chunkData).toBeNull()
		expect(v4.chunkDataKnown).toBe(false)
	})
})
