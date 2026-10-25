// Run with: bun test tests/wmoFlood.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CALLBACK_PASS, EXTERIOR_LIT, RoomFlood } from '../src/lib/world/wmoFlood.ts'
import { FOG_RAMP_PER_SEC, RoomFogFade, selectWmoFog } from '../src/lib/world/wmoFog.ts'
import { EXTERIOR, type WmoFog, type WmoNav, type WmoNavGroup } from '../src/lib/world/wmoRoom.ts'

function group(flags: number, min: number[], max: number[], refStart: number, refCount: number): WmoNavGroup {
	return { flags, min: min as [number, number, number], max: max as [number, number, number], refStart, refCount, fogs: [0, 0, 0, 0], name: '' }
}

/**
 * Room A (x < 0, a true interior) opens through a doorway in the x = 0 plane onto B (x > 0), and B
 * through a second doorway at x = 10 onto C. The doorways' normals point +x.
 */
function hall(bFlags: number, cFlags = 0): WmoNav {
	const door = (x: number) => [x, -2, 0, x, 2, 0, x, 2, 4, x, -2, 4]
	return {
		groups: [group(0, [-10, -10, 0], [0, 10, 10], 0, 1), group(bFlags, [0, -10, 0], [10, 10, 10], 1, 2), group(cFlags, [10, -10, 0], [20, 10, 10], 3, 1)],
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
		walk: [],
		camera: [],
	}
}

/** projection · view for a camera at editor point `eye` looking at `at`; the placement is the identity. */
function clip(eye: number[], at: number[]): THREE.Matrix4 {
	const cam = new THREE.PerspectiveCamera(60, 1.5, 0.5, 2000)
	cam.position.set(eye[0], eye[1], eye[2])
	cam.lookAt(at[0], at[1], at[2])
	cam.updateMatrixWorld()
	return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
}

// The eye at WoW (-5, 0, 2) is editor (-5, 2, 0).
const EYE: [number, number, number] = [-5, 0, 2]
const seeds = { inGroup: 0, across: null }

test('a doorway in view draws the rooms behind it, and the room fog stays on the interior chain', () => {
	const pvs = new RoomFlood().run(hall(0), seeds, EYE, clip([-5, 2, 0], [5, 2, 0]))
	assert.deepEqual([...pvs.visible], [1, 1, 1])
	assert.deepEqual([...pvs.fog], [1, 1, 1])
	const lit = new RoomFlood().run(hall(EXTERIOR_LIT), seeds, EYE, clip([-5, 2, 0], [5, 2, 0]))
	assert.deepEqual([...lit.visible], [1, 1, 1])
	assert.deepEqual([...lit.fog], [1, 0, 0], 'an exterior-lit room breaks the chain, for itself and beyond')
})

test('a doorway behind the camera hides the rooms behind it', () => {
	const pvs = new RoomFlood().run(hall(0), seeds, EYE, clip([-5, 2, 0], [-15, 2, 0]))
	assert.deepEqual([...pvs.visible], [1, 0, 0])
})

test('a doorway onto an exterior group opens a window, and the shell floods from it', () => {
	// B is the outside: reached through A's doorway; C (exterior too) is behind B's far doorway.
	const pvs = new RoomFlood().run(hall(EXTERIOR, EXTERIOR), seeds, EYE, clip([-5, 2, 0], [5, 2, 0]))
	assert.deepEqual([...pvs.visible], [1, 1, 1])
	assert.deepEqual([...pvs.fog], [1, 0, 0])
})

test('a far doorway seen through a narrow one is cut by the carried rect', () => {
	// Looking past the first doorway's edge: the second doorway (at x = 10) projects outside the first one's rect.
	const nav = hall(0)
	nav.portalVerts.splice(12, 12, 10, 6, 0, 10, 9, 0, 10, 9, 4, 10, 6, 4)
	const pvs = new RoomFlood().run(nav, seeds, EYE, clip([-5, 2, 0], [5, 2, 0]))
	assert.deepEqual([...pvs.visible], [1, 1, 0])
})

test('a callback group draws in view whatever the flood reached', () => {
	const nav = hall(0)
	nav.groups[2].flags = CALLBACK_PASS
	const away = new RoomFlood().run(nav, seeds, EYE, clip([-5, 2, 0], [-15, 2, 0]))
	assert.deepEqual([...away.visible], [1, 0, 0], 'out of view')
	nav.portalVerts.splice(12, 12, 10, 6, 0, 10, 9, 0, 10, 9, 4, 10, 6, 4)
	const seen = new RoomFlood().run(nav, seeds, EYE, clip([-5, 2, 0], [5, 2, 0]))
	assert.deepEqual([...seen.visible], [1, 1, 1])
})

// The fog cases are Benilla's (wmo_portal/fog.rs, lighting/resolve.rs).
function rec(flags: number, pos: number[], inner: number, outer: number, end: number, color: number): WmoFog {
	return { flags, pos: pos as [number, number, number], inner, outer, end, start: 0.25, color }
}

test('a single fog record keeps the scene fog', () => {
	assert.equal(selectWmoFog([rec(0, [0, 0, 0], 0, 0, 444.4, 0xffffffff)], [0, 0, 0, 0], [0, 0, 0]), null)
})

test('out of radius and flagged records leave record 0', () => {
	const fogs = [rec(0, [0, 0, 0], 0, 3.36, 194.4, 0xfffad890), rec(1, [12.3, -0.6, 2.8], 0, 3.36, 83.3, 0xfffdcf9e)]
	const t = selectWmoFog(fogs, [1, 0, 0, 0], [12.3, -0.6, 2.8])!
	assert.ok(Math.abs(t.end - 194.4) < 1e-3)
	assert.ok(Math.abs(t.color[0] - 250 / 255) < 1e-4)
	assert.ok(Math.abs(t.color[2] - 144 / 255) < 1e-4)
})

test('a record blends in by its radius falloff', () => {
	const fogs = [rec(0, [0, 0, 0], 0, 0, 200, 0xff000000), rec(0, [10, 0, 0], 5, 25, 80, 0xffffffff)]
	assert.ok(Math.abs(selectWmoFog(fogs, [1, 0, 0, 0], [10, 0, 0])!.end - 80) < 1e-4)
	assert.ok(Math.abs(selectWmoFog(fogs, [1, 0, 0, 0], [25, 0, 0])!.end - 140) < 1e-3)
	assert.ok(Math.abs(selectWmoFog(fogs, [1, 0, 0, 0], [40, 0, 0])!.end - 200) < 1e-4)
})

test('the room fog fades in and out over four seconds, its end clamped to the far clip', () => {
	const fade = new RoomFogFade()
	const target = { color: [1, 1, 1] as [number, number, number], end: 5000, start: 0.25 }
	assert.ok(fade.update(target, [0, 0, 0], 100, 500, 1000, 2))
	assert.equal(fade.t, 2 * FOG_RAMP_PER_SEC)
	assert.ok(Math.abs(fade.far - (500 + (1000 - 500) * 0.5)) < 1e-6, 'end = min(end, far clip), halfway')
	assert.ok(Math.abs(fade.near - (100 + (250 - 100) * 0.5)) < 1e-6, 'start = end · share')
	fade.update(target, [0, 0, 0], 100, 500, 1000, 10)
	assert.equal(fade.t, 1)
	assert.ok(fade.update(null, [0, 0, 0], 100, 500, 1000, 2), 'fading out from the last room fog')
	assert.equal(fade.update(null, [0, 0, 0], 100, 500, 1000, 2), false)
	assert.equal(fade.far, 500)
})

test('from outside, an interior shows only through a doorway in view, and takes no room fog', () => {
	// B is the building's exterior shell (0x8); A, an interior, opens onto it through the x = 0 doorway.
	const nav = hall(EXTERIOR, EXTERIOR)
	const outside = { inGroup: null, across: null }
	// The eye at WoW (5, 0, 2), editor (5, 2, 0), on B's side of the doorway.
	const eye: [number, number, number] = [5, 0, 2]
	const toward = new RoomFlood().run(nav, outside, eye, clip([5, 2, 0], [-5, 2, 0]))
	assert.equal(toward.visible[0], 1, 'the interior through the doorway')
	assert.deepEqual([...toward.fog], [0, 0, 0])
	const away = new RoomFlood().run(nav, outside, eye, clip([5, 2, 0], [15, 2, 0]))
	assert.equal(away.visible[0], 0, 'the doorway behind the camera')
	assert.equal(away.visible[1], 1, 'the shell is always a root')
})

test("a doorway onto a street lit as outdoors is a sky window for the weather, though not the open world's window (#244)", () => {
	const f = new RoomFlood()
	// Stormwind's shops open onto streets flagged 0x40, not 0x8: no exterior window, but a sky window.
	f.run(hall(EXTERIOR_LIT), seeds, EYE, clip([-5, 2, 0], [5, 2, 0]))
	assert.equal(f.exteriorWindows.length, 0)
	assert.equal(f.skyWindows.length, 4)
	const [x0, y0, x1, y1] = f.skyWindows
	assert.ok(x0 > -1 && x1 < 1 && y0 > -1 && y1 < 1 && x1 > x0 && y1 > y0, 'the doorway, not the whole screen')
	// A true interior beyond is no window; a doorway behind the camera is none either.
	f.run(hall(0), seeds, EYE, clip([-5, 2, 0], [5, 2, 0]))
	assert.equal(f.skyWindows.length, 0)
	f.run(hall(EXTERIOR_LIT), seeds, EYE, clip([-5, 2, 0], [-15, 2, 0]))
	assert.equal(f.skyWindows.length, 0)
	// An exterior doorway is both.
	f.run(hall(EXTERIOR), seeds, EYE, clip([-5, 2, 0], [5, 2, 0]))
	assert.equal(f.exteriorWindows.length, 4)
	assert.equal(f.skyWindows.length, 4)
})
