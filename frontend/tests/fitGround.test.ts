// Run with: bun test tests/fitGround.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitHeights, type FitOptions } from '../src/lib/terrain/fitGround.ts'

const W = 11
/**
 * Flat ground at `g`, and a floor slab at `f` over the vertices from `a` to `b` (inclusive) each way,
 * its underside at `u` (the floor's own height when not given).
 */
function scene(g: number, f: number, a: number, b: number, u = f) {
	const ground = new Float32Array(W * W).fill(g)
	const floor = new Float32Array(W * W).fill(NaN)
	const bottom = new Float32Array(W * W).fill(NaN)
	for (let z = a; z <= b; z++) {
		for (let x = a; x <= b; x++) {
			floor[z * W + x] = f
			bottom[z * W + x] = u
		}
	}
	return { ground, floor, bottom }
}
const opts = (o: Partial<FitOptions> = {}): FitOptions => ({ margin: 0.5, falloff: 4, mode: 'both', holes: false, reach: 4, ...o })
const at = (a: Float32Array, x: number, z: number) => a[z * W + x]

test('the ground goes just under the floor and blends back over the ring', () => {
	const { ground, floor, bottom } = scene(10, 14, 4, 6)
	const r = fitHeights(ground, floor, bottom, W, W, 0, 0, 1, opts({ falloff: 3 }))
	assert.ok(r.changed)
	assert.equal(at(r.heights, 5, 5), 13.5, 'under the floor by the margin')
	assert.equal(at(r.heights, 4, 4), 13.5)
	const ring1 = at(r.heights, 3, 5)
	const ring2 = at(r.heights, 2, 5)
	assert.ok(ring1 < 13.5 && ring1 > ring2 && ring2 > 10, `the ring falls away: ${ring1}, ${ring2}`)
	assert.equal(at(r.heights, 0, 5), 10, 'a cell beyond the falloff (where the smoothing ends) the ground is untouched')
	assert.equal(r.holes[0], 0)
})

test('only lower leaves ground that is already under the floor, only raise leaves ground above it', () => {
	const { ground, floor, bottom } = scene(10, 14, 4, 6)
	assert.equal(fitHeights(ground, floor, bottom, W, W, 0, 0, 1, opts({ mode: 'lower' })).changed, false)
	const up = scene(10, 6, 4, 6)
	assert.equal(fitHeights(up.ground, up.floor, up.bottom, W, W, 0, 0, 1, opts({ mode: 'raise' })).changed, false)
	const r = fitHeights(up.ground, up.floor, up.bottom, W, W, 0, 0, 1, opts({ mode: 'lower' }))
	assert.equal(at(r.heights, 5, 5), 5.5)
})

test('with holes, ground above the floor is cut in whole blocks on the map grid, and its edge stays', () => {
	// A cellar floor at 6 under ground at 10, over vertices 3..7 (cells 3..6).
	const { ground, floor, bottom } = scene(10, 6, 3, 7)
	// The window starts at map vertex 0, so cells 3..6 are map cells 3..6: their blocks are 2..7.
	const r = fitHeights(ground, floor, bottom, W, W, 0, 0, 1, opts({ holes: true }))
	const cw = W - 1
	const cut: number[] = []
	for (let x = 0; x < cw; x++) if (r.holes[4 * cw + x]) cut.push(x)
	assert.deepEqual(cut, [2, 3, 4, 5, 6, 7])
	assert.equal(at(r.heights, 5, 5), 10, 'inside the hole the ground keeps its height')
	assert.equal(at(r.heights, 2, 4), 10, "and so does the hole's edge")
})

test('on a foundation over uneven ground, the ground is levelled to its base (#210)', () => {
	// A house whose floor is 4 yd up on a hollow foundation (the rays find the floor as its underside)
	// with its base at 10, over ground at 10 with a dip to 8 and humps to 12 and 15 under it.
	const { ground, floor, bottom } = scene(10, 14, 3, 7)
	ground[5 * W + 4] = 8
	ground[5 * W + 6] = 15
	ground[4 * W + 5] = 12
	const r = fitHeights(ground, floor, bottom, W, W, 0, 0, 1, opts(), 10)
	assert.equal(at(r.heights, 4, 5), 10, 'the dip comes up to the foundation')
	assert.equal(at(r.heights, 6, 5), 10, 'the hump goes down to it')
	assert.equal(at(r.heights, 5, 4), 10, 'and so does ground inside the foundation')
	assert.equal(at(r.heights, 1, 1), 10, 'flat ground already at the foundation stays')
	const low = fitHeights(ground, floor, bottom, W, W, 0, 0, 1, opts({ mode: 'lower' }), 10).heights
	assert.equal(low[5 * W + 4], 8, 'only lower leaves the dip')
	assert.equal(low[5 * W + 6], 10, 'and lowers the hump')
})

test('on a slope, the footprint and its apron are level, and the ring starts from the new height (#210)', () => {
	// Ground rising 1 yd a vertex along x, a building based at 5 over vertices 3..7.
	const { floor, bottom } = scene(0, 9, 3, 7)
	const ground = new Float32Array(W * W)
	for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) ground[z * W + x] = x
	// A two-cell apron: its inner row stays level, its outer row is rounded into the ring.
	const r = fitHeights(ground, floor, bottom, W, W, 0, 0, 1, opts({ margin: 0.2, falloff: 4 }), 5, 2)
	for (let x = 2; x <= 8; x++) assert.equal(at(r.heights, x, 5), 5, `vertex ${x} is level`)
	const edge = at(r.heights, 9, 5)
	const up = at(r.heights, 10, 5)
	assert.ok(edge > 5 && edge < up && up < 10, `the ring climbs smoothly back to the hill: ${edge}, ${up}`)
})

test('a footprint with gaps along a wall (eaves, a chimney) still gets a level pad with a straight edge (#210)', () => {
	// A building based at 5 over vertices 2..8 on rising ground, with every other vertex of its back
	// row (z 2) uncovered, as under the eaves.
	const { floor, bottom } = scene(0, 9, 2, 8)
	for (let x = 3; x <= 7; x += 2) floor[2 * W + x] = bottom[2 * W + x] = NaN
	const ground = new Float32Array(W * W)
	for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) ground[z * W + x] = 10 - z
	const r = fitHeights(ground, floor, bottom, W, W, 0, 0, 1, opts({ falloff: 3 }), 5, 1)
	for (let x = 2; x <= 8; x++) assert.equal(at(r.heights, x, 2), 5, `back row vertex ${x} is level`)
	const ring = [3, 4, 5, 6, 7].map((x) => at(r.heights, x, 0))
	assert.ok(Math.max(...ring) - Math.min(...ring) < 0.2, `the ring behind it is even: ${ring}`)
})

test('with a base, a floor under it (a sunk footing) leaves the ground level (#210)', () => {
	const { ground, floor, bottom } = scene(10, 14, 3, 7)
	floor[5 * W + 5] = 8
	const r = fitHeights(ground, floor, bottom, W, W, 0, 0, 1, opts(), 10)
	assert.equal(at(r.heights, 5, 5), 10)
	assert.equal(r.changed, false)
})
