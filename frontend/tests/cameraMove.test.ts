// Run with: bun test tests/cameraMove.test.ts
// The camera's collision step (#434) against a toy WMO room, through the same wmoRoom.ts queries the
// Engine's hooks use (`WmoRooms.collide` and `floorAt`), with the editor's axes taken to WoW's as
// `toModel` does. The live checks are the `wmo-collide` and `walk-wmo` probes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { COLLIDE_HEIGHT, WALK_HEIGHT, cornerFactor, moveStep, nearPlane, roomFloor, walkFloor, type CameraMoveRules } from '../src/lib/engine/cameraMove.ts'
import { collideSphere, nearestFaceDist, walkFloorZ, type WmoNav } from '../src/lib/world/wmoRoom.ts'

/** The Engine's 3D camera: its near plane (`NEAR`, `NEAR_MIN`) and field of view, at a 16:9 window. */
const NEAR = 0.5
const NEAR_MIN = 0.05
const CORNER = cornerFactor(55, 16 / 9)
/** The radius the Engine keeps the eye off a WMO's faces: the near plane's reach to a corner. */
const RADIUS = NEAR * CORNER

type Tri = number[]

/** A level quad at editor height y over x0..x1, z0..z1, as two WoW-axis triangles (x, -z, y). */
function level(y: number, x0: number, x1: number, z0: number, z1: number): Tri[] {
	return [
		[x0, -z0, y, x1, -z0, y, x1, -z1, y],
		[x0, -z0, y, x1, -z1, y, x0, -z1, y],
	]
}

/** A wall in the plane x = x0 over z0..z1, from editor height y0 to y1. */
function wallX(x: number, z0: number, z1: number, y0: number, y1: number): Tri[] {
	return [
		[x, -z0, y0, x, -z1, y0, x, -z1, y1],
		[x, -z0, y0, x, -z1, y1, x, -z0, y1],
	]
}

/** One group, editor x 0..20, z 0..20, y 10..20: a room whose faces are all walking faces. */
function room(tris: Tri[]): WmoNav {
	return {
		groups: [{ flags: 0, min: [0, -20, 10], max: [20, 0, 20], refStart: 0, refCount: 0, fogs: [0, 0, 0, 0], name: '' }],
		portalVerts: [],
		portals: [],
		refs: [],
		fogs: [],
		walk: [new Float32Array(tris.flat())],
		camera: [new Float32Array()],
	}
}

/** The street: a floor at y 10 with a wall at x 20, and the terrain at y 15 above it, as under Stormwind. */
const STREET = [...level(10, 0, 20, 0, 20), ...wallX(20, 0, 20, 10, 20)]
const TERRAIN = 15

const sphereA = [0, 0, 0]
const sphereB = [0, 0, 0]

/** The camera's fields, with the Engine's hooks on `nav` and a flat terrain at `terrain`. */
function rules(nav: WmoNav, terrain = TERRAIN, over: Partial<CameraMoveRules> = {}): CameraMoveRules {
	return {
		walk: false,
		followGround: false,
		topDown: false,
		collision: true,
		ground: () => terrain,
		collideWalls: (from, to) => {
			sphereA[0] = from.x
			sphereA[1] = -from.z
			sphereA[2] = from.y
			sphereB[0] = to.x
			sphereB[1] = -to.z
			sphereB[2] = to.y
			if (collideSphere(nav, sphereA, sphereB, RADIUS)) to.set(sphereB[0], sphereB[2], -sphereB[1])
		},
		collisionFloor: (at, ground) => {
			const g = nav.groups[0]
			const inRoom = at.x >= g.min[0] && at.x <= g.max[0] && -at.z >= g.min[1] && -at.z <= g.max[1] && at.y >= g.min[2] && at.y <= g.max[2]
			return roomFloor(inRoom, walkFloorZ(nav, at.x, -at.z, at.y), ground)
		},
		...over,
	}
}

const scratch = { floor: new THREE.Vector3(), wall: new THREE.Vector3() }

/** One step from `settled` to `target`; returns the target where it stops. */
function step(r: CameraMoveRules, settled: number[], target: number[], jumped = false) {
	const t = new THREE.Vector3(...target)
	moveStep(t, new THREE.Vector3(...settled), jumped, r, scratch)
	return t
}

const near = (a: number, b: number, what: string, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${what}: ${a}, not ${b}`)

test('the radius is the near plane reach to a corner: 0.73 yd at 16:9, about 0.9 yd at a wider window', () => {
	near(RADIUS, 0.729, 'radius at 16:9')
	assert.ok(NEAR * cornerFactor(55, 2.4) > RADIUS, 'wider, further')
})

test('the flying camera stops its radius off a wall, however far it moves in a frame, and slides along it (#305)', () => {
	const r = rules(room(STREET))
	// Above the terrain + 3 past the wall, so the clamp leaves the height.
	let t = step(r, [5, 19, 10], [500, 19, 10])
	near(t.x, 20 - RADIUS, 'off the wall')
	near(t.y, 19, 'height kept')
	t = step(r, [17, 19, 10], [22, 19, 16])
	near(t.x, 20 - RADIUS, 'slid: off the wall')
	near(t.z, 16, 'slid: along it')
})

test('the flying camera stays 3 yd over a WMO floor in its room, not over the terrain (#310)', () => {
	const r = rules(room(STREET))
	// Lowered towards the street, below the terrain over it.
	let t = step(r, [5, 14, 10], [5, 11, 10])
	near(t.y, 10 + COLLIDE_HEIGHT, 'over the street')
	assert.ok(t.y < TERRAIN, 'below the terrain')
	// A fast drop through the floor still finds it, from where the eye was.
	t = step(r, [5, 14, 10], [5, -40, 10])
	near(t.y, 10 + COLLIDE_HEIGHT, 'dropped through')
	// Out of the room, over the terrain.
	t = step(r, [40, 20, 40], [40, 5, 40])
	near(t.y, TERRAIN + COLLIDE_HEIGHT, 'over the terrain')
})

test('the floor clamp comes before the walls: under a low ceiling the walls win (#310, #305)', () => {
	// A ceiling 3.2 yd over the street: floor + 3 lies within the radius of it.
	const r = rules(room([...STREET, ...level(13.2, 0, 20, 0, 20)]))
	const t = step(r, [5, 12, 10], [5, 11, 10])
	near(t.y, 13.2 - RADIUS, 'kept off the ceiling')
	assert.ok(t.y < 10 + COLLIDE_HEIGHT, 'the walls won over the clamp')
})

test('the walker stands 3 yd over a WMO floor, climbs a step, walks under a roof and stops at a wall whatever the collision pref (#312, #313)', () => {
	const tris = [...STREET, ...level(11.5, 8, 12, 0, 20), ...level(16, 2, 4, 0, 20)]
	for (const collision of [true, false]) {
		const r = rules(room(tris), TERRAIN, { walk: true, collision })
		const eye = 10 + WALK_HEIGHT
		let t = step(r, [1, eye, 10], [6, eye, 10])
		near(t.y, eye, `on the street (collision ${collision})`)
		t = step(r, [6, eye, 10], [10, eye, 10])
		near(t.y, 11.5 + WALK_HEIGHT, `up the step (collision ${collision})`)
		t = step(r, [1, eye, 10], [3, eye, 10])
		near(t.y, eye, `under the roof (collision ${collision})`)
		t = step(r, [15, eye, 10], [30, eye, 10])
		near(t.x, 20 - RADIUS, `stopped at the wall (collision ${collision})`)
		near(t.y, eye, `still on the street (collision ${collision})`)
	}
})

test('the walk starts on the floor below the eye, the street under a camera over a city (#312)', () => {
	const r = rules(room(STREET), TERRAIN, { walk: true })
	near(walkFloor(new THREE.Vector3(5, 19, 10), 19, true, r, scratch.floor), 10, 'the street')
	near(walkFloor(new THREE.Vector3(40, 19, 40), 19, true, r, scratch.floor), TERRAIN, 'the terrain out of the room')
})

test('with collision off the flying camera passes through walls, floors and the terrain', () => {
	const r = rules(room(STREET), TERRAIN, { collision: false })
	const t = step(r, [5, 14, 10], [30, -5, 10])
	assert.deepEqual(t.toArray(), [30, -5, 10])
})

test('a jump is not collided, and the orbit and top-down cameras are left alone', () => {
	let t = step(rules(room(STREET)), [5, 14, 10], [20, 14, 10], true)
	near(t.x, 20, 'jumped into the wall')
	for (const over of [{ followGround: true }, { topDown: true }]) {
		t = step(rules(room(STREET), TERRAIN, over), [5, 14, 10], [30, 0, 10])
		assert.deepEqual(t.toArray(), [30, 0, 10], JSON.stringify(over))
	}
})

test('the near plane pulls in for a face within its reach, to no less than 0.05 yd (#304)', () => {
	const nav = room(STREET)
	const reach = NEAR * CORNER
	const dist = (x: number) => nearestFaceDist(nav, x, -10, 14, reach)
	near(nearPlane(dist(10), CORNER, NEAR, NEAR_MIN), NEAR, 'no face near')
	const d = dist(19.5)
	near(d, 0.5, 'wall distance')
	near(nearPlane(d, CORNER, NEAR, NEAR_MIN), 0.5 / CORNER, 'pulled in')
	near(nearPlane(dist(19.99), CORNER, NEAR, NEAR_MIN), NEAR_MIN, 'against the wall')
})

test('in a room the WMO floor wins over the terrain; outside it the higher of the two, so a roof is a floor', () => {
	assert.equal(roomFloor(true, 10, 15), 10)
	assert.equal(roomFloor(false, 10, 15), 15)
	assert.equal(roomFloor(false, 20, 15), 20)
	assert.equal(roomFloor(true, -Infinity, 15), 15)
})
