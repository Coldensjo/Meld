// Run with: node --import ./tests/register.mjs --test tests/fitGround.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitHeights, type FitOptions } from '../src/lib/terrain/fitGround.ts'

const W = 11
/** Flat ground at `g`, and a floor at `f` over the vertices from `a` to `b` (inclusive) each way. */
function scene(g: number, f: number, a: number, b: number) {
	const ground = new Float32Array(W * W).fill(g)
	const floor = new Float32Array(W * W).fill(NaN)
	for (let z = a; z <= b; z++) for (let x = a; x <= b; x++) floor[z * W + x] = f
	return { ground, floor }
}
const opts = (o: Partial<FitOptions> = {}): FitOptions => ({ margin: 0.5, falloff: 4, mode: 'both', holes: false, reach: 4, ...o })
const at = (a: Float32Array, x: number, z: number) => a[z * W + x]

test('the ground goes just under the floor and blends back over the ring', () => {
	const { ground, floor } = scene(10, 14, 4, 6)
	const r = fitHeights(ground, floor, W, W, 0, 0, 1, opts())
	assert.ok(r.changed)
	assert.equal(at(r.heights, 5, 5), 13.5, 'under the floor by the margin')
	assert.equal(at(r.heights, 4, 4), 13.5)
	const ring1 = at(r.heights, 3, 5)
	const ring2 = at(r.heights, 2, 5)
	assert.ok(ring1 < 13.5 && ring1 > ring2 && ring2 > 10, `the ring falls away: ${ring1}, ${ring2}`)
	assert.equal(at(r.heights, 0, 5), 10, 'beyond the falloff the ground is untouched')
	assert.equal(at(r.holes, 0, 0), 0)
})

test('only lower leaves ground that is already under the floor, only raise leaves ground above it', () => {
	const { ground, floor } = scene(10, 14, 4, 6)
	assert.equal(fitHeights(ground, floor, W, W, 0, 0, 1, opts({ mode: 'lower' })).changed, false)
	const up = scene(10, 6, 4, 6)
	assert.equal(fitHeights(up.ground, up.floor, W, W, 0, 0, 1, opts({ mode: 'raise' })).changed, false)
	const r = fitHeights(up.ground, up.floor, W, W, 0, 0, 1, opts({ mode: 'lower' }))
	assert.equal(at(r.heights, 5, 5), 5.5)
})

test('with holes, ground above the floor is cut in whole blocks on the map grid, and its edge stays', () => {
	// A cellar floor at 6 under ground at 10, over vertices 3..7 (cells 3..6).
	const { ground, floor } = scene(10, 6, 3, 7)
	// The window starts at map vertex 0, so cells 3..6 are map cells 3..6: their blocks are 2..7.
	const r = fitHeights(ground, floor, W, W, 0, 0, 1, opts({ holes: true }))
	const cw = W - 1
	const cut: number[] = []
	for (let x = 0; x < cw; x++) if (r.holes[4 * cw + x]) cut.push(x)
	assert.deepEqual(cut, [2, 3, 4, 5, 6, 7])
	assert.equal(at(r.heights, 5, 5), 10, 'inside the hole the ground keeps its height')
	assert.equal(at(r.heights, 2, 4), 10, 'and so does the hole\'s edge')
})
