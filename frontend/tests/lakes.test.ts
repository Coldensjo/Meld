// Run with: bun test tests/lakes.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAKE_RULES, fillLakes, findLakes, shoreLevels } from '../src/lib/water/lakes.ts'
import { LIQUID_CELLS, LIQUID_MAGMA, LIQUID_VERTS, LiquidMap } from '../src/lib/water/liquids.ts'

const V = 33
const CS = 4
// The bowl below covers about 30% of this small grid, past the default share for one lake.
const rules = { ...LAKE_RULES, sea: 0, maxShare: 0.5 }

/** Heights over a V×V grid from f(x, z) in vertices. */
function field(f: (x: number, z: number) => number): Float32Array {
	const h = new Float32Array(V * V)
	for (let z = 0; z < V; z++) for (let x = 0; x < V; x++) h[z * V + x] = f(x, z)
	return h
}

/** A bowl in the middle of a plateau at 20 yd: 10 yd deep in the middle, its rim at 20. */
const bowl = () => field((x, z) => 20 - Math.max(0, 10 - Math.hypot(x - 16, z - 16)))

test('a bowl fills to its rim', () => {
	const h = bowl()
	const level = findLakes(h, V, CS, rules)
	assert.equal(level[16 * V + 16], 20)
	// Wet in the bowl, dry on the plateau.
	assert.ok(Number.isNaN(level[2 * V + 2]))
	let wet = 0
	for (const l of level) if (!Number.isNaN(l)) wet++
	assert.ok(wet > 250 && wet < 330, `${wet} wet vertices`)
})

test('a slope holds no lake', () => {
	const level = findLakes(
		field((x) => x * 2 + 1),
		V,
		CS,
		rules,
	)
	assert.ok(level.every((l) => Number.isNaN(l)))
})

test('a basin under the sea is the sea’s, and one the sea reaches over its rim too', () => {
	const low = findLakes(
		bowl().map((v) => v - 30),
		V,
		CS,
		rules,
	)
	assert.ok(low.every((l) => Number.isNaN(l)))
	// Without a sea the same basin is a lake.
	const dry = findLakes(
		bowl().map((v) => v - 30),
		V,
		CS,
		{ ...rules, sea: null },
	)
	assert.equal(dry[16 * V + 16], -10)
})

test('a puddle and a basin covering most of the map stay dry', () => {
	const puddle = findLakes(
		field((x, z) => (x === 16 && z === 16 ? 19 : 20)),
		V,
		CS,
		rules,
	)
	assert.ok(puddle.every((l) => Number.isNaN(l)))
	// A whole valley walled in at the edge, as a Canyon's floor.
	const valley = findLakes(
		field((x, z) => (x === 0 || z === 0 || x === V - 1 || z === V - 1 ? 300 : 5)),
		V,
		CS,
		rules,
	)
	assert.ok(valley.every((l) => Number.isNaN(l)))
})

test('the lakes become liquid layers of their liquid, at the rim, covering the cells with a wet corner', () => {
	const h = bowl()
	const level = findLakes(h, V, CS, rules)
	const ground = { size: V - 1, verts: V, cellSize: CS, heights: h }
	const map = new LiquidMap(V - 1)
	const cells = fillLakes(map, ground, level, LIQUID_MAGMA)
	assert.ok(cells > 250, `${cells} cells`)
	// The middle cell (16, 16) is in chunk (2, 2), local cell (0, 0).
	const layers = map.layers(2 * map.side + 2)
	assert.equal(layers.length, 1)
	assert.equal(layers[0].id, LIQUID_MAGMA)
	assert.equal(layers[0].cells[0], 1)
	assert.equal(layers[0].heights[0], 20)
	assert.ok(layers[0].depth[0] > 0)
	// A corner chunk on the plateau holds none.
	assert.equal(map.layers(0).length, 0)
	// Each covered cell's corners are at the rim.
	for (const [, ls] of map.entries()) {
		for (let k = 0; k < LIQUID_CELLS * LIQUID_CELLS; k++) {
			if (!ls[0].cells[k]) continue
			const i = Math.floor(k / LIQUID_CELLS) * LIQUID_VERTS + (k % LIQUID_CELLS)
			assert.equal(ls[0].heights[i], 20)
		}
	}
})

test('the shore levels reach a little past the lake', () => {
	const level = findLakes(bowl(), V, CS, rules)
	const shores = shoreLevels(level, V, 2)
	// The bowl's edge is about 10 vertices out from (16, 16); 11 out is dry but on the shore.
	assert.ok(Number.isNaN(level[16 * V + 27]))
	assert.equal(shores[16 * V + 27], 20)
	assert.ok(Number.isNaN(shores[16 * V + 31]))
})
