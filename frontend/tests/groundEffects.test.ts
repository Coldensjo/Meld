// Run with: bun test tests/groundEffects.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	BlizzardRandomizer,
	cellPredominant,
	cellTexture,
	chunkSeed,
	chunkNoEffect,
	coverCells,
	effectAt,
	effectFor,
	frillDensity,
	hasScopedEffects,
	noScopedEffects,
	knownEffects,
	scatterChunk,
	tuftFade,
	tuftReach,
	TUFT_CUT_DEPTH,
	type GroundEffect,
	type GroundEffectTables,
	type Tuft,
} from '../src/lib/world/groundEffects.ts'
import { NO_TEXTURE, SLOTS, SPLAT_PER_CELL } from '../src/lib/terrain/chunkPaint.ts'

const tables: GroundEffectTables = {
	effects: { 7: { doodads: ['World\\NoDXT\\Detail\\ElwGra01.m2', 'World\\NoDXT\\Detail\\ElwFlo01.m2'], density: 8, terrain: 5, slots: [0, 1, -1, -1] } },
	textures: { 'tileset\\elwynn\\elwynngrassbase.blp': 7, 'tileset\\elwynn\\elwynnflowerbase.blp': 7 },
}

test("a texture grows the client's effect unless the map says otherwise", () => {
	assert.equal(effectFor('Tileset\\Elwynn\\ElwynnGrassBase.blp', {}, tables), 7, 'case does not matter')
	assert.equal(effectFor('Tileset\\Elwynn\\ElwynnGrassBase.blp', { 'Tileset\\Elwynn\\ElwynnGrassBase.blp': 0 }, tables), 0, 'the map turned it off')
	assert.equal(effectFor('Tileset\\Elwynn\\ElwynnRockBase.blp', {}, tables), 0, 'unknown textures grow nothing')
	assert.equal(effectFor('#5d8a2f', {}, tables), 0, 'colours grow nothing')
	assert.equal(effectFor('Tileset\\Elwynn\\ElwynnRockBase.blp', {}, null), 0, 'no tables yet')
})

test('the cell grows the slot that weighs most over its texels', () => {
	const res = SPLAT_PER_CELL * 16
	const w = new Uint8Array(res * res * SLOTS)
	// Cell (1, 0): slot 2 strongest; cell (0, 0): slot 0.
	for (let z = 0; z < SPLAT_PER_CELL; z++) {
		for (let x = 0; x < SPLAT_PER_CELL; x++) {
			w[(z * res + x) * SLOTS] = 255
			const i = (z * res + SPLAT_PER_CELL + x) * SLOTS
			w[i] = 100
			w[i + 2] = 155
		}
	}
	assert.equal(cellPredominant(w, res, 0, 0), 0)
	assert.equal(cellPredominant(w, res, 1, 0), 2)
	assert.equal(cellPredominant(w, res, 5, 5), -1, 'an unpainted cell')
	const slots = new Uint8Array(4 * SLOTS).fill(NO_TEXTURE)
	slots.set([3, 9, 12, NO_TEXTURE])
	assert.equal(cellTexture(w, slots, res, 2, 1, 0), 12)
	assert.equal(cellTexture(w, slots, res, 2, 5, 5), NO_TEXTURE)
})

test("the View menu's densities are the client's Ground Clutter stops", () => {
	assert.equal(frillDensity('sparse'), 16)
	assert.equal(frillDensity('normal'), 32)
	assert.equal(frillDensity('full'), 48)
	assert.equal(frillDensity('nonsense'), 32)
})

test('a building bares the cells under its turned box, and the chunk bits pack per row', () => {
	const cells = 16
	const out = new Uint8Array(cells * cells)
	// A 4x2 box (in its own space) at (8, 8), turned a quarter turn so it lies along z, scaled 2: 8 by 4.
	coverCells([{ x: 8, z: 8, rotY: Math.PI / 2, scale: 2, minX: -2, minZ: -1, maxX: 2, maxZ: 1 }], 1, cells, out)
	const at = (cx: number, cz: number) => out[cz * cells + cx]
	assert.equal(at(8, 8), 1, 'the centre')
	assert.equal(at(8, 4), 1, 'along z, inside the turned box')
	assert.equal(at(8, 11), 1)
	assert.equal(at(8, 3), 0, 'past its end')
	assert.equal(at(9, 8), 1, 'within its width')
	assert.equal(at(10, 8), 0, 'beyond its width')
	assert.equal(at(5, 8), 0)
	// Already-set bytes stay, and the chunk's rows pack the bits as the tile holds them.
	out[0] = 1
	const rows = chunkNoEffect(out, cells, 0, 0)!
	assert.equal(rows[0], 1)
	assert.equal(rows[1], 0)
	assert.equal(chunkNoEffect(new Uint8Array(cells * cells), cells, 1, 1), null, 'a chunk with nothing set')
	assert.deepEqual(chunkNoEffect(out, cells, 1, 1), [3, 3, 3, 3, 0, 0, 0, 0], 'the box reaches two cells into chunk (1, 1) for four rows')
	const mid = chunkNoEffect(out, cells, 1, 0)!
	assert.equal(mid[4] & (1 << 0), 1, 'cell (8, 4) is row 4 bit 0 of chunk (1, 0)')
	assert.equal(mid[3], 0)
})

// The vectors below are Benilla's own BlizzardRandomizer and scatter loop (ground_effects.rs), built
// with rustc and run for chunk seed (33 << 16) | 47.
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

test("the randomizer gives the client's stream", () => {
	const r = new BlizzardRandomizer(chunkSeed(47, 33))
	assert.deepEqual(
		[0, 1, 2, 3, 4, 5].map(() => r.shuffle()),
		[462909168, 669678877, 618994953, 2678731783, 1483417433, 513740583],
	)
	const units = [-0.62321985, -0.15041244, 0.89484084, -0.21164262, 0.66742706, 0.91216016]
	for (const u of units) assert.ok(near(r.signedUnit(), u))
	r.reset(0)
	assert.deepEqual([r.shuffle(), r.shuffle(), r.shuffle()], [381586089, 3124349024, 2984236384])
})

test('a chunk scatters as the client does: cells with repeats, slots by turn, nothing drawn for a bare cell', () => {
	const effect: GroundEffect = { doodads: ['A', 'B', 'C'], slots: [0, -1, 1, 2], density: 2, terrain: 0 }
	// Row 0 grows nothing, so its picks draw nothing from the stream.
	const cells = Array.from({ length: 64 }, (_, k) => (k < 8 ? null : effect))
	const out: Tuft[] = []
	const n = scatterChunk(new BlizzardRandomizer(), chunkSeed(47, 33), 16, cells, out)
	assert.equal(n, 23)
	const first = [
		[5 * 8 + 0, 'A', 0.095027566, 0.8864776, 0.99882096, 0.17729574],
		[7 * 8 + 1, 'B', 0.63113964, 0.9786581, 0.9235268, 2.852817],
		[7 * 8 + 1, 'B', 0.41656452, 0.71796393, 1.0066075, -2.915309],
		[7 * 8 + 1, 'C', 0.40600616, 0.54572713, 0.98517305, 2.629112],
	] as const
	first.forEach(([cell, model, u, v, scale, rotY], i) => {
		const t = out[i]
		assert.equal(t.cell, cell)
		assert.equal(effect.doodads[t.doodad], model)
		assert.ok(near(t.u, u) && near(t.v, v) && near(t.scale, scale) && Math.abs(t.rotY - rotY) < 1e-5, `tuft ${i}`)
	})
	const last = out[n - 1]
	assert.equal(last.cell, 4 * 8 + 3)
	assert.equal(effect.doodads[last.doodad], 'A')
	assert.ok(near(last.u, 0.8509138) && near(last.v, 0.60398227))
	// The same chunk always grows the same tufts; another chunk others.
	const again: Tuft[] = []
	scatterChunk(new BlizzardRandomizer(), chunkSeed(47, 33), 16, cells, again)
	assert.deepEqual(again.slice(0, n), out.slice(0, n))
	const other: Tuft[] = []
	scatterChunk(new BlizzardRandomizer(), chunkSeed(48, 33), 16, cells, other)
	assert.notDeepEqual(other[0], out[0])
	// A density of 0 grows the client's 8.
	const zero = scatterChunk(new BlizzardRandomizer(), chunkSeed(47, 33), 1, Array(64).fill({ ...effect, slots: [0, 0, 0, 0], density: 0 }), [])
	assert.equal(zero, 8)
})

test('the known effects are those the client uses, most used first', () => {
	assert.deepEqual(knownEffects(tables), [{ id: 7, uses: 2 }])
})

test("a tile's choice comes before its zone's, a zone's before the map's, and the map's before the client's", () => {
	const grass = 'Tileset\\Grass.blp'
	const tables = { effects: {}, textures: { [grass.toLowerCase()]: 5 } }
	const scoped = { zones: { '12': { [grass]: 7 } }, tiles: { '1,2': { [grass]: 9 } } }
	assert.equal(effectAt(grass, {}, noScopedEffects(), 12, 1, 2, tables), 5)
	assert.equal(effectAt(grass, { [grass]: 6 }, noScopedEffects(), 12, 1, 2, tables), 6)
	assert.equal(effectAt(grass, { [grass]: 6 }, scoped, 12, 0, 0, tables), 7)
	assert.equal(effectAt(grass, { [grass]: 6 }, scoped, 12, 1, 2, tables), 9)
	assert.equal(effectAt(grass, { [grass]: 6 }, scoped, 40, 0, 0, tables), 6)
	assert.equal(hasScopedEffects(noScopedEffects()), false)
	assert.equal(hasScopedEffects(scoped), true)
})

test("tufts fade on view depth as the client's do (Benilla clutter.rs landmarks)", () => {
	assert.ok(Math.abs(tuftFade(0) - 252 / 255) < 1e-6, 'the near plateau')
	assert.ok(Math.abs(tuftFade(52.63672) - 252 / 255) < 1e-5, 'the plateau ends at 52.64, not 52.5')
	assert.ok(tuftFade(52.7) < 252 / 255, 'then it falls')
	assert.ok(tuftFade(69.86328) < 1e-5, 'gone by 69.86')
	assert.ok(Math.abs(TUFT_CUT_DEPTH - 61.11328) < 1e-4, 'opaque grass is cut out at 61.11')
	assert.ok(Math.abs(tuftFade(TUFT_CUT_DEPTH) - 128 / 255) < 1e-6)
})

test('tufts are built out to the cut depth at the side edge of the view', () => {
	// A square 90-degree view: the side edge is at 45 degrees, sqrt(2) times the depth away.
	assert.ok(Math.abs(tuftReach(90, 1) - TUFT_CUT_DEPTH * Math.SQRT2) < 1e-6)
	assert.ok(tuftReach(1, 1) - TUFT_CUT_DEPTH < 0.01, 'a narrow view needs barely more than the depth')
})
