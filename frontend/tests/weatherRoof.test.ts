// Run with: bun test tests/weatherRoof.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NO_ROOF, PROBE_ABOVE, ROOF_CELL, ROOF_SIDE, WeatherRoof, type SplashGround } from '../src/lib/world/WeatherRoof.ts'

/** A roof 10 yd up over x and z in 0..5, nothing elsewhere; counts the probes and `near` calls. */
function ground() {
	const src = { version: 0 }
	const g = {
		probes: 0,
		nears: 0,
		froms: [] as number[],
		src,
		terrain: () => 0,
		near: () => {
			g.nears++
		},
		models: (x: number, fromY: number, z: number) => {
			g.probes++
			g.froms.push(fromY)
			return x >= 0 && x <= 5 && z >= 0 && z <= 5 ? 10 : -Infinity
		},
		source: () => src,
	}
	return g satisfies SplashGround
}

const ALL = ROOF_SIDE * ROOF_SIDE

test('the grid probes every cell round the eye once, from 30 yd over it, and holds the roofs', () => {
	const roof = new WeatherRoof()
	roof.budget = Infinity
	const g = ground()
	roof.update({ x: 2, y: 3, z: 2 }, g)
	assert.equal(g.probes, ALL)
	assert.equal(g.nears, 1)
	assert.ok(g.froms.every((f) => f === 3 + PROBE_ABOVE))
	assert.equal(roof.reach, Infinity)
	assert.equal(roof.get(2.5, 2.5), 10)
	assert.equal(roof.get(20, -20), -Infinity)
	// The texel of a cell is its index mod the side; a cell with no model holds NO_ROOF.
	const c = Math.floor(2.5 / ROOF_CELL)
	assert.equal(roof.heights[c * ROOF_SIDE + c], 10)
	const far = ((Math.floor(-20 / ROOF_CELL) % ROOF_SIDE) + ROOF_SIDE) % ROOF_SIDE
	assert.equal(roof.heights[far * ROOF_SIDE + Math.floor(20 / ROOF_CELL)], NO_ROOF)
	// A still eye costs nothing.
	roof.update({ x: 2, y: 3, z: 2 }, g)
	assert.equal(g.probes, ALL)
})

test('moving the eye probes only the cells that came in, and forgets the ones that left', () => {
	const roof = new WeatherRoof()
	roof.budget = Infinity
	const g = ground()
	roof.update({ x: 2, y: 3, z: 2 }, g)
	const before = g.probes
	// Three cells along +x: three new columns, emptied until probed.
	roof.update({ x: 2 + 3 * ROOF_CELL, y: 3, z: 2 }, g)
	assert.equal(g.probes - before, 3 * ROOF_SIDE)
	assert.equal(roof.get(2.5, 2.5), 10)
	const cx = Math.floor(2 / ROOF_CELL)
	// The window's left edge moved from cx - 72 to cx + 3 - 72: those three columns now hold cells a side over.
	const left = (cx - ROOF_SIDE / 2) * ROOF_CELL + 0.5
	assert.equal(roof.get(left, 2), undefined)
	assert.equal(roof.get(left + ROOF_SIDE * ROOF_CELL, 2), -Infinity)
})

test('the grid is forgotten when the models change or the eye moves a story', () => {
	const roof = new WeatherRoof()
	roof.budget = Infinity
	const g = ground()
	roof.update({ x: 2, y: 3, z: 2 }, g)
	g.src.version++
	roof.update({ x: 2, y: 3, z: 2 }, g)
	assert.equal(g.probes, 2 * ALL)
	// Within a story it holds.
	roof.update({ x: 2, y: 9, z: 2 }, g)
	assert.equal(g.probes, 2 * ALL)
	roof.update({ x: 2, y: 12, z: 2 }, g)
	assert.equal(g.probes, 3 * ALL)
})

test('out of time, the grid still probes a few cells a frame, nearest the eye first', () => {
	const roof = new WeatherRoof()
	roof.budget = -1
	const g = ground()
	roof.update({ x: 2, y: 3, z: 2 }, g)
	assert.equal(g.probes, 4)
	assert.equal(roof.get(2, 2), 10)
	assert.equal(roof.get(2 + 5 * ROOF_CELL, 2), undefined)
	assert.ok(roof.reach < 2)
})
