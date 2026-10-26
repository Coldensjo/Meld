import { describe, expect, test } from 'bun:test'
import type { MapSnapshot } from '../src/lib/engine/Engine'
import { dropOrphanParents, fromMapData, toMapData } from '../src/lib/io/mapData'
import { bytesToBase64 } from '../src/lib/io/base64'
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

/** Bytes of a fixed pattern of the given length, so a blob that comes back shifted or cut shows. */
function ramp(n: number) {
	const b = new Uint8Array(n)
	for (let i = 0; i < n; i++) b[i] = (i * 7 + 3) & 255
	return b
}

/** A map with every optional field set, each to something other than its default (#431). */
function fullSnapshot(): MapSnapshot {
	const areaIds = new Uint32Array(CHUNKS)
	areaIds.set([12, 40, 0x01020304, 1])
	return {
		...snapshot(true),
		name: 'Full map',
		waterLevel: 3.5,
		waterEnabled: true,
		objects: [
			{ id: 1, type: 'wmo:World\\wmo\\Azeroth\\Buildings\\Stormwind\\Stormwind.wmo', x: 10, z: 20, yOff: 1.5, rotY: 0.25, scale: 1, uid: 4711 },
			{ id: 2, parent: 1, type: 'm2:World\\Generic\\Human\\Passive Doodads\\Barrel\\Barrel01.m2', x: -1, z: 2, yOff: 0, rotY: 1, tiltX: 0.1, tiltZ: -0.2, scale: 0.5, group: 3 },
			{ id: 3, type: 'helper:cube', x: 5, z: 5, yOff: 0, rotY: 0, scale: 2 },
		],
		region: { mapName: 'Kalimdor', x: 30, y: 31, size: 2 },
		vmangos: {
			dir: 'C:\\WoW\\vmangos\\data',
			mapId: 800,
			info: { type: 1, name: 'Test Dungeon', areaId: 12, loadingScreen: 3, maxPlayers: 5, ghostMap: 0, ghostX: 1.5, ghostY: -2.5, wmoOnly: true },
			tileX: 30,
			tileY: 61,
			tiles: '1101',
		},
		palette: ['Tileset\\Elwynn\\ElwynnGrassBase.blp', 'Tileset\\Elwynn\\ElwynnRock.blp', '#5d8a2f'],
		roles: { rock: 1, dirt: -1 },
		textureEffects: { 'Tileset\\Elwynn\\ElwynnGrassBase.blp': 41 },
		textureLooks: { 'Tileset\\Elwynn\\ElwynnRock.blp': 0x140 },
		scopedEffects: { zones: { '12': { 'Tileset\\Elwynn\\ElwynnGrassBase.blp': 7 } }, tiles: { '1,0': { 'Tileset\\Elwynn\\ElwynnRock.blp': 0 } } },
		reference: { path: 'C:\\maps\\sketch.png', mode: 'screen', opacity: 0.3, shown: false, x: 12, z: -4, w: 64, h: 32, turn: 0.5 },
		paths: [
			{
				id: 4,
				name: 'Old road',
				kind: 'road',
				points: [
					{ x: 0, y: 1, z: 2 },
					{ x: 10, y: 1.5, z: 20 },
				],
				width: 6,
				falloff: 4,
				grade: 8,
				texture: 'Tileset\\Elwynn\\ElwynnDirtBase.blp',
				edge: 1,
				depth: 2,
				liquid: 1,
				model: '',
				spacing: 0,
				turn: 0,
			},
			{ id: 9, name: 'Palisade', kind: 'fence', points: [{ x: 3, y: 0, z: 3 }], width: 2, falloff: 0, grade: 0, texture: '', edge: 0, depth: 1, liquid: 2, model: 'm2:World\\Fence.m2', spacing: 3, turn: 90 },
		],
		heights: ramp((SIZE + 1) ** 2 * 4),
		weights: ramp(64 * 64 * 4),
		chunkSlots: ramp(CHUNKS * 4),
		holes: ramp(SIZE * SIZE).map((v) => v & 3),
		liquids: ramp(4 + 418),
		liquidKinds: { 30: 'magma', 31: 'slime' },
		chunkData: { areaIds, chunkFlags: new Uint8Array([1, 0, 1, 0]), noEffect: ramp(SIZE * SIZE).map((v) => v & 1) },
		shadows: ramp(SIZE * SIZE * 8),
	}
}

describe('the .wmap snapshot round trip (#431, where #120 and #161 were)', () => {
	test('a map with every optional field set comes back as it went', () => {
		const s = fullSnapshot()
		expect(fromMapData(reread(s, 6))).toEqual(s)
	})

	test('a map with roles, a region and a server folder converts without the generated classes (#161)', () => {
		const data = toMapData(fullSnapshot())
		expect(data.roles).toEqual({ rock: 1, dirt: -1 })
		expect(data.region?.mapName).toBe('Kalimdor')
		expect(data.vmangos?.mapId).toBe(800)
		// The Map.dbc facts travel as the opaque JSON Go keeps.
		expect(JSON.parse(JSON.stringify(data)).vmangos.info.name).toBe('Test Dungeon')
	})

	test('a map with every optional field unset writes none of them and reads back their defaults', () => {
		const s: MapSnapshot = { ...snapshot(true), region: null, liquids: null, chunkData: null, shadows: null }
		const json = JSON.parse(JSON.stringify(toMapData(s))) as Record<string, unknown>
		for (const k of [
			'region',
			'vmangos',
			'roles',
			'textureEffects',
			'textureLooks',
			'zoneEffects',
			'tileEffects',
			'reference',
			'paths',
			'liquids',
			'liquidKinds',
			'areaIds',
			'chunkFlags',
			'noEffect',
			'shadows',
			'holesUnknown',
			'liquidsUnknown',
			'chunkDataUnknown',
		]) {
			expect(json[k]).toBeUndefined()
		}
		const m = fromMapData({ ...json, version: 6 } as unknown as mapfile.MapData)
		expect(m.region).toBeNull()
		expect(m.vmangos).toBeNull()
		expect(m.roles).toBeNull()
		expect(m.reference).toBeNull()
		expect(m.paths).toEqual([])
		expect(m.textureEffects).toEqual({})
		expect(m.textureLooks).toEqual({})
		expect(m.scopedEffects).toEqual({ zones: {}, tiles: {} })
		expect(m.liquidKinds).toEqual({})
		expect(m.shadows).toBeNull()
		// What Go hands back for a map saved without liquids or chunk data: empty blobs, never a throw (#120).
		expect(m.liquids?.length).toBe(0)
		expect(m.liquidsKnown).toBe(true)
		expect(m.chunkData?.areaIds.length).toBe(0)
		expect(m.chunkData?.noEffect.length).toBe(0)
	})

	test('a region with no liquids of its own opens (#120)', () => {
		const m = fromMapData(reread({ ...fullSnapshot(), liquids: new Uint8Array(4), liquidKinds: undefined }, 6))
		expect(m.region).toEqual({ mapName: 'Kalimdor', x: 30, y: 31, size: 2 })
		expect(m.liquids).toEqual(new Uint8Array(4))
		expect(m.liquidKinds).toEqual({})
	})

	test('a server folder with partial map facts fills the rest from the defaults', () => {
		const m = fromMapData({ ...reread(snapshot(true), 6), vmangos: { dir: 'd', mapId: 5, info: { name: 'Old' } } } as unknown as mapfile.MapData)
		expect(m.vmangos).toEqual({ dir: 'd', mapId: 5, info: { type: 0, name: 'Old', areaId: 0, loadingScreen: 0, maxPlayers: 0, ghostMap: -1, ghostX: 0, ghostY: 0 } })
		const none = fromMapData({ ...reread(snapshot(true), 6), vmangos: { dir: 'd', mapId: 5 } } as unknown as mapfile.MapData)
		expect(none.vmangos).toEqual({ dir: 'd', mapId: 5, info: undefined })
	})

	// A map saved before objects had ids (97042e4) holds none: they read as 0, and ObjectLayer.add gives
	// each a new one (objectLayer.test.ts), so the old fallback of 100000 + i is gone (#534).
	test('objects without ids read with id 0, and a zero parent or uid reads as none', () => {
		const m = fromMapData({
			...reread(snapshot(true), 6),
			objects: [
				{ type: 'm2:a.m2', x: 0, z: 0, yOff: 0, rotY: 0, scale: 1 },
				{ id: 0, parent: 0, uid: 0, type: 'm2:b.m2', x: 0, z: 0, yOff: 0, rotY: 0, scale: 1 },
			],
		} as unknown as mapfile.MapData)
		expect(m.objects.map((o) => o.id)).toEqual([0, 0])
		expect(m.objects.map((o) => [o.parent, o.uid])).toEqual([
			[undefined, undefined],
			[undefined, undefined],
		])
	})
})

/**
 * One file per readable version, as Go's mapfile.Read hands it to the frontend (the JSON of
 * mapfile.MapData: the header, the version it was read from, and the blobs that version has). Written
 * by hand from internal/mapfile's test streams (writeV1, writeOld), so a change to fromMapData that
 * stops reading an older file fails here (CLAUDE.md: change .wmap only by bumping Version).
 */
describe('every readable .wmap version opens (#431)', () => {
	const b64 = (n: number) => bytesToBase64(ramp(n))
	const header = {
		name: 'old',
		size: SIZE,
		cellSize: 4,
		splatRes: 64,
		waterLevel: 1,
		waterEnabled: true,
		objects: [{ id: 1, type: 'm2:World\\Tree.m2', x: 1, z: 2, yOff: 0, rotY: 0, scale: 1 }],
		heights: b64((SIZE + 1) ** 2 * 4),
	}
	const v2 = { ...header, palette: ['Tileset\\A.blp', '#808080'], weights: b64(64 * 64 * 4), chunkSlots: b64(CHUNKS * 4) }
	const v3 = { ...v2, holes: b64(SIZE * SIZE) }
	const v4 = { ...v3, liquids: b64(4 + 418) }
	const v5 = { ...v4, areaIds: b64(CHUNKS * 4), chunkFlags: b64(CHUNKS), noEffect: b64(SIZE * SIZE) }
	const v6 = { ...v5, shadows: b64(SIZE * SIZE * 8) }
	const open = (version: number, m: object) => fromMapData({ ...m, version } as unknown as mapfile.MapData)

	test('version 1: eight global layers, handed on as legacy for the conversion', () => {
		const m = open(1, { ...header, layerTextures: ['Tileset\\A.blp', '', '', '', '', '', '', ''], splatA: b64(64 * 64 * 4), splatB: b64(64 * 64 * 4) })
		expect(m.heights).toEqual(ramp((SIZE + 1) ** 2 * 4))
		expect(m.objects.length).toBe(1)
		expect(m.legacy?.layerTextures[0]).toBe('Tileset\\A.blp')
		expect(m.legacy?.splatA).toEqual(ramp(64 * 64 * 4))
		expect(m.legacy?.splatB.length).toBe(64 * 64 * 4)
		expect(m.palette).toEqual([])
		expect(m.weights.length).toBe(0)
		expect([m.holesKnown, m.liquids, m.liquidsKnown, m.chunkData, m.chunkDataKnown, m.shadows]).toEqual([false, null, false, null, false, null])
	})

	test('version 2: the palette, without holes', () => {
		const m = open(2, v2)
		expect(m.legacy).toBeUndefined()
		expect(m.palette).toEqual(['Tileset\\A.blp', '#808080'])
		expect(m.weights).toEqual(ramp(64 * 64 * 4))
		expect(m.chunkSlots).toEqual(ramp(CHUNKS * 4))
		expect(m.holes.length).toBe(0)
		expect([m.holesKnown, m.liquids, m.liquidsKnown, m.chunkData, m.chunkDataKnown, m.shadows]).toEqual([false, null, false, null, false, null])
	})

	test('version 3: holes, without liquids', () => {
		const m = open(3, v3)
		expect(m.holes).toEqual(ramp(SIZE * SIZE))
		expect([m.holesKnown, m.liquids, m.liquidsKnown, m.chunkData, m.chunkDataKnown]).toEqual([true, null, false, null, false])
	})

	test('version 4: liquids, without chunk data', () => {
		const m = open(4, v4)
		expect(m.liquids).toEqual(ramp(4 + 418))
		expect([m.liquidsKnown, m.chunkData, m.chunkDataKnown, m.shadows]).toEqual([true, null, false, null])
	})

	test('version 5: area IDs, chunk flags and no-effect cells, without shadows', () => {
		const m = open(5, v5)
		expect(m.chunkData?.areaIds).toEqual(new Uint32Array(ramp(CHUNKS * 4).buffer))
		expect(m.chunkData?.chunkFlags).toEqual(ramp(CHUNKS))
		expect(m.chunkData?.noEffect).toEqual(ramp(SIZE * SIZE))
		expect(m.chunkDataKnown).toBe(true)
		expect(m.shadows).toBeNull()
	})

	test('version 6: the baked shadows, and saved again it reads the same', () => {
		const m = open(6, v6)
		expect(m.shadows).toEqual(ramp(SIZE * SIZE * 8))
		expect([m.holesKnown, m.liquidsKnown, m.chunkDataKnown]).toEqual([true, true, true])
		expect(fromMapData(reread(m, 6))).toEqual(m)
	})

	test('version 7: a map made for the client keeps its place on the grid and its tiles (#46); one made before sits at the corner, whole', () => {
		const m = open(7, { ...v6, vmangos: { dir: 'Isle', mapId: 1900, tileX: 31, tileY: 30, tiles: '0111' } })
		expect(m.vmangos).toEqual({ dir: 'Isle', mapId: 1900, info: undefined, tileX: 31, tileY: 30, tiles: '0111' })
		expect(fromMapData(reread(m, 7))).toEqual(m)
		const old = open(6, { ...v6, vmangos: { dir: 'Isle', mapId: 1900 } })
		expect(old.vmangos).toEqual({ dir: 'Isle', mapId: 1900, info: undefined })
	})
})
