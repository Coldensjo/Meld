// Run with: bun test tests/wmoRooms.test.ts
// The camera's WMO room (`WmoRooms.update`) and the room gate built on it, as Engine.updateRoomGate
// composes them: the portal flood from the camera's room, the gate's mask (`roomGate.ts`) and what
// stands in a reached room (`RoomAdmit`), on a fake object layer, so the rules of #142 (a hidden
// building gates nothing), #156 (the camera's room's spawns are drawn) and #300 (the eye must be in
// the room's box) are checked without the probes' client and 90 s runs.
import './runes.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { ModelAsset } from '../src/lib/models/assets.ts'
import type { WorldObject } from '../src/lib/world/ObjectLayer.ts'
import { WmoRooms, type RoomLayer } from '../src/lib/world/WmoRooms.ts'
import { RoomFlood } from '../src/lib/world/wmoFlood.ts'
import { RoomAdmit } from '../src/lib/world/roomAdmit.ts'
import { addRoomGate, beginRoomGates, endRoomGates, patchRoomGate, ROOM_MAX_GATED, ROOM_MAX_GROUPS } from '../src/lib/world/roomGate.ts'
import { toModel, type WmoNav, type WmoNavGroup } from '../src/lib/world/wmoRoom.ts'

function group(min: number[], max: number[], refStart: number, refCount: number): WmoNavGroup {
	return { flags: 0, min: min as [number, number, number], max: max as [number, number, number], refStart, refCount, fogs: [0, 0, 0, 0], name: '' }
}

/** A floor from x0 to x1 (|y| up to 10) at height 0, in WoW axes. */
function floor(x0: number, x1: number): Float32Array {
	return Float32Array.from([x0, -10, 0, x1, -10, 0, x1, 10, 0, x0, -10, 0, x1, 10, 0, x0, 10, 0])
}

/**
 * In WoW axes: room A (x -10 to 0) opens through a doorway at x = 0 onto B (0 to 10), and B through
 * one at x = 10 onto C (10 to 20); D (20 to 30) is sealed, and twice as tall (20 yd), so the
 * building's top is above A's. Every room has a floor at height 0.
 */
function building(): WmoNav {
	const door = (x: number) => [x, -2, 0, x, 2, 0, x, 2, 4, x, -2, 4]
	return {
		groups: [group([-10, -10, 0], [0, 10, 10], 0, 1), group([0, -10, 0], [10, 10, 10], 1, 2), group([10, -10, 0], [20, 10, 10], 3, 1), group([20, -10, 0], [30, 10, 20], 4, 0)],
		portalVerts: [...door(0), ...door(10)],
		portals: [
			{ start: 0, count: 4, plane: [1, 0, 0, 0] },
			{ start: 4, count: 4, plane: [1, 0, 0, -10] },
		],
		refs: [
			{ portal: 0, group: 1, side: -1 },
			{ portal: 0, group: 0, side: 1 },
			{ portal: 1, group: 2, side: -1 },
			{ portal: 1, group: 1, side: 1 },
		],
		fogs: [],
		walk: [floor(-10, 0), floor(0, 10), floor(10, 20), floor(20, 30)],
		camera: [new Float32Array(0), new Float32Array(0), new Float32Array(0), new Float32Array(0)],
	}
}

const PATH = 'World\\wmo\\Test\\Hall.wmo'
const TYPE = `wmo:${PATH}`
/** The building's box in the editor's local frame: WoW (x, y, z) is editor (x, z, -y). */
const asset: ModelAsset = {
	geometry: new THREE.BufferGeometry(),
	material: [],
	bbox: new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(30, 20, 10)),
	ready: true,
	effects: [],
	emitters: [],
	ribbons: [],
}

/** The object layer as `WmoRooms` reads it: objects placed at (x, yOff, z), unturned, and a hidden set. */
class FakeLayer implements RoomLayer {
	readonly group = new THREE.Group()
	readonly objects = new Map<number, WorldObject>()
	readonly hidden = new Set<number>()
	shapeVersion = 0
	moveSeq = 0
	movedSince(): readonly number[] {
		return []
	}
	isHidden(id: number): boolean {
		return this.hidden.has(id)
	}
	matrixOf(o: WorldObject, out: THREE.Matrix4) {
		return out.makeTranslation(o.x, o.yOff, o.z)
	}
	place(id: number, type: string, x: number, y: number, z: number) {
		this.objects.set(id, { id, type, x, yOff: y, z, rotY: 0, scale: 1 })
		this.shapeVersion++
	}
	hide(id: number, hidden: boolean) {
		if (hidden) this.hidden.add(id)
		else this.hidden.delete(id)
		this.shapeVersion++
	}
}

/** The building stands at world (100, 0, 50): room A's middle is at world x 95, B's at 105, D's at 125. */
const ID = 7
const noGround = () => null

/** A WmoRooms on the fake layer with the building placed and its room data loaded. */
async function setup(): Promise<{ rooms: WmoRooms; layer: FakeLayer }> {
	const nav = building()
	const rooms = new WmoRooms(
		(type) => (type === TYPE ? asset : { ...asset, ready: false }),
		async (path) => {
			assert.equal(path, PATH)
			return nav
		},
	)
	const layer = new FakeLayer()
	layer.place(ID, TYPE, 100, 0, 50)
	// The first look starts the room data's load and finds no room; the next one after it settles does.
	rooms.update(layer, new THREE.Vector3(95, 2, 50), noGround)
	assert.equal(rooms.current, null, 'no room while the room data loads')
	await new Promise((r) => setTimeout(r, 0))
	return { rooms, layer }
}

/** A camera at world `eye` looking at `at`. */
function camera(eye: THREE.Vector3, at: THREE.Vector3): THREE.PerspectiveCamera {
	const cam = new THREE.PerspectiveCamera(60, 1.5, 0.5, 2000)
	cam.position.copy(eye)
	cam.lookAt(at)
	cam.updateMatrixWorld()
	return cam
}

/** The gate's shared uniforms, read through a patched material as a WebGL program would get them. */
function gateUniforms(): { roomCount: { value: number }; roomOrigins: { value: THREE.Vector3[] }; roomMask: { value: THREE.DataTexture } } {
	const m = new THREE.MeshBasicMaterial()
	patchRoomGate(m)
	const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <fog_vertex>', fragmentShader: '#include <common>\n#include <fog_fragment>' }
	m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
	assert.match(shader.vertexShader, /roomBits/, 'the vertex shader reads the mask')
	return shader.uniforms as ReturnType<typeof gateUniforms>
}
const uniforms = gateUniforms()

/** Whether the mask draws group `g` of gate row `row`. */
function drawn(row: number, g: number): boolean {
	const data = uniforms.roomMask.value.image.data as Uint8Array
	return data[(row * ROOM_MAX_GROUPS + g) * 4] === 255
}

/**
 * One frame of Engine.updateRoomGate (without the fog fade): the camera's room flooded and gated,
 * RoomAdmit set from it, then the other buildings in view flooded from outside. Gives the admit
 * test, or null when the camera is in no room.
 */
function gateFrame(rooms: WmoRooms, layer: FakeLayer, cam: THREE.PerspectiveCamera): RoomAdmit | null {
	const viewProj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
	const frustum = new THREE.Frustum().setFromProjectionMatrix(viewProj)
	const r = rooms.current
	let admit: RoomAdmit | null = null
	beginRoomGates()
	if (r) {
		const pvs = new RoomFlood().run(r.nav, r.seeds, r.eye, viewProj.clone().multiply(r.matrix))
		addRoomGate(r.origin, pvs.visible, pvs.fog)
		admit = new RoomAdmit()
		admit.set(r.nav, r.matrix, pvs.visible, noGround)
	}
	for (const w of rooms.outside(layer, frustum, cam.position, ROOM_MAX_GATED - 1)) {
		const local = cam.position.clone().applyMatrix4(w.matrix.clone().invert())
		const pvs = new RoomFlood().run(w.nav, { inGroup: null, across: null }, toModel(local, [0, 0, 0]), viewProj.clone().multiply(w.matrix))
		addRoomGate(w.origin, pvs.visible, pvs.fog)
	}
	endRoomGates()
	return admit
}

/** The camera's room's group, or null outside (a call, so the assertions don't narrow `current` to null). */
const groupOf = (rooms: WmoRooms): number | null => rooms.current?.group ?? null

/** A spawn's bounding sphere standing at world (x, 1, 50). */
const spawnAt = (x: number) => new THREE.Sphere(new THREE.Vector3(x, 1, 50), 0.5)

test("inside a room's box the camera is in that room, and the gate draws it and its neighbours through the doorways in view", async () => {
	const { rooms, layer } = await setup()
	const eye = new THREE.Vector3(95, 2, 50)
	rooms.update(layer, eye, noGround)
	assert.equal(rooms.current?.id, ID)
	assert.equal(groupOf(rooms), 0, 'room A')
	assert.deepEqual(rooms.over, [])
	assert.deepEqual(
		rooms.current?.eye.map((v) => v + 0),
		[-5, 0, 2],
		"the eye in the WMO's model space",
	)

	// Looking down the hall, through both doorways.
	const admit = gateFrame(rooms, layer, camera(eye, new THREE.Vector3(115, 2, 50)))
	assert.ok(admit)
	assert.equal(uniforms.roomCount.value, 1, "one gate: the camera's building, not also flooded from outside")
	assert.ok(uniforms.roomOrigins.value[0].equals(new THREE.Vector3(100, 0, 50)), "the gate is keyed by the placement's origin")
	assert.deepEqual(
		[0, 1, 2, 3].map((g) => drawn(0, g)),
		[true, true, true, false],
		'A, B and C through the doorways; sealed D hidden',
	)
	assert.equal(drawn(0, 4), true, "a group past the building's is drawn")
	assert.equal(admit.admits(spawnAt(95)), true, "a spawn in the camera's room (#156)")
	assert.equal(admit.admits(spawnAt(105)), true, 'one in the room through the doorway')
	assert.equal(admit.admits(spawnAt(125)), false, 'one in the sealed room')
	assert.equal(admit.admits(spawnAt(60)), false, 'one outside the building')

	// Facing the back wall: no doorway in view, so only the camera's own room, with what stands in it.
	const back = gateFrame(rooms, layer, camera(eye, new THREE.Vector3(85, 2, 50)))
	assert.ok(back)
	assert.deepEqual(
		[0, 1, 2, 3].map((g) => drawn(0, g)),
		[true, false, false, false],
	)
	assert.equal(back.admits(spawnAt(95)), true, "the camera's room's spawn is drawn with no doorway in view (#156)")
	assert.equal(back.admits(spawnAt(105)), false, 'the room behind the camera is not')
})

test('over the building, above the room found or above its top, the camera is in no room (#300)', async () => {
	const { rooms, layer } = await setup()
	// Over room A, below the building's top (sealed D is 20 yd tall) but above A's box: A's floor is
	// below the eye, yet the eye is not in A.
	rooms.update(layer, new THREE.Vector3(95, 15, 50), noGround)
	assert.equal(rooms.current, null)
	assert.deepEqual(rooms.over, [ID])
	// Above the whole building.
	rooms.update(layer, new THREE.Vector3(95, 25, 50), noGround)
	assert.equal(rooms.current, null)
	assert.deepEqual(rooms.over, [ID])
	const eye = new THREE.Vector3(95, 25, 50)
	assert.equal(gateFrame(rooms, layer, camera(eye, new THREE.Vector3(110, 0, 50))), null)
	assert.equal(uniforms.roomCount.value, 0, 'a building the camera is over is drawn whole, not flooded from outside')
	// Below it, or beside it: neither in it nor over it.
	rooms.update(layer, new THREE.Vector3(95, -5, 50), noGround)
	assert.deepEqual(rooms.over, [])
	rooms.update(layer, new THREE.Vector3(60, 5, 50), noGround)
	assert.equal(rooms.current, null)
	assert.deepEqual(rooms.over, [])
	// Back down in A's box, the room again.
	rooms.update(layer, new THREE.Vector3(95, 9, 50), noGround)
	assert.equal(groupOf(rooms), 0)
	assert.deepEqual(rooms.over, [])
})

test("beside the building it is flooded from outside, unless it is the map's one building", async () => {
	const { rooms, layer } = await setup()
	const eye = new THREE.Vector3(60, 2, 50)
	rooms.update(layer, eye, noGround)
	assert.equal(rooms.current, null)
	const cam = camera(eye, new THREE.Vector3(100, 2, 50))
	assert.equal(gateFrame(rooms, layer, cam), null)
	assert.equal(uniforms.roomCount.value, 1, 'gated from outside')
	assert.deepEqual(
		[0, 1, 2, 3].map((g) => drawn(0, g)),
		[false, false, false, false],
		'no doorway leads outside, so no room shows',
	)
	const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
	assert.equal(rooms.outside(layer, frustum, eye, ROOM_MAX_GATED - 1).length, 1)
	assert.equal(rooms.outside(layer, frustum, eye, ROOM_MAX_GATED - 1, ID).length, 0, "a WMO-only map's building is drawn whole (#271)")
	// Looking away, it is out of view.
	gateFrame(rooms, layer, camera(eye, new THREE.Vector3(20, 2, 50)))
	assert.equal(uniforms.roomCount.value, 0)
})

test('inside a hidden building, or with the Objects layer hidden, the camera is in no room and nothing is gated (#142)', async () => {
	const { rooms, layer } = await setup()
	const eye = new THREE.Vector3(95, 2, 50)
	const cam = camera(eye, new THREE.Vector3(115, 2, 50))
	rooms.update(layer, eye, noGround)
	assert.equal(groupOf(rooms), 0)

	// The building hidden (H): the eye has not moved, but the WMO list changed.
	layer.hide(ID, true)
	rooms.update(layer, eye, noGround)
	assert.equal(rooms.current, null)
	assert.deepEqual(rooms.over, [])
	assert.equal(gateFrame(rooms, layer, cam), null)
	assert.equal(uniforms.roomCount.value, 0, 'no gate: the world is drawn as without the building')
	assert.equal(rooms.outside(layer, new THREE.Frustum(), eye, ROOM_MAX_GATED - 1).length, 0)
	layer.hide(ID, false)
	rooms.update(layer, eye, noGround)
	assert.equal(groupOf(rooms), 0, 'shown again, the room again')

	// View › Layers › Objects off.
	layer.group.visible = false
	rooms.update(layer, eye, noGround)
	assert.equal(rooms.current, null)
	assert.equal(rooms.wallDist, Infinity)
	assert.equal(gateFrame(rooms, layer, cam), null)
	assert.equal(uniforms.roomCount.value, 0)
	// Over the building with the layer off: not over it either.
	rooms.update(layer, new THREE.Vector3(95, 25, 50), noGround)
	assert.deepEqual(rooms.over, [])
	layer.group.visible = true
	rooms.update(layer, eye, noGround)
	assert.equal(groupOf(rooms), 0, 'the layer shown again, the probe looks again without the camera moving')
})

test('the gate takes ROOM_MAX_GATED placements a frame, and a frame without gates clears the count', () => {
	beginRoomGates()
	const visible = Uint8Array.from([1, 0])
	for (let i = 0; i < ROOM_MAX_GATED; i++) assert.equal(addRoomGate(new THREE.Vector3(i, 0, 0), visible, visible), true)
	assert.equal(addRoomGate(new THREE.Vector3(99, 0, 0), visible, visible), false, 'every row taken')
	endRoomGates()
	assert.equal(uniforms.roomCount.value, ROOM_MAX_GATED)
	assert.equal(drawn(ROOM_MAX_GATED - 1, 0), true)
	assert.equal(drawn(ROOM_MAX_GATED - 1, 1), false)
	beginRoomGates()
	endRoomGates()
	assert.equal(uniforms.roomCount.value, 0)
})
