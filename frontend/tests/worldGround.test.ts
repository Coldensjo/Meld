// Run with: bun test tests/worldGround.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tileKey } from '../src/lib/io/mapTiles.ts'
import { TILE_SIZE as TILE_YARDS } from '../src/lib/io/portCoords.ts'
import { GROUND_CELLS, GROUND_SIDE, groundHeight, groundMesh, keepReach, parseGround, streamReach, tileDistance, wantedTiles } from '../src/lib/world/worldGround.ts'

/** A /wow/ground reply (wow.EncodeGround) for heights f(x, y) and the hole cells listed. */
function reply(f: (x: number, y: number) => number, holes: Array<[number, number]> = []): ArrayBuffer {
	const n = GROUND_SIDE * GROUND_SIDE
	const buf = new ArrayBuffer(4 + n * 4 + GROUND_CELLS * GROUND_CELLS)
	new Uint8Array(buf, 0, 4).set([...'GRND'].map((c) => c.charCodeAt(0)))
	const v = new DataView(buf)
	for (let y = 0; y < GROUND_SIDE; y++) for (let x = 0; x < GROUND_SIDE; x++) v.setFloat32(4 + (y * GROUND_SIDE + x) * 4, f(x, y), true)
	const h = new Uint8Array(buf, 4 + n * 4)
	for (const [x, y] of holes) h[y * GROUND_CELLS + x] = 1
	return buf
}

test('a ground reply reads back as its heights and holes, and a bad one is refused', () => {
	const g = parseGround(reply((x, y) => x - 2 * y, [[5, 7]]))
	assert.equal(g.heights[3 * GROUND_SIDE + 10], 10 - 6)
	assert.equal(g.holes[7 * GROUND_CELLS + 5], 1)
	assert.equal(g.holes.reduce((a, b) => a + b, 0), 1)
	assert.throws(() => parseGround(new ArrayBuffer(12)))
})

test("the ground's height runs between its samples, and on a slope its normals lean downhill", () => {
	// Rising 1 yard a cell eastward, flat north to south.
	const g = parseGround(reply((x) => x))
	assert.ok(Math.abs(groundHeight(g, 10.25, 40.5) - 10.25) < 1e-5)
	assert.ok(Math.abs(groundHeight(g, GROUND_CELLS, GROUND_CELLS) - GROUND_CELLS) < 1e-5)
	const m = groundMesh(g)
	const i = 40 * GROUND_SIDE + 10
	assert.ok(m.normals[i * 3] < 0 && m.normals[i * 3 + 1] > 0, 'the normal leans west, down the slope')
	assert.ok(Math.abs(m.normals[i * 3 + 2]) < 1e-6)
	assert.ok(Math.abs(m.positions[GROUND_CELLS * 3] - TILE_YARDS) < 1e-3, "the tile's east edge is a tile off")
})

test("a hole cell gets no triangles, and the ground's top faces up", () => {
	const all = groundMesh(parseGround(reply(() => 0)))
	const holed = groundMesh(parseGround(reply(() => 0, [[0, 0], [9, 3]])))
	assert.equal(all.index.length, GROUND_CELLS * GROUND_CELLS * 6)
	assert.equal(holed.index.length, all.index.length - 12)
	// The first triangle's normal by the right-hand rule points up (+y).
	const p = all.positions
	const [a, b, c] = [all.index[0], all.index[1], all.index[2]]
	const e1 = [p[b * 3] - p[a * 3], p[b * 3 + 2] - p[a * 3 + 2]]
	const e2 = [p[c * 3] - p[a * 3], p[c * 3 + 2] - p[a * 3 + 2]]
	// y of e1 × e2 = e1.z * e2.x - e1.x * e2.z.
	assert.ok(e1[1] * e2[0] - e1[0] * e2[1] > 0)
})

test('the tiles wanted are the map’s within reach, nearest first, and loaded ones are kept a tile further', () => {
	const have = new Set<number>()
	for (let y = 30; y < 36; y++) for (let x = 30; x < 36; x++) have.add(tileKey(x, y))
	// The camera in tile 32_33, near its east edge.
	const x = 32.9 * TILE_YARDS
	const z = 33.5 * TILE_YARDS
	const w = wantedTiles(x, z, TILE_YARDS, have)
	assert.equal(w[0], tileKey(32, 33))
	assert.equal(w[1], tileKey(33, 33), 'the tile just east comes next')
	for (const k of w) assert.ok(tileDistance(x, z, k % 64, Math.floor(k / 64)) <= TILE_YARDS)
	assert.ok(!w.includes(tileKey(30, 33)), 'two tiles west is out of reach')
	assert.ok(w.includes(tileKey(31, 33)))
	// Off the map's tiles nothing is wanted, however near.
	assert.deepEqual(wantedTiles(10 * TILE_YARDS, 10 * TILE_YARDS, 3 * TILE_YARDS, have), [])
	assert.equal(keepReach(TILE_YARDS), 2 * TILE_YARDS)
	assert.equal(tileDistance(x, z, 32, 33), 0)
})

test('the reach follows the view distance, 3 tiles by default, 1 to 6', () => {
	assert.equal(streamReach(1), 3 * TILE_YARDS)
	assert.equal(streamReach(0.1), TILE_YARDS)
	assert.equal(streamReach(5), 6 * TILE_YARDS)
})
