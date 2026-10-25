// Run with: bun test tests/wmoRoom.test.ts
// The cases are Benilla's own for `down_ray_pick` (wmo_portal/seed.rs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildColumnGrid, collideSphere, downRayPick, walkFloorZ, EXTERIOR, nearestFaceDist, triangleDistSq, triangleZAt, type WmoNav, type WmoNavGroup, type WmoPortalRef } from '../src/lib/world/wmoRoom.ts'

type Tri = number[] // nine floats

function group(flags: number, min: number[], max: number[], refStart = 0, refCount = 0): WmoNavGroup {
	return { flags, min: min as [number, number, number], max: max as [number, number, number], refStart, refCount, fogs: [0, 0, 0, 0], name: '' }
}

/** A horizontal floor quad (two triangles, radius r) at height z. */
function quad(z: number, r: number): Tri[] {
	return [
		[-r, -r, z, r, -r, z, r, r, z],
		[-r, -r, z, r, r, z, -r, r, z],
	]
}

function nav(groups: WmoNavGroup[], walk: Tri[][], opts: Partial<Pick<WmoNav, 'portalVerts' | 'portals' | 'refs'>> & { camera?: Tri[][] } = {}): WmoNav {
	const flat = (t: Tri[] | undefined) => new Float32Array((t ?? []).flat())
	return {
		groups,
		portalVerts: opts.portalVerts ?? [],
		portals: opts.portals ?? [],
		refs: opts.refs ?? [],
		fogs: [],
		walk: groups.map((_, i) => flat(walk[i])),
		camera: groups.map((_, i) => flat(opts.camera?.[i])),
	}
}

const pick = (n: WmoNav, eye: number[], terrain: number | null = null) => downRayPick(n, eye[0], eye[1], eye[2], terrain)

test('the walking leg picks the group of the nearest face below', () => {
	const n = nav([group(0, [-30, -30, 0], [30, 30, 100]), group(0, [-5, -5, 10], [5, 5, 16])], [quad(0, 30), quad(10, 5)])
	assert.equal(pick(n, [0, 0, 12]).inGroup, 1)
	assert.equal(pick(n, [0, 0, 5]).inGroup, 0)
	assert.equal(pick(n, [20, 20, 5]).inGroup, 0)
	assert.equal(pick(n, [0, 0, 5000]).inGroup, null, 'past the ray')
})

test('the walking leg has no orientation filter, and an exterior group is outside', () => {
	const steep = [[-1, -1, 0, 1, -1, 0, 0, 1, 20]]
	assert.equal(pick(nav([group(0, [-10, -10, 0], [10, 10, 120])], [steep]), [0, 0, 30]).inGroup, 0)
	assert.equal(pick(nav([group(EXTERIOR, [-30, -30, 0], [30, 30, 100])], [quad(0, 30)]), [0, 0, 5]).inGroup, null)
})

test('the floor under the eye is the highest walking face at or below it, whatever the group (#310)', () => {
	const n = nav([group(EXTERIOR, [-30, -30, 0], [30, 30, 100]), group(0, [-5, -5, 10], [5, 5, 16])], [quad(0, 30), quad(10, 5)])
	assert.equal(walkFloorZ(n, 0, 0, 12), 10)
	assert.equal(walkFloorZ(n, 0, 0, 9), 0)
	assert.equal(walkFloorZ(n, 20, 20, 50), 0, 'an exterior floor counts')
	assert.equal(walkFloorZ(n, 0, 0, -1), -Infinity, 'under every floor')
	assert.equal(walkFloorZ(n, 40, 0, 5), -Infinity, 'off the floors')
})

/** The Goldshire stairs: group 0 the stairwell (floor z 0), group 1 the taproom over its floor-hole portal at z 10. */
function stairwell(normalUp: boolean, slab = false): WmoNav {
	const refs: WmoPortalRef[] = normalUp
		? [
				{ portal: 0, group: 1, side: -1 },
				{ portal: 0, group: 0, side: 1 },
			]
		: [
				{ portal: 0, group: 1, side: 1 },
				{ portal: 0, group: 0, side: -1 },
			]
	return nav([group(0, [-5, -5, 0], [5, 5, 11], 0, 1), group(0, [-20, -20, 10], [20, 20, 20], 1, 1)], [slab ? [...quad(0, 5), ...quad(10, 5)] : quad(0, 5), []], {
		portalVerts: [-5, -5, 10, 5, -5, 10, 5, 5, 10, -5, 5, 10],
		portals: [{ start: 0, count: 4, plane: normalUp ? [0, 0, 1, -10] : [0, 0, -1, 10] }],
		refs,
	})
}

test('a portal crossing flips the group and seeds both sides', () => {
	const n = stairwell(true)
	assert.deepEqual(pick(n, [0, 0, 12]), { inGroup: 1, across: 0 })
	assert.deepEqual(pick(n, [0, 0, 5]), { inGroup: 0, across: null })
	assert.deepEqual(pick(n, [10, 10, 12]), { inGroup: null, across: null }, 'beside the hole: no floor, outside')
})

test('the crossing follows the side orientation, and wins a tie with a coincident face', () => {
	const down = stairwell(false)
	assert.equal(pick(down, [0, 0, 12]).inGroup, 1)
	assert.equal(pick(down, [0, 0, 5]).inGroup, 0)
	assert.equal(pick(stairwell(true, true), [0, 0, 12]).inGroup, 1)
})

test('a vertical doorway counts only within the snap of its plane', () => {
	const a = [
		[-10, -10, 0, 0.5, -10, 0, 0.5, 10, 0],
		[-10, -10, 0, 0.5, 10, 0, -10, 10, 0],
	]
	const b = [
		[0.5, -10, 0, 10, -10, 0, 10, 10, 0],
		[0.5, -10, 0, 10, 10, 0, 0.5, 10, 0],
	]
	const n = nav([group(0, [-10, -10, 0], [0.5, 10, 10], 0, 1), group(0, [-0.5, -10, 0], [10, 10, 10], 1, 1)], [a, b], {
		portalVerts: [0, -2, 0, 0, 2, 0, 0, 2, 4, 0, -2, 4],
		portals: [{ start: 0, count: 4, plane: [1, 0, 0, 0] }],
		refs: [
			{ portal: 0, group: 1, side: -1 },
			{ portal: 0, group: 0, side: 1 },
		],
	})
	assert.deepEqual(pick(n, [0.05, 0, 1.7]), { inGroup: 1, across: 0 })
	assert.deepEqual(pick(n, [0.3, 0, 1.7]), { inGroup: 0, across: null })
})

test('the terrain race drops a buried interior but spares a tunnel under a hill', () => {
	const mine = nav([group(0, [-20, -20, 0], [20, 20, 10])], [quad(0, 20)])
	assert.equal(pick(mine, [0, 0, 2]).inGroup, 0)
	assert.equal(pick(mine, [0, 0, 2], 8).inGroup, 0, 'terrain above the eye is off the ray')
	assert.equal(pick(mine, [0, 0, 12], 8).inGroup, null, 'ground between the eye and the floor')
	assert.equal(pick(mine, [0, 0, 2], 0).inGroup, 0, 'a tie keeps the WMO')
	assert.equal(pick(mine, [0, 0, 2], 0.1).inGroup, null)
})

test('the camera-only fallback names a room floored only with detail faces', () => {
	const pocket = group(0, [-10, -10, 0], [10, 10, 12])
	const n = nav([pocket], [[]], { camera: [quad(0, 10)] })
	assert.deepEqual(pick(n, [0, 0, 2]), { inGroup: 0, across: null })
	assert.equal(pick(n, [0, 0, 2], 8).inGroup, 0)
	assert.equal(pick(n, [0, 0, 2], 1.9).inGroup, null, 'terrain below the eye keeps it outside')
	const hall = nav([pocket, group(0, [-30, -30, -5], [30, 30, 12])], [[], quad(-5, 30)], { camera: [quad(0, 10), []] })
	assert.equal(pick(hall, [0, 0, 2]).inGroup, 1, 'a walking face pre-empts the fallback')
	assert.equal(pick(nav([group(EXTERIOR, [-10, -10, 0], [10, 10, 12])], [[]], { camera: [quad(0, 10)] }), [0, 0, 2]).inGroup, null)
})

test('triangleZAt interpolates inside and rejects outside', () => {
	assert.equal(triangleZAt([0, 0, 4, 10, 0, 4, 0, 10, 4], 0, 1, 1), 4)
	assert.ok(Number.isNaN(triangleZAt([0, 0, 4, 10, 0, 4, 0, 10, 4], 0, 9, 9)))
	assert.equal(triangleZAt([0, 0, 0, 10, 0, 10, 0, 10, 0], 0, 5, 0), 5)
	assert.ok(Number.isNaN(triangleZAt([0, 0, 0, 0, 0, 10, 10, 0, 5], 0, 0, 0)))
})

test('the column index never changes a pick', () => {
	// Three storeys of small tiles over the same ground, each tile at its own height, plus one slab
	// big enough to span the grid.
	const storey = (z: number): Tri[] => {
		const out: Tri[] = []
		for (let ix = 0; ix < 10; ix++)
			for (let iy = 0; iy < 10; iy++) {
				const x = ix * 3,
					y = iy * 3,
					tz = z + ((ix + iy) % 4) * 0.25
				out.push([x, y, tz, x + 3, y, tz, x + 3, y + 3, tz], [x, y, tz, x + 3, y + 3, tz, x, y + 3, tz])
			}
		return out
	}
	const slab: Tri = [0, 0, 4, 30, 0, 4, 30, 30, 4]
	const groups = [0, 1, 2].map((i) => group(0, [0, 0, i * 8], [30, 30, i * 8 + 8]))
	const linear = nav(groups, [[...storey(0), slab], storey(8), storey(16)])
	const indexed = { ...linear, walkGrids: linear.walk.map(buildColumnGrid) }
	assert.ok(
		indexed.walkGrids.every((g) => g !== null),
		'each storey is indexed',
	)
	assert.ok(indexed.walkGrids[0]!.spanning.length === 1, 'the slab is tested for every column')
	let hits = 0
	for (let gx = -1; gx <= 32; gx++)
		for (let gy = -1; gy <= 32; gy++)
			for (const ez of [1, 5, 9.5, 17, 25]) {
				const eye = [gx * 0.97, gy * 1.03, ez]
				const a = pick(linear, eye)
				assert.deepEqual(pick(indexed, eye), a, `column ${eye}`)
				if (a.inGroup !== null) hits++
			}
	assert.ok(hits > 1000, `the sweep lands on the storeys: ${hits}`)
})

test('the distance to a face is to its nearest point: inside, along an edge or at a corner', () => {
	const t = [0, 0, 0, 4, 0, 0, 0, 4, 0]
	const near = (p: number[], want: number) => assert.ok(Math.abs(Math.sqrt(triangleDistSq(t, 0, p[0], p[1], p[2])) - want) < 1e-9, `${p}`)
	near([1, 1, 0.3], 0.3)
	near([1, 1, -2], 2)
	near([2, -1, 0], 1)
	near([-3, -4, 0], 5)
	near([5, 0, 0], 1)
	near([3, 3, 0], Math.SQRT2)
	near([0, 6, 1], Math.sqrt(5))
})

test('the nearest face is found within reach, walls and camera faces included, and the index changes nothing', () => {
	// A room: a floor tiled finely enough to be indexed, a wall at x = 10 and a camera-only beam.
	const floor: Tri[] = []
	for (let ix = 0; ix < 10; ix++)
		for (let iy = 0; iy < 10; iy++) {
			const x = ix,
				y = iy
			floor.push([x, y, 0, x + 1, y, 0, x + 1, y + 1, 0], [x, y, 0, x + 1, y + 1, 0, x, y + 1, 0])
		}
	const wall: Tri[] = [
		[10, 0, 0, 10, 10, 0, 10, 10, 5],
		[10, 0, 0, 10, 10, 5, 10, 0, 5],
	]
	const beam: Tri[] = [[0, 5, 4, 10, 5, 4, 5, 5.5, 4]]
	const linear = nav([group(0, [0, 0, 0], [10, 10, 5])], [[...floor, ...wall]], { camera: [beam] })
	const indexed = { ...linear, walkGrids: linear.walk.map(buildColumnGrid) }
	assert.ok(indexed.walkGrids[0], 'the floor is indexed')
	for (const n of [linear, indexed]) {
		assert.ok(Math.abs(nearestFaceDist(n, 9.6, 3, 2, 2) - 0.4) < 1e-6, 'the wall')
		assert.ok(Math.abs(nearestFaceDist(n, 2, 3, 0.3, 2) - 0.3) < 1e-6, 'the floor')
		assert.ok(Math.abs(nearestFaceDist(n, 3, 5.2, 3.5, 2) - 0.5) < 1e-6, 'the camera-only beam')
		assert.equal(nearestFaceDist(n, 5, 3, 2.5, 2), Infinity, 'nothing within reach')
		assert.equal(nearestFaceDist(n, 30, 3, 2, 2), Infinity, 'outside the group box')
		assert.ok(Math.abs(nearestFaceDist(n, 11, 3, 2, 2) - 1) < 1e-6, 'from outside the box, within reach')
	}
})

test('a sphere moved into a wall stops its radius off it and slides along, however fast, and is pushed out of one it ends near', () => {
	// The room of the test above: a floor indexed by columns, a wall at x = 10 facing the room.
	const floor: Tri[] = []
	for (let ix = 0; ix < 10; ix++) for (let iy = 0; iy < 10; iy++) floor.push([ix, iy, 0, ix + 1, iy, 0, ix + 1, iy + 1, 0], [ix, iy, 0, ix + 1, iy + 1, 0, ix, iy + 1, 0])
	const wall: Tri[] = [
		[10, 0, 0, 10, 10, 0, 10, 10, 5],
		[10, 0, 0, 10, 10, 5, 10, 0, 5],
	]
	const linear = nav([group(0, [0, 0, 0], [10, 10, 5])], [[...floor, ...wall]])
	const indexed = { ...linear, walkGrids: linear.walk.map(buildColumnGrid) }
	const close = (a: number[], b: number[], what: string) =>
		assert.ok(
			a.every((v, i) => Math.abs(v - b[i]) < 1e-3),
			`${what}: ${a}`,
		)
	for (const n of [linear, indexed]) {
		// Straight at the wall, far past it in one step (a thin wall, a fast flight).
		let b = [500, 3, 2]
		assert.ok(collideSphere(n, [5, 3, 2], b, 0.75))
		close(b, [9.25, 3, 2], 'stopped short of the wall')
		// At a slant: it keeps the move along the wall.
		b = [12, 7, 2]
		collideSphere(n, [8, 3, 2], b, 0.75)
		close(b, [9.25, 7, 2], 'slid along the wall')
		// Down at the floor.
		b = [3, 3, -4]
		collideSphere(n, [3, 3, 2], b, 0.75)
		close(b, [3, 3, 0.75], 'stopped over the floor')
		// A move that ends near the wall without crossing it is pushed out to the radius.
		b = [9.6, 3, 2]
		assert.ok(collideSphere(n, [8, 3, 2], b, 0.75))
		assert.ok(Math.abs(b[0] - 9.25) < 1e-3 && b[1] === 3 && b[2] === 2, `pushed out: ${b}`)
		// Nothing in the way: unchanged.
		b = [6, 4, 3]
		assert.equal(collideSphere(n, [4, 4, 3], b, 0.75), false)
		close(b, [6, 4, 3], 'free')
	}
})
