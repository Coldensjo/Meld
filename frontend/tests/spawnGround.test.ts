// Run with: bun test tests/spawnGround.test.ts
// View › Ground overlay (#950): the creatures binned into the cells within GROUND_RADIUS of them, the
// monsters' average level and the density per cell, the sums kept up through moves, level edits and
// deletes, the bytes the shader reads, the cells straying from their zone's level, and the legend.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import type { vmangos } from '../src/lib/wails/models'
import { COUNT_MAX, DENSITY_RAMP, GROUND_CROWD, GROUND_RADIUS, LEVEL_SCALE, STRAY_BIT, SpawnGround, chunkZoneLevels, densityColor, groundLegend } from '../src/lib/world/spawnGround'
import { LEVEL_RAMP } from '../src/lib/world/spawnColors'

function spawn(kind: string, x: number, z: number, level: number, extra: Partial<vmangos.WorldSpawn> = {}): vmangos.WorldSpawn {
	return { kind, guid: 1, entry: 1, name: 'x', x, y: 0, z, orientation: 0, model: '', waypoints: [], levelMin: level, levelMax: level, faction: 0, rank: 0, ...extra } as Partial<vmangos.WorldSpawn> as vmangos.WorldSpawn
}

// 64 cells of 4 yd (256 yd a side), in chunks of 8 cells.
const N = 64
const CS = 4
const cell = (x: number, z: number) => Math.floor(z / CS) * N + Math.floor(x / CS)

test('a monster counts in the cells within the radius and not past it', () => {
	const g = new SpawnGround(N, CS, 8)
	const m = spawn('monster', 128, 128, 10)
	assert.equal(g.sync([m]), true)
	assert.equal(g.count[cell(128, 128)], 1)
	assert.equal(g.levelAt(cell(128, 128)), 10)
	// A cell whose centre is just inside the radius counts; one just outside does not.
	assert.equal(g.count[cell(128 + GROUND_RADIUS - 3, 128)], 1)
	assert.equal(g.count[cell(128 + GROUND_RADIUS + 3, 128)], 0)
	assert.equal(g.count[cell(128 + 30, 128 + 30)], 0, 'the corner of the square is outside the circle')
	// Nothing changed: no work, and no dirty cells after the encode.
	g.encode(new Uint8Array(N * N * 4))
	assert.equal(g.sync([m]), false)
	assert.equal(g.dirty, null)
})

test('the average is the monsters’ levels; NPCs count in the density only; game objects not at all', () => {
	const g = new SpawnGround(N, CS, 8)
	g.sync([spawn('monster', 100, 100, 6), spawn('monster', 104, 100, 10), spawn('npc', 100, 104, 60), spawn('object', 100, 100, 0)])
	const i = cell(102, 102)
	assert.equal(g.levelAt(i), 8)
	assert.equal(g.count[i], 3)
	assert.equal(g.levelCount[i], 2)
})

test('a move, a level edit and a delete change only what the spawn added', () => {
	const g = new SpawnGround(N, CS, 8)
	const a = spawn('monster', 60, 60, 5)
	const b = spawn('monster', 200, 200, 20)
	g.sync([a, b])
	g.encode(new Uint8Array(N * N * 4))
	a.x = 70
	assert.equal(g.update([a]), true)
	assert.equal(g.count[cell(30, 60)], 0, 'left behind where it stood')
	assert.equal(g.count[cell(100, 60)], 1, 'counted where it went')
	assert.ok(g.dirty && g.dirty.x1 < cell(200 - GROUND_RADIUS, 0), 'the far monster’s cells are not marked')
	a.levelMin = a.levelMax = 9
	g.update([a])
	assert.equal(g.levelAt(cell(70, 60)), 9)
	// Deleted: a sync without it takes it out.
	g.sync([b])
	assert.equal(g.count[cell(70, 60)], 0)
	assert.equal(g.levelCount[cell(70, 60)], 0)
	assert.equal(g.size, 1)
	// A spawn the filter leaves out (an event not shown) is taken out too.
	g.sync([b], () => false)
	assert.equal(g.count[cell(200, 200)], 0)
	assert.ok(g.count.every((c) => c === 0) && g.levelCount.every((c) => c === 0))
})

test('encode packs the level at a quarter level and the density with the stray bit', () => {
	const g = new SpawnGround(N, CS, 8)
	const crowd = Array.from({ length: 200 }, () => spawn('monster', 20, 20, 7.5))
	g.sync([...crowd, spawn('monster', 200, 200, 12)])
	// One zone of level 3 over the whole map, hatched past 2 levels.
	g.setZones(new Int16Array(64).fill(3), 2)
	const out = new Uint8Array(N * N * 4)
	g.encode(out)
	const i = cell(20, 20)
	assert.equal(out[i * 4 + 2], 7.5 * LEVEL_SCALE)
	assert.equal(out[i * 4 + 3], COUNT_MAX | STRAY_BIT, 'the count is capped below the stray bit')
	const j = cell(200, 200)
	assert.equal(out[j * 4 + 2], 12 * LEVEL_SCALE)
	assert.equal(out[j * 4 + 3], 1 | STRAY_BIT)
	assert.equal(out[cell(120, 120) * 4 + 3], 0, 'no creature near: nothing')
	// The red and green channels (the Map data overlay's and the area shape's) are left alone.
	assert.ok(out.every((v, k) => k % 4 > 1 || v === 0))
	// Within the stray: not hatched; the stray off: never.
	g.setZones(new Int16Array(64).fill(10), 2)
	g.encode(out)
	assert.equal(out[j * 4 + 3], 1)
	assert.equal(out[i * 4 + 3], COUNT_MAX | STRAY_BIT)
	g.setZones(new Int16Array(64).fill(10), 0)
	g.encode(out)
	assert.equal(out[i * 4 + 3], COUNT_MAX)
})

test('a chunk without a zone level compares with nothing', () => {
	const g = new SpawnGround(N, CS, 8)
	g.sync([spawn('monster', 20, 20, 30)])
	const levels = new Int16Array(64)
	g.setZones(levels, 1)
	assert.equal(g.strays(5, 5), false)
})

test('chunkZoneLevels takes a subzone’s own level, else its zone’s', () => {
	const levels = new Map([
		[12, 10],
		[87, 0],
		[9, 5],
	])
	const parents = new Map([
		[87, 12],
		[9, 12],
	])
	assert.deepEqual([...chunkZoneLevels(new Uint32Array([0, 12, 87, 9, 400]), levels, parents)], [0, 10, 10, 5, 0])
})

test('the density ramp runs from one creature to a crowd, and the legend lists both ramps', () => {
	assert.equal(densityColor(1), DENSITY_RAMP[0])
	assert.equal(densityColor(GROUND_CROWD), DENSITY_RAMP.at(-1))
	assert.equal(densityColor(GROUND_CROWD * 4), DENSITY_RAMP.at(-1))
	const d = groundLegend('density', [0, 0])
	assert.equal(d.length, 5)
	assert.match(d.at(-1)!.label, /or more/)
	const l = groundLegend('level', [1, 11])
	assert.equal(l[0].color, LEVEL_RAMP[0])
	assert.equal(l.at(-1)!.color, LEVEL_RAMP.at(-1))
	assert.match(l[0].label, /Level 1 and below/)
	assert.match(l.at(-1)!.label, /Level 11 and above/)
	assert.deepEqual(groundLegend('level', [0, 0]), [])
	assert.equal(groundLegend('level', [4, 4]).length, 1)
	assert.deepEqual(groundLegend('off', [1, 11]), [])
})
