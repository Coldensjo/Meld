// Run with: bun test tests/worldGround.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tileKey } from '../src/lib/io/mapTiles.ts'
import { TILE_SIZE as TILE_YARDS } from '../src/lib/io/portCoords.ts'
import { GROUND_CELLS, GROUND_SIDE, groundHeight, groundMesh, groundStride, keepReach, marchGround, parseGround, streamReach, tileDistance, TileModelShare, wantedTiles, type TileModel } from '../src/lib/world/worldGround.ts'

/** A /wow/ground reply (wow.EncodeGround) for heights f(x, y) and the hole cells listed, with chunk (3, 2) in area 1519, impassable, and no tufts on cell (30, 17). */
function reply(f: (x: number, y: number) => number, holes: Array<[number, number]> = []): ArrayBuffer {
	const n = GROUND_SIDE * GROUND_SIDE
	const cells = GROUND_CELLS * GROUND_CELLS
	const buf = new ArrayBuffer(4 + n * 4 + cells + 256 * 5 + cells)
	new Uint8Array(buf, 0, 4).set([...'GRND'].map((c) => c.charCodeAt(0)))
	const v = new DataView(buf)
	for (let y = 0; y < GROUND_SIDE; y++) for (let x = 0; x < GROUND_SIDE; x++) v.setFloat32(4 + (y * GROUND_SIDE + x) * 4, f(x, y), true)
	const h = new Uint8Array(buf, 4 + n * 4)
	for (const [x, y] of holes) h[y * GROUND_CELLS + x] = 1
	const areas = 4 + n * 4 + cells
	v.setUint32(areas + (2 * 16 + 3) * 4, 1519, true)
	new Uint8Array(buf)[areas + 256 * 4 + 2 * 16 + 3] = 1
	new Uint8Array(buf)[areas + 256 * 5 + 17 * GROUND_CELLS + 30] = 1
	return buf
}

test('a ground reply reads back as its heights and holes, and a bad one is refused', () => {
	const g = parseGround(reply((x, y) => x - 2 * y, [[5, 7]]))
	assert.equal(g.heights[3 * GROUND_SIDE + 10], 10 - 6)
	assert.equal(g.holes[7 * GROUND_CELLS + 5], 1)
	assert.equal(
		g.holes.reduce((a, b) => a + b, 0),
		1,
	)
	assert.equal(g.areas[2 * 16 + 3], 1519)
	assert.equal(
		g.areas.reduce((a, b) => a + b, 0),
		1519,
	)
	assert.equal(g.impassable[2 * 16 + 3], 1)
	assert.equal(
		g.impassable.reduce((a, b) => a + b, 0),
		1,
	)
	assert.equal(g.noEffect[17 * GROUND_CELLS + 30], 1)
	assert.equal(
		g.noEffect.reduce((a, b) => a + b, 0),
		1,
	)
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
	const holed = groundMesh(
		parseGround(
			reply(
				() => 0,
				[
					[0, 0],
					[9, 3],
				],
			),
		),
	)
	assert.equal(all.index.length, GROUND_CELLS * GROUND_CELLS * 6 + 4 * GROUND_CELLS * 6)
	// Cell 0_0's two triangles and its stretch of the north and west skirts; cell 9_3's two.
	assert.equal(holed.index.length, all.index.length - 24)
	// The first triangle's normal by the right-hand rule points up (+y).
	const p = all.positions
	const [a, b, c] = [all.index[0], all.index[1], all.index[2]]
	const e1 = [p[b * 3] - p[a * 3], p[b * 3 + 2] - p[a * 3 + 2]]
	const e2 = [p[c * 3] - p[a * 3], p[c * 3 + 2] - p[a * 3 + 2]]
	// y of e1 × e2 = e1.z * e2.x - e1.x * e2.z.
	assert.ok(e1[1] * e2[0] - e1[0] * e2[1] > 0)
})

test('a far tile is drawn at a coarser stride, a coarse cell a hole only when all its cells are', () => {
	assert.equal(groundStride(0), 1)
	assert.equal(groundStride(TILE_YARDS * 0.49), 1)
	assert.equal(groundStride(TILE_YARDS), 2)
	assert.equal(groundStride(TILE_YARDS * 2), 4)
	const flat = parseGround(reply(() => 7))
	for (const stride of [2, 4] as const) {
		const m = groundMesh(flat, stride)
		const n = GROUND_CELLS / stride + 1
		assert.equal(m.positions.length, (n * n + 4 * n) * 3, 'a skirt on each edge')
		assert.equal(m.index.length, (n - 1) * (n - 1) * 6 + 4 * (n - 1) * 6)
		assert.equal(m.positions[n * n * 3 + 1], 5, 'flat ground hangs its skirts the margin deep')
		assert.ok(Math.abs(m.positions[(n - 1) * 3] - TILE_YARDS) < 1e-3, 'the east edge is still a tile off')
		assert.equal(m.positions[1], 7)
	}
	// Cells 0-3 x 0-1 are holes: at stride 2 coarse cells (0, 0) and (1, 0) are wholly holes; at
	// stride 4 coarse cell (0, 0) still has solid cells.
	const holes: Array<[number, number]> = []
	for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) holes.push([x, y])
	const holed = parseGround(reply(() => 0, holes))
	// The skirts leave out the holes' stretches of edge too: two of the north's, one of the west's.
	assert.equal(groundMesh(holed, 2).index.length, (64 * 64 - 2) * 6 + (4 * 64 - 3) * 6)
	assert.equal(groundMesh(holed, 4).index.length, 32 * 32 * 6 + 4 * 32 * 6)
})

test('an edge whose ground strays between the strides hangs its skirt below the stray, facing out', () => {
	// The north edge zigzags 3 yards a sample; the rest of the tile is flat.
	const g = parseGround(reply((x, y) => (y === 0 && x % 2 ? 3 : 0)))
	const m = groundMesh(g, 4)
	const n = GROUND_CELLS / 4 + 1
	// The north skirt's vertices come first, along the north edge (z 0), more than the stray below it;
	// the east skirt's after them, only the margin below the flat ground.
	for (let q = 0; q < n; q++) {
		const v = n * n + q
		assert.equal(m.positions[v * 3 + 2], 0)
		assert.ok(m.positions[v * 3 + 1] < -3)
	}
	assert.equal(m.positions[(n * n + n + 1) * 3 + 1], -2)
	// Its first triangle faces north (-z), out of the tile.
	const p = m.positions
	const t = (n - 1) * (n - 1) * 6
	const [a, b, c] = [m.index[t], m.index[t + 1], m.index[t + 2]]
	const e1 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]]
	const e2 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]]
	assert.ok(e1[0] * e2[1] - e1[1] * e2[0] < 0, 'the z of e1 x e2 is negative')
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

test('a model several tiles list is placed once, and taken away with the last of them', () => {
	const model = (uid: number, type: string): TileModel => ({ uid, type, x: 0, y: 0, z: 0, rotY: 0, tiltX: 0, tiltZ: 0, scale: 1 })
	const share = new TileModelShare()
	const placed: string[] = []
	const removed: number[] = []
	let next = 1
	const ids = new Map<number, string>()
	const place = (m: TileModel) => {
		placed.push(m.type)
		ids.set(next, m.type)
		return next++
	}
	const remove = (id: number) => removed.push(id)
	// Tile A lists the inn (5) twice and a tree without an ID; tile B the inn and a rock (6).
	share.add(1, [model(5, 'inn'), model(0, 'tree'), model(5, 'inn')], place)
	share.add(2, [model(5, 'inn'), model(6, 'rock')], place)
	assert.deepEqual(placed, ['inn', 'tree', 'rock'])
	assert.equal(share.count, 3)
	// A tile added again is not placed twice.
	share.add(2, [model(5, 'inn'), model(6, 'rock')], place)
	assert.equal(placed.length, 3)
	// Letting go of A takes its tree; the inn stays, B lists it.
	share.drop(1, remove)
	assert.deepEqual(
		removed.map((id) => ids.get(id)),
		['tree'],
	)
	assert.equal(share.count, 2)
	share.drop(2, remove)
	assert.deepEqual(removed.map((id) => ids.get(id)).sort(), ['inn', 'rock', 'tree'])
	assert.equal(share.count, 0)
	// A tile that was never added drops nothing.
	share.drop(3, remove)
	assert.equal(removed.length, 3)
})

test('marchGround finds where a ray meets the ground, passing over unloaded ground', () => {
	// Flat ground at 10 from x = 100 on, nothing loaded before it.
	const h = (x: number) => (x < 100 ? NaN : 10)
	// From (0, 50) down at 45 degrees: under the ground at x = 40, but nothing is loaded there; meets it at x = 100.
	const s = Math.SQRT1_2
	const t = marchGround(h, 0, 50, 0, s, -s, 0, 3000, 8)
	assert.ok(Math.abs(t - 100 * Math.SQRT2) < 0.5, `t ${t}`)
	// Flat loaded ground: a ray down 30 degrees from 20 yards up meets it 20 yards below, 40 along.
	const t2 = marchGround(() => 0, 0, 20, 0, Math.cos(Math.PI / 6), -0.5, 0, 3000, 8)
	assert.ok(Math.abs(t2 - 40) < 0.1, `t2 ${t2}`)
	// Looking up, or nothing within reach: -1.
	assert.equal(
		marchGround(() => 0, 0, 20, 0, 0, 1, 0, 3000, 8),
		-1,
	)
	assert.equal(
		marchGround(() => NaN, 0, 20, 0, 0, -1, 0, 3000, 8),
		-1,
	)
})
