// Run with: bun test tests/pasteLanding.test.ts
// A model paste on a building (#191, tested by #522): each pasted root lands on the highest model under
// it, a root past the model's edge stays on the ground, and a model buried under the ground doesn't count.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import type { Terrain } from '../src/lib/terrain/Terrain.ts'

const { ObjectLayer } = await import('../src/lib/world/ObjectLayer.ts')
const { pasteLandings } = await import('../src/lib/world/pasteLanding.ts')

/** A flat ground at height `h`. */
const flat = (h: number) => ({ heightAt: () => h }) as unknown as Terrain
const CUBE = 'helper:cube:4'

/** A layer with a 4 yd cube at (x, z), its base `yOff` above the ground. */
function layer(ground: Terrain, ...cubes: Array<[number, number, number]>) {
	const L = new ObjectLayer(ground)
	const ids = cubes.map(([x, z, yOff]) => L.add({ type: CUBE, x, z, yOff, rotY: 0, scale: 1 }).id)
	return { L, ids }
}

/** The cube's top: the highest point the downward ray meets over its middle. */
function top(L: InstanceType<typeof ObjectLayer>, ground: Terrain, x: number, z: number) {
	const got = pasteLandings(L, ground, [{ cid: 1, x: 0, z: 0 }], x, z).get(1)
	assert.ok(got && got.parent !== null, 'the ray meets the cube')
	return got.y
}

test('a root over a model stands on it, attached to it; a root past its edge stays on the ground', () => {
	const ground = flat(0)
	const { L, ids } = layer(ground, [100, 100, 0])
	const y = top(L, ground, 100, 100)
	assert.ok(y > 0.5, `the cube's top is above the ground (${y})`)
	const out = pasteLandings(
		L,
		ground,
		[
			{ cid: 1, x: 0, z: 0 },
			{ cid: 2, x: 20, z: 0 },
			{ cid: 3, x: 0.5, z: 0.5, cparent: 1 },
		],
		100,
		100,
	)
	assert.deepEqual(out.get(1), { parent: ids[0], y })
	assert.deepEqual(out.get(2), { parent: null, y: 0 })
	assert.equal(out.has(3), false, 'an attached object keeps its parent, so it has no landing')
})

test('of two stacked models the higher one catches the paste', () => {
	const ground = flat(0)
	const { L, ids } = layer(ground, [10, 10, 0], [10, 10, 20])
	const low = layer(ground, [10, 10, 0])
	const lowTop = top(low.L, ground, 10, 10)
	const got = pasteLandings(L, ground, [{ cid: 7, x: 0, z: 0 }], 10, 10).get(7)
	assert.equal(got?.parent, ids[1])
	assert.ok(got && Math.abs(got.y - (lowTop + 20)) < 1e-3, `the upper cube's top (${got?.y})`)
})

test('a model buried under the ground does not catch the paste', () => {
	const ground = flat(50)
	const { L } = layer(ground, [0, 0, -30])
	assert.deepEqual(pasteLandings(L, ground, [{ cid: 1, x: 0, z: 0 }], 0, 0).get(1), { parent: null, y: 50 })
})

test('with no models every root stands on the ground', () => {
	const ground = flat(3)
	const L = new ObjectLayer(ground)
	assert.deepEqual(pasteLandings(L, ground, [{ cid: 4, x: 1, z: 2 }], 0, 0).get(4), { parent: null, y: 3 })
})
