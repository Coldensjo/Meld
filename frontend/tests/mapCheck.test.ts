// Run with: bun test tests/mapCheck.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PER_CHECK, capped, type Finding } from '../src/lib/check/findings.ts'
import { checkDuplicateModels, checkModelHeights, type CheckModel } from '../src/lib/check/models.ts'
import { checkPaths, checkSpawnIds, checkSpawns, checkSpawnsInModels, type IdSpawn, type SpawnProbes } from '../src/lib/check/spawns.ts'
import { checkHiddenWater, checkPalette, checkRegionEdges, checkZones } from '../src/lib/check/terrainChecks.ts'
import { NO_TEXTURE, SLOTS } from '../src/lib/terrain/chunkPaint.ts'

const model = (id: number, over: Partial<CheckModel> = {}): CheckModel => ({ id, type: 'm2:crate', name: 'Crate', x: 10, z: 10, yOff: 0, rotY: 0, scale: 1, box: null, ...over })
const box = (x: number, y: number, z: number, w = 1, h = 1): CheckModel['box'] => ({ min: [x - w, y, z - w], max: [x + w, y + h, z + w] })

test('duplicates: same type, spot, turn and size are one finding, deleting all but the first', () => {
	const found = checkDuplicateModels([model(1), model(2), model(3, { x: 10.01 }), model(4, { x: 12 }), model(5, { rotY: 1 }), model(6, { type: 'm2:barrel' })])
	assert.equal(found.length, 1)
	assert.deepEqual(found[0].target, { kind: 'models', ids: [2, 3] })
	assert.equal(found[0].fix, 'deleteModels')
	// Twins either side of a cell edge are still found, in x, z and diagonally.
	assert.equal(checkDuplicateModels([model(1, { x: 10.999 }), model(2, { x: 11.001 })]).length, 1)
	assert.equal(checkDuplicateModels([model(1, { x: 10.249 }), model(2, { x: 10.251 })]).length, 1)
	assert.equal(checkDuplicateModels([model(1, { x: 10.999, z: 10.999 }), model(2, { x: 11.001, z: 11.001 })]).length, 1)
	// A turn all the way round is the same turn.
	assert.equal(checkDuplicateModels([model(1, { rotY: 0 }), model(2, { rotY: Math.PI * 2 })]).length, 1)
	// Attached to different parents, they are different placements.
	assert.equal(checkDuplicateModels([model(1, { parent: 7 }), model(2, { parent: 8 })]).length, 0)
})

test('model heights: floating without support, buried under the ground, attached left alone', () => {
	const flat = () => 0
	const found = checkModelHeights(
		[
			model(1, { box: box(10, 0, 10) }), // on the ground
			model(2, { box: box(30, 5, 30) }), // floating
			model(3, { box: box(50, -5, 50, 1, 2) }), // buried: top at -3
			model(4, { box: box(70, 5, 70), parent: 9 }), // attached
			model(5, { box: box(90, 0, 90, 4, 6) }), // a table...
			model(6, { box: box(90, 6, 90, 0.5, 1) }), // ...and the lamp on it
			model(7, { box: null }), // not loaded yet
			model(8, { box: box(110, 20, 110) }), // a bird, high up
			model(10, { box: box(130, 2, 130) }), // a lily pad on water
		],
		flat,
		(x) => x === 130,
	)
	assert.deepEqual(
		found.map((f) => [f.check, (f.target as { ids: number[] }).ids[0]]),
		[
			['Floating models', 2],
			['Floating models', 8],
			['Buried models', 3],
		],
	)
	assert.deepEqual(
		found.map((f) => f.severity),
		['warning', 'info', 'warning'],
	)
	// Over a hole everywhere, nothing is reported.
	assert.equal(checkModelHeights([model(2, { box: box(30, 5, 30) })], () => -Infinity).length, 0)
})

const probes = (over: Partial<SpawnProbes> = {}): SpawnProbes => ({
	ground: () => 0,
	slope: () => 0,
	deepWater: () => false,
	floorNear: () => false,
	wallBetween: () => false,
	...over,
})

test('spawns: under the ground, unless a floor is there; steep and deep water for creatures only', () => {
	const s = (key: string, y: number, kind = 'monster') => ({ key, name: key, kind, x: 0, y, z: 0 })
	assert.deepEqual(
		checkSpawns([s('a', -3), s('b', 0), s('c', -1.5)], probes(), 50, 2).map((f) => f.target),
		[{ kind: 'spawn', key: 'a' }],
	)
	assert.equal(checkSpawns([s('a', -3)], probes({ floorNear: () => true }), 50, 2).length, 0)
	// On a 45° slope, half a cell (1 yd here) more is allowed: 2.5 under is fine, 3.5 isn't.
	assert.equal(checkSpawns([s('a', -2.5)], probes({ slope: () => 45 }), 70, 2).length, 0)
	assert.equal(checkSpawns([s('a', -3.5)], probes({ slope: () => 45 }), 50, 2)[0].check, 'Spawns under the ground')
	const steep = checkSpawns([s('a', 0), s('o', 0, 'object')], probes({ slope: () => 60 }), 50, 2)
	assert.deepEqual(
		steep.map((f) => f.check),
		['Spawns on steep ground'],
	)
	const wet = checkSpawns([s('a', 0)], probes({ deepWater: () => true }), 50, 2)
	assert.equal(wet[0].check, 'Spawns in deep water')
	// Standing high on a building, the ground's slope and water don't matter.
	assert.equal(checkSpawns([s('a', 20)], probes({ slope: () => 80, deepWater: () => true }), 50, 2).length, 0)
})

test('paths: a point under the ground, a stretch dipping under a hill, and one through a wall', () => {
	const hill = (x: number) => (x > 8 && x < 12 ? 5 : 0)
	const path = [
		{ x: 0, y: 0, z: 0 },
		{ x: 20, y: 0, z: 0 },
		{ x: 20, y: -4, z: 10 },
	]
	const found = checkPaths([{ key: 'k', name: 'Wolf', kind: 'monster', x: 0, y: 0, z: 0, path }], probes({ ground: (x) => hill(x), wallBetween: (a, b) => a.x === 20 && b.x === 20 }), 2)
	assert.deepEqual(
		found.map((f) => f.message),
		["Wolf's path point 3 is under the ground.", "Wolf's path goes under the ground between points 1 and 2.", "Wolf's path passes through a building between points 2 and 3."],
	)
})

test('zones: none reported for a map without zones; unzoned and unknown chunks otherwise', () => {
	assert.equal(checkZones([0, 0, 0, 0], 2, 33, null).length, 0)
	const found = checkZones([12, 0, 12, 99], 2, 10, (id) => id === 12)
	assert.deepEqual(
		found.map((f) => [f.check, f.x, f.z]),
		[
			['Chunks without a zone', 15, 5],
			['Unknown zones', 15, 15],
		],
	)
})

test('palette: unused entries, and textures the client lacks at the first chunk using them', () => {
	const slots = new Uint8Array(4 * SLOTS).fill(NO_TEXTURE)
	slots[0] = 0
	slots[2 * SLOTS] = 2
	const found = checkPalette(
		['Tileset\\A.blp', 'Tileset\\B.blp', 'Tileset\\Typo.blp', '#ff0000'],
		slots,
		(p) => !p.includes('Typo'),
		(c) => ({ x: c, z: 0 }),
	)
	assert.equal(found.length, 2)
	assert.match(found[0].message, /2 palette textures are painted nowhere: B\.blp, #ff0000/)
	assert.equal(found[1].severity, 'error')
	assert.deepEqual(found[1].target, { kind: 'chunk', chunk: 2 })
})

test('hidden water: a layer wholly under the ground is found, one partly above is not', () => {
	const cells = new Uint8Array(64)
	cells[0] = 1
	const low = { cells, heights: new Float32Array(81).fill(-1) }
	const high = { cells, heights: new Float32Array(81).fill(1) }
	const flat = () => 0
	assert.equal(checkHiddenWater(1, () => [low], flat, 16).length, 1)
	assert.equal(checkHiddenWater(1, () => [high], flat, 16).length, 0)
	assert.equal(checkHiddenWater(1, () => [low, high], flat, 16)[0].message, 'Chunk 0, 0 has a liquid layer wholly under the ground.')
})

test('a check lists at most MAX_PER_CHECK findings and counts the rest', () => {
	const many: Finding[] = Array.from({ length: MAX_PER_CHECK + 5 }, () => ({ check: 'x', severity: 'warning', message: '', x: 0, z: 0, target: { kind: 'none' } }))
	const out = capped('x', many)
	assert.equal(out.length, MAX_PER_CHECK + 1)
	assert.equal(out[MAX_PER_CHECK].message, '…and 5 more like these.')
})

test('a creature shut inside a solid model is found, an object is not', () => {
	const spawns = [
		{ key: 'monster/1', name: 'Wolf', kind: 'monster', x: 5, y: 0, z: 5 },
		{ key: 'object/2', name: 'Ore', kind: 'object', x: 5, y: 0, z: 5 },
		{ key: 'monster/3', name: 'Bear', kind: 'monster', x: 50, y: 0, z: 50 },
	]
	const seen: number[] = []
	const found = checkSpawnsInModels(spawns, (x, y) => {
		seen.push(y)
		return x < 10 ? 'Rock01' : null
	})
	assert.equal(found.length, 1)
	assert.equal(found[0].target.kind === 'spawn' && found[0].target.key, 'monster/1')
	assert.ok(found[0].message.includes('Rock01'))
	assert.deepEqual(seen, [1, 1], 'looked at the chest, for creatures only')
})

test('a created spawn on a guid the database gave another entry would delete it', () => {
	const s = (guid: number, entry: number, created: boolean, kind = 'monster'): IdSpawn => ({ key: `${kind}/${guid}`, name: `S${guid}`, kind, guid, entry, created, x: 0, z: 0 })
	const found = checkSpawnIds([s(10, 299, true), s(11, 6, true), s(12, 6, false), s(13, 40, false), s(5, 77, true, 'object')], {
		creatures: [
			{ guid: 10, entry: 1, map: 0 },
			{ guid: 11, entry: 6, map: 0 },
		],
		objects: [{ guid: 5, entry: 9, map: 1 }],
		missingCreatureEntries: [40],
		missingObjectEntries: [],
	})
	const taken = found.filter((f) => f.check === 'Spawn guids taken')
	assert.deepEqual(
		taken.map((f) => f.severity),
		['error', 'info', 'error'],
	)
	assert.ok(taken[0].message.includes('creature 1 on map 0'))
	const missing = found.filter((f) => f.check === 'Spawns without a template')
	assert.equal(missing.length, 1)
	assert.ok(missing[0].message.includes('entry 40'))
})

test('a region edge off the client tile next to it is a seam, a matching one is not', () => {
	const V = 5
	const heights = new Float32Array(V * V).fill(10)
	heights[2] = 13 // the north row, vertex 2
	heights[1 * V + V - 1] = 10.2 // the east column, vertex 1
	const flat = new Array(V).fill(10)
	const found = checkRegionEdges(
		[
			{ side: 'north', offset: 0, heights: flat },
			{ side: 'east', offset: 0, heights: flat },
			{ side: 'south', offset: 0, heights: flat },
			{ side: 'west', offset: 0, heights: [10, 10, 10.04, 10, 10] },
		],
		heights,
		V,
		4,
	)
	assert.equal(found.length, 2)
	assert.equal(found[0].severity, 'error')
	assert.deepEqual([found[0].x, found[0].z], [8, 0])
	assert.equal(found[1].severity, 'warning')
	assert.deepEqual([found[1].x, found[1].z], [16, 4])
})
