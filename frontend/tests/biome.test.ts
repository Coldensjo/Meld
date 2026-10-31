// Run with: bun test tests/biome.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { featherInside, newBiome, paintBiome, roleTextures, type BiomeGround } from '../src/lib/terrain/biome.ts'
import { CHUNK_CELLS, NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../src/lib/terrain/chunkPaint.ts'
import { History } from '../src/lib/state/historyCore.ts'
import { prefShapeOk } from '../src/lib/state/prefsPatch.ts'
import { biomeFromZone } from '../src/lib/wow/zoneBiome.ts'

const SIZE = 64
const CELL = 1600 / 3 / 128
const R = SIZE * SPLAT_PER_CELL
const SIDE = SIZE / CHUNK_CELLS
const PER = R / SIDE

/** A ground flat in the west and a steep ramp in the east, painted all over with palette entry 0. */
function ground(): BiomeGround {
	const V = SIZE + 1
	const heights = new Float32Array(V * V)
	for (let z = 0; z < V; z++) for (let x = 0; x < V; x++) heights[z * V + x] = x > SIZE / 2 ? (x - SIZE / 2) * CELL * 1.5 : 0
	const weights = new Uint8Array(R * R * SLOTS)
	for (let p = 0; p < R * R; p++) weights[p * SLOTS] = 255
	const chunkSlots = new Uint8Array(SIDE * SIDE * SLOTS).fill(NO_TEXTURE)
	for (let c = 0; c < SIDE * SIDE; c++) chunkSlots[c * SLOTS] = 0
	return { heights, size: SIZE, cellSize: CELL, splatRes: R, paintChunksPerSide: SIDE, weights, chunkSlots }
}

/** The palette index of the texel's heaviest slot. */
function dominant(g: BiomeGround, x: number, z: number): number {
	const c = Math.floor(z / PER) * SIDE + Math.floor(x / PER)
	const base = (z * R + x) * SLOTS
	let best = 0
	for (let k = 1; k < SLOTS; k++) if (g.weights[base + k] > g.weights[base + best]) best = k
	return g.chunkSlots[c * SLOTS + best]
}

// Base 1, lush 1 (as the base), dirt 2, rock 3, no sand or snow of their own.
const ROLE_TEX = [1, 1, 2, 3, 2, 3]
const PAINT = { roleTex: ROLE_TEX, rules: newBiome('t').rules, waterLevel: -100, waterEnabled: false, seed: 1 }

test('a biome paints only inside its mask, rock on the steep ground, and never more than four textures a chunk', () => {
	const g = ground()
	const before = g.weights.slice()
	const mask = new Uint8Array(R * R)
	// The middle half of the map, across the flat and the ramp.
	const rect = { x0: R / 4, z0: R / 4, x1: (3 * R) / 4 - 1, z1: (3 * R) / 4 - 1 }
	for (let z = rect.z0; z <= rect.z1; z++) for (let x = rect.x0; x <= rect.x1; x++) mask[z * R + x] = 255
	const r = paintBiome(g, mask, rect, PAINT)
	assert.ok(r.chunks > 0)
	assert.equal(r.replaced, 0)
	// Outside the mask's chunks, nothing changed.
	for (let z = 0; z < R / 4 - PER; z++) for (let x = 0; x < R; x++) for (let k = 0; k < SLOTS; k++) assert.equal(g.weights[(z * R + x) * SLOTS + k], before[(z * R + x) * SLOTS + k])
	// The flat inside is the base, the ramp inside rock.
	assert.equal(dominant(g, R / 4 + 4, R / 2), 1)
	assert.equal(dominant(g, (3 * R) / 4 - 4, R / 2), 3)
	// Outside the mask, in a chunk it doesn't reach, the old paint.
	assert.equal(dominant(g, 2, 2), 0)
	for (let c = 0; c < SIDE * SIDE; c++) {
		const used = new Set<number>()
		for (let k = 0; k < SLOTS; k++) if (g.chunkSlots[c * SLOTS + k] !== NO_TEXTURE) used.add(g.chunkSlots[c * SLOTS + k])
		assert.ok(used.size <= SLOTS)
	}
	for (let p = 0; p < R * R; p++) {
		let s = 0
		for (let k = 0; k < SLOTS; k++) s += g.weights[p * SLOTS + k]
		assert.equal(s, 255)
	}
})

test('a chunk with four textures already gives up its weakest to the biome, and says so', () => {
	const g = ground()
	// Chunk 0 holds four textures: 0 over its west half and a little past, 4, 5 and 6 in stripes east of it.
	for (let z = 0; z < PER; z++) {
		for (let x = 0; x < PER; x++) {
			const b = (z * R + x) * SLOTS
			g.weights.fill(0, b, b + SLOTS)
			g.weights[b + (x < PER / 2 + 2 ? 0 : 1 + (z % 3))] = 255
		}
	}
	g.chunkSlots.set([0, 4, 5, 6], 0)
	const mask = new Uint8Array(R * R)
	// Half the chunk, so the old paint keeps the other half.
	const rect = { x0: 0, z0: 0, x1: PER / 2 - 1, z1: PER - 1 }
	for (let z = 0; z <= rect.z1; z++) for (let x = 0; x <= rect.x1; x++) mask[z * R + x] = 255
	const r = paintBiome(g, mask, rect, PAINT)
	assert.equal(r.chunks, 1)
	assert.equal(r.replaced, 1)
	const slots = [...g.chunkSlots.subarray(0, SLOTS)]
	assert.ok(slots.includes(1), 'the biome base is in')
	assert.equal(slots.filter((s) => s !== NO_TEXTURE).length, SLOTS)
})

test('a selection fades in from its edge and stays inside it', () => {
	const inside = new Uint8Array(R * R)
	const rect = { x0: 40, z0: 40, x1: 119, z1: 119 }
	for (let z = rect.z0; z <= rect.z1; z++) for (let x = rect.x0; x <= rect.x1; x++) inside[z * R + x] = 255
	const m = new Uint8Array(R * R)
	featherInside(inside, R, rect, 8, m)
	assert.equal(m[39 * R + 80], 0)
	assert.equal(m[80 * R + 39], 0)
	assert.ok(m[40 * R + 80] > 0 && m[40 * R + 80] < 64, `edge ${m[40 * R + 80]}`)
	assert.equal(m[80 * R + 80], 255)
	assert.ok(m[44 * R + 80] > m[41 * R + 80])
})

test('roles without a texture take their fallback', () => {
	const b = newBiome('t', ['a', '', 'c'])
	assert.deepEqual(roleTextures(b), ['a', 'a', 'c', 'c', 'c', 'c'])
})

test('History.batch makes one step that undoes its parts last first', () => {
	const log: string[] = []
	const cmd = History.batch('All', (h) => {
		h.push({ label: 'a', bytes: 2, undo: () => log.push('-a'), redo: () => log.push('+a') })
		h.push({ label: 'b', bytes: 3, undo: () => log.push('-b'), redo: () => log.push('+b') })
	})
	assert.ok(cmd)
	assert.equal(cmd.bytes, 5)
	cmd.undo()
	cmd.redo()
	assert.deepEqual(log, ['-b', '-a', '+a', '+b'])
	assert.equal(
		History.batch('None', () => {}),
		null,
	)
})

test('a biome from a zone sorts its textures, effects and scatter, and passes the prefs check', () => {
	const uses = [
		{ path: 'Tileset\\Elwynn\\ElwynnGrassBase.blp', share: 0.6 },
		{ path: 'Tileset\\Elwynn\\ElwynnRockBase.blp', share: 0.2 },
		{ path: 'Tileset\\Elwynn\\ElwynnDirtBase.blp', share: 0.1 },
		{ path: 'Tileset\\Elwynn\\ElwynnLushGrass.blp', share: 0.1 },
	]
	const doodads = [
		{ path: 'World\\Azeroth\\Elwynn\\PassiveDoodads\\Trees\\ElwynnTree01.m2', count: 50, scaleMin: 0.8, scaleMax: 1.2 },
		{ path: 'World\\Generic\\Rocks\\Rock01.m2', count: 10, scaleMin: 1, scaleMax: 1 },
	]
	const tables = { effects: {}, textures: { 'tileset\\elwynn\\elwynngrassbase.blp': 42 } }
	const b = biomeFromZone('Elwynn Forest', uses, doodads, 1e6, tables)
	assert.ok(b)
	assert.equal(b.textures[0], uses[0].path)
	assert.equal(b.textures[3], uses[1].path)
	assert.equal(b.textures[2], uses[2].path)
	assert.equal(b.textures[5], '')
	assert.deepEqual(b.effects, { [uses[0].path]: 42 })
	assert.equal(b.scatter.length, 2)
	assert.ok(b.scatter[0].clumps)
	assert.ok(prefShapeOk('biomes', [b]))
	assert.ok(!prefShapeOk('biomes', [{ ...b, scatter: 3 }]))
})
