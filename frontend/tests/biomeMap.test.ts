// Run with: bun test tests/biomeMap.test.ts
// The Biome Brush's paint (#958, terrain/biomeMap.ts): the blend of two biomes over the border width,
// the four-texture choice on a border chunk, and a chunk no changed cell reaches keeping its paint.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { BiomeBlend, BiomeRepainter, NO_BIOME, Repaint, chunksReached, checkBiomeMap, type BiomeLayer, type BiomeMapGround } from '../src/lib/terrain/biomeMap.ts'
import { CHUNK_CELLS, NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../src/lib/terrain/chunkPaint.ts'

const SIZE = 64
const R = SIZE * SPLAT_PER_CELL
const SIDE = SIZE / CHUNK_CELLS
const PER = R / SIDE
const TPC = R / SIZE

/** A map painted all over with palette entry 0, its west half (cells x < 32) biome 1 and its east half `east`. */
function ground(east: number): BiomeMapGround {
	const weights = new Uint8Array(R * R * SLOTS)
	for (let p = 0; p < R * R; p++) weights[p * SLOTS] = 255
	const chunkSlots = new Uint8Array(SIDE * SIDE * SLOTS).fill(NO_TEXTURE)
	for (let c = 0; c < SIDE * SIDE; c++) chunkSlots[c * SLOTS] = 0
	const biomeMap = new Uint8Array(SIZE * SIZE)
	for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) biomeMap[z * SIZE + x] = x < SIZE / 2 ? 1 : east
	return { size: SIZE, splatRes: R, paintChunksPerSide: SIDE, weights, chunkSlots, biomeMap }
}

// Biome 1 paints its base (texture 1) everywhere; biome 2 its base 4, lush 5, dirt 6 and rock 7 by fixed shares.
const LAYERS: BiomeLayer[] = [
	{
		roleTex: [1, 1, 2, 3, 2, 3],
		fill: (_i, _j, out) => {
			out.fill(0)
			out[0] = 255
		},
	},
	{
		roleTex: [4, 5, 6, 7, 6, 7],
		fill: (_i, _j, out) => {
			out.fill(0)
			out[0] = 120
			out[1] = 60
			out[2] = 40
			out[3] = 35
		},
	},
]
const layer = (id: number) => LAYERS[id - 1] ?? null

/** Repaints every chunk of `g` against `before`; returns each chunk's result. */
function repaintAll(g: BiomeMapGround, border: number, before: Uint8Array): Repaint[] {
	const blend = new BiomeBlend(SIZE, R, border)
	const r = new BiomeRepainter(g, blend, layer)
	const out: Repaint[] = []
	for (let c = 0; c < SIDE * SIDE; c++) {
		const { x0, z0 } = { x0: (c % SIDE) * PER, z0: Math.floor(c / SIDE) * PER }
		const base = new Uint8Array(PER * PER * SLOTS)
		for (let z = 0; z < PER; z++) base.set(g.weights.subarray(((z0 + z) * R + x0) * SLOTS, ((z0 + z) * R + x0 + PER) * SLOTS), z * PER * SLOTS)
		out.push(r.chunk(c, before, base, g.chunkSlots.slice(c * SLOTS, c * SLOTS + SLOTS)))
	}
	return out
}

/** The weight (0 to 255) of palette texture `tex` at texel (x, z). */
function weightOf(g: BiomeMapGround, x: number, z: number, tex: number): number {
	const c = Math.floor(z / PER) * SIDE + Math.floor(x / PER)
	for (let k = 0; k < SLOTS; k++) if (g.chunkSlots[c * SLOTS + k] === tex) return g.weights[(z * R + x) * SLOTS + k]
	return 0
}

function texturesOf(g: BiomeMapGround, c: number): number[] {
	return [...g.chunkSlots.slice(c * SLOTS, c * SLOTS + SLOTS)].filter((t) => t !== NO_TEXTURE).sort((a, b) => a - b)
}

test('two biomes cross-fade over the border width, half and half on the cells edge', () => {
	const g = ground(2)
	const blend = new BiomeBlend(SIZE, R, 4)
	const z = R / 2
	// Deep inside each half, its own biome alone.
	assert.equal(blend.share(g.biomeMap, 10 * TPC, z, 1), 1)
	assert.equal(blend.share(g.biomeMap, 50 * TPC, z, 2), 1)
	// Half the border (2 cells) in from the edge, still its own alone; just inside it, a little of the other.
	assert.equal(blend.share(g.biomeMap, 30 * TPC - 1, z, 1), 1)
	const edge = 32 * TPC - 1
	const a = blend.share(g.biomeMap, edge, z, 1)
	assert.ok(a > 0.5 && a < 0.6, `own share at the edge ${a}`)
	assert.ok(Math.abs(blend.share(g.biomeMap, edge, z, 2) - (1 - a)) < 1e-6)
	// Mirrored across the edge, the shares swap.
	assert.ok(Math.abs(blend.share(g.biomeMap, edge + 1, z, 2) - a) < 1e-6)
	// The share falls steadily across the border.
	let last = 1
	for (let x = 30 * TPC; x <= 34 * TPC; x++) {
		const s = blend.share(g.biomeMap, x, z, 1)
		assert.ok(s <= last + 1e-9, `share rose at texel ${x}`)
		last = s
	}
	assert.equal(last, 0)
	// No border: hard edges.
	const hard = new BiomeBlend(SIZE, R, 0)
	assert.equal(hard.share(g.biomeMap, edge, z, 1), 1)
	assert.equal(hard.share(g.biomeMap, edge + 1, z, 1), 0)
})

test('a border chunk keeps four textures, both bases, and gives a dropped role to its fallback', () => {
	const g = ground(2)
	const res = repaintAll(g, 4, new Uint8Array(SIZE * SIZE))
	// The border runs between chunk columns 3 and 4.
	const west = 3 * SIDE + 3
	const east = 3 * SIDE + 4
	assert.deepEqual(texturesOf(g, 3 * SIDE + 0), [1])
	// West of it, biome 2's lush is a speckle under auto-paint's smallest share: it goes to biome 2's base.
	assert.deepEqual(texturesOf(g, west), [1, 4])
	assert.equal(res[west], Repaint.Painted)
	// East of the border: biome 2's four and biome 1's base make five; its rock (7), the lightest, goes to its dirt (6).
	assert.deepEqual(texturesOf(g, east), [1, 4, 5, 6])
	assert.equal(res[east], Repaint.Replaced)
	const deep = 4 * PER + PER - 2
	assert.ok(Math.abs(weightOf(g, deep, R / 2, 6) - 75) <= 1, `dirt took the rock's weight: ${weightOf(g, deep, R / 2, 6)}`)
	// A chunk wholly in biome 2 keeps three, as auto-paint does, and is not counted.
	assert.deepEqual(texturesOf(g, 3 * SIDE + 7), [4, 5, 6])
	assert.equal(res[3 * SIDE + 7], Repaint.Painted)
	for (let c = 0; c < SIDE * SIDE; c++) assert.ok(texturesOf(g, c).length <= SLOTS)
	for (let p = 0; p < R * R; p++) {
		let s = 0
		for (let k = 0; k < SLOTS; k++) s += g.weights[p * SLOTS + k]
		assert.equal(s, 255)
	}
	// On the edge itself, about half of each base.
	const edge = 32 * TPC - 1
	assert.ok(Math.abs(weightOf(g, edge, R / 2, 1) - 140) < 20, `base 1 on the edge: ${weightOf(g, edge, R / 2, 1)}`)
})

test('a biome fades into the old paint where no biome was painted', () => {
	const g = ground(NO_BIOME)
	repaintAll(g, 4, new Uint8Array(SIZE * SIZE))
	assert.deepEqual(texturesOf(g, 3 * SIDE + 7), [0])
	assert.deepEqual(texturesOf(g, 3 * SIDE + 4), [0, 1])
	assert.equal(weightOf(g, 4 * PER + PER - 1, R / 2, 0), 255)
	const edge = 32 * TPC
	assert.ok(weightOf(g, edge, R / 2, 0) > 100 && weightOf(g, edge, R / 2, 1) > 80)
})

test('a chunk no changed cell reaches keeps its paint', () => {
	const g = ground(2)
	const before = g.weights.slice()
	const res = repaintAll(g, 4, g.biomeMap.slice())
	assert.ok(res.every((r) => r === Repaint.Same))
	assert.deepEqual(g.weights, before)
	// One changed cell repaints only the chunks within the blend's reach of it.
	assert.deepEqual(chunksReached(SIZE, SIDE, { x0: 12, z0: 12, x1: 12, z1: 12 }, 2, []), [SIDE + 1])
	assert.deepEqual(chunksReached(SIZE, SIDE, { x0: 15, z0: 12, x1: 15, z1: 12 }, 2, []), [SIDE + 1, SIDE + 2])
})

test('cells naming a biome the map lacks are cleared on load', () => {
	assert.deepEqual([...checkBiomeMap(new Uint8Array([0, 1, 2, 3]), 2)], [0, 1, 2, 0])
})
