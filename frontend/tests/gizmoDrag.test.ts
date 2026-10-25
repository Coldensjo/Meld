// Run with: bun test tests/gizmoDrag.test.ts
// The drag of the selection's handles, out of Engine (#555): the snap and angle maths, and each
// handle's drag on a small flat map through a fake host, the way the Engine drives it (start on the
// press, update per move, end on release): one model's ring, height arrow, scale knob and move arrow,
// a group's ring, arrow and knob, and a selected spawn's ring and arrow, each one History step that
// Undo and Redo restore (#438; the probe gizmo-undo runs the same drags in the live app).
import './runes.ts'
import { afterEach, expect, test } from 'bun:test'
import * as THREE from 'three'
import { vmangos } from '../wailsjs/go/models'
import type { WorldObject } from '../src/lib/world/ObjectLayer.ts'

const { editor } = await import('../src/lib/state/editor.svelte.ts')
const { History } = await import('../src/lib/state/historyCore.ts')
const { Terrain } = await import('../src/lib/terrain/Terrain.ts')
const { ObjectLayer } = await import('../src/lib/world/ObjectLayer.ts')
const { SpawnLayer, spawnKey } = await import('../src/lib/world/SpawnLayer.ts')
const { selectObjects } = await import('../src/lib/state/selection.ts')
const { meanPivot } = await import('../src/lib/world/pivot.ts')
const { clampScale } = await import('../src/lib/world/placement.ts')
const { TransformGizmo } = await import('../src/lib/engine/TransformGizmo.ts')
const { GizmoDrag, alongAxis, groupSpot, ringAngle, snapAngle, snapHalfYard } = await import('../src/lib/engine/GizmoDrag.ts')

const CUBE = 'helper:cube:4'

// Every test file runs in one process: give the editor back as it was.
const was = { tool: editor.tool, rotatePivot: editor.rotatePivot }
afterEach(() => {
	Object.assign(editor, was)
	editor.selectedIds = []
	editor.selected = null
	editor.selectedSpawn = null
})
const DEG = Math.PI / 180

test('the snaps: 15 degrees, half a yard, and a scale rounded to a hundredth within 0.05..20', () => {
	expect(snapAngle(22 * DEG)).toBeCloseTo(15 * DEG)
	expect(snapAngle(23 * DEG)).toBeCloseTo(30 * DEG)
	expect(snapAngle(-8 * DEG)).toBeCloseTo(-15 * DEG)
	expect(snapHalfYard(1.24)).toBe(1)
	expect(snapHalfYard(1.26)).toBe(1.5)
	expect(snapHalfYard(-0.8)).toBe(-1)
	expect(clampScale(1.234)).toBe(1.23)
	expect(clampScale(0.01)).toBe(0.05)
	expect(clampScale(55)).toBe(20)
})

test('the ring angle grows from +x towards -z, and a move arrow reads the cursor along its axis', () => {
	const o = { x: 10, z: 10 }
	expect(ringAngle({ x: 12, z: 10 }, o)).toBeCloseTo(0)
	expect(ringAngle({ x: 10, z: 8 }, o)).toBeCloseTo(Math.PI / 2)
	expect(Math.abs(ringAngle({ x: 8, z: 10 }, o))).toBeCloseTo(Math.PI)
	expect(alongAxis({ x: 13, z: 11 }, { x: 10, z: 10 }, { x: 1, z: 0 })).toBe(3)
	expect(alongAxis({ x: 13, z: 11 }, { x: 10, z: 10 }, { x: 0, z: 1 })).toBe(1)
})

test('a group member turns and spreads about the pivot with Rotate around pivot point, else stays put', () => {
	const out = { x: 0, z: 0 }
	const pivot = { x: 0, z: 0 }
	groupSpot({ x: 2, z: 0 }, pivot, 0, 0, Math.PI / 2, 1, true, out)
	expect(out.x).toBeCloseTo(0)
	expect(Math.abs(out.z)).toBeCloseTo(2)
	expect(groupSpot({ x: 2, z: 0 }, pivot, 0, 0, Math.PI / 2, 1, false, out)).toEqual({ x: 2, z: 0 })
	expect(groupSpot({ x: 2, z: 1 }, pivot, 0, 0, 0, 2, true, out)).toEqual({ x: 4, z: 2 })
	expect(groupSpot({ x: 2, z: 1 }, pivot, 1, -1, 0, 1, true, out)).toEqual({ x: 3, z: 0 })
})

/** A flat 128-yard map with three cubes in the air, a camera looking at them and the drag on a fake host. */
function world() {
	const terrain = new Terrain(64, 2)
	const objects = new ObjectLayer(terrain)
	const cubes = [
		[56, 60],
		[64, 64],
		[72, 60],
	].map(([x, z]) => objects.add({ type: CUBE, x, z, yOff: 6, rotY: 0, scale: 1 }))
	const spawnLayer = new SpawnLayer()
	const history = new History({ dirty() {}, sync() {} })
	const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)
	camera.position.set(64, 40, 100)
	camera.lookAt(64, 6, 62)
	camera.updateMatrixWorld()
	const gizmo = new TransformGizmo()
	const raycaster = new THREE.Raycaster()
	const ndc = new THREE.Vector2()
	const selectedObject = () => (editor.selected ? objects.objects.get(editor.selected.id) : undefined)
	const host = {
		gizmo,
		raycaster,
		camera,
		ndc,
		ortho: new THREE.OrthographicCamera(),
		topDown: false,
		objects,
		spawnLayer,
		terrain,
		history,
		setCursor() {},
		canNudge: () => editor.selectedIds.length > 0,
		selectedObject,
		selectionPivot: (ts: readonly WorldObject[]) => meanPivot(ts.map((o) => objects.worldPosition(o, new THREE.Vector3()))),
	}
	const drag = new GizmoDrag(host)
	/** Points the pointer at world point p. */
	const aim = (p: THREE.Vector3) => {
		const q = p.clone().project(camera)
		ndc.set(q.x, q.y)
	}
	/** Puts the handles where the Engine would for the selection: round the model, the group's pivot or the spawn. */
	const place = () => {
		const sel = editor.selectedIds.map((id) => objects.objects.get(id)!)
		if (sel.length > 1) {
			const p = host.selectionPivot(sel)
			gizmo.update(new THREE.Vector3(p.x, 6, p.z), 10, 10, camera.position, true, true, 0)
		} else if (sel.length === 1) {
			const at = objects.worldPosition(sel[0], new THREE.Vector3())
			gizmo.update(at, 3, at.y + 2, camera.position, true, true, 0)
		} else if (editor.selectedSpawn) {
			const s = editor.selectedSpawn
			gizmo.update(new THREE.Vector3(s.x, s.y, s.z), 2, s.y + 2, camera.position, false)
		}
	}
	return { objects, cubes, spawnLayer, history, gizmo, raycaster, camera, ndc, drag, aim, place }
}

type World = ReturnType<typeof world>

/** A point on the ring at `a` radians round its centre (ringAngle's convention). */
function onRing(w: World, a: number): THREE.Vector3 {
	const r = w.gizmo['ring']
	return r.position.clone().add(new THREE.Vector3(Math.cos(a) * r.scale.x, 0, -Math.sin(a) * r.scale.x))
}

/** Where `handle` is grabbed and where the drag takes the pointer. */
function grip(w: World, handle: string): [THREE.Vector3, THREE.Vector3] {
	const g = w.gizmo
	if (handle === 'ring') {
		for (let a = -Math.PI / 2; a < Math.PI * 1.5; a += Math.PI / 24) {
			w.aim(onRing(w, a))
			w.raycaster.setFromCamera(w.ndc, w.camera)
			if (g.pick(w.raycaster) === 'ring') return [onRing(w, a), onRing(w, a + 0.6)]
		}
		throw new Error('no ring point picks the ring')
	}
	if (handle === 'arrow') return [g['arrow'].position.clone(), g['arrow'].position.clone().add(new THREE.Vector3(0, 3, 0))]
	if (handle === 'scale') {
		const from = g['knob'].position.clone()
		return [from, from.clone().add(from.clone().sub(g['ring'].position).setY(0).normalize().multiplyScalar(3))]
	}
	const axis = g.axisDir('moveX', new THREE.Vector3())
	const from = g['axes'].position.clone().add(axis.clone().multiplyScalar(g['ring'].scale.x + g['arrow'].scale.x * 0.5))
	return [from, from.clone().add(axis.multiplyScalar(4))]
}

/** Drags `handle` as the Engine does and checks it left one step that Undo and Redo restore; returns the state after. */
function dragHandle(w: World, handle: string, state: () => string): string {
	w.place()
	const [from, to] = grip(w, handle)
	const before = state()
	const steps = w.history.position
	w.aim(from)
	expect(w.drag.start()).toBe(true)
	expect(w.drag.active).toBe(true)
	w.aim(to)
	w.drag.update(false)
	w.drag.end()
	expect(w.drag.active).toBe(false)
	const after = state()
	expect(after).not.toBe(before)
	expect(w.history.position - steps).toBe(1)
	w.history.undo()
	expect(state()).toBe(before)
	w.history.redo()
	expect(state()).toBe(after)
	return after
}

function cubeState(w: World) {
	return () => JSON.stringify(w.cubes.map((c) => w.objects.objects.get(c.id)!).map((o) => [o.x, o.yOff, o.z, o.rotY, o.scale]))
}

test('one model: the ring turns it, the arrow lifts it, the knob scales it and a move arrow slides it, each one undo step', () => {
	const w = world()
	editor.tool = 'select'
	selectObjects(w.objects, [w.cubes[1].id])
	const o = () => w.objects.objects.get(w.cubes[1].id)!
	dragHandle(w, 'ring', cubeState(w))
	expect(o().rotY).not.toBe(0)
	dragHandle(w, 'arrow', cubeState(w))
	expect(o().yOff).toBeGreaterThan(6)
	dragHandle(w, 'scale', cubeState(w))
	expect(o().scale).toBeGreaterThan(1)
	const x = o().x
	dragHandle(w, 'moveX', cubeState(w))
	expect(o().x).toBeGreaterThan(x)
	// The others stayed where they were.
	expect(w.objects.objects.get(w.cubes[0].id)!.rotY).toBe(0)
})

test('a group: the ring turns the three about their pivot, the arrow lifts them and the knob spreads them, each one undo step', () => {
	const w = world()
	editor.tool = 'select'
	editor.rotatePivot = true
	selectObjects(
		w.objects,
		w.cubes.map((c) => c.id),
	)
	const all = () => w.cubes.map((c) => w.objects.objects.get(c.id)!)
	dragHandle(w, 'ring', cubeState(w))
	expect(all().every((o) => o.rotY !== 0)).toBe(true)
	const ys = all().map((o) => o.yOff)
	dragHandle(w, 'arrow', cubeState(w))
	all().forEach((o, i) => expect(o.yOff).toBeGreaterThan(ys[i]))
	dragHandle(w, 'scale', cubeState(w))
	expect(all().every((o) => o.scale > 1)).toBe(true)
})

test('a selected spawn: the ring turns its facing and the arrow its height, each one undo step', () => {
	const w = world()
	editor.tool = 'select'
	selectObjects(w.objects, [])
	const s = vmangos.WorldSpawn.createFrom({ kind: 'monster', guid: 1, entry: 100, name: 'Kobold', x: 64, y: 4, z: 62, orientation: 0, model: '', waypoints: [], leader: 0, pool: 0, motherPool: 0 })
	w.spawnLayer.set([s])
	editor.selectedSpawn = w.spawnLayer.get(spawnKey(s))!
	const state = () => {
		const now = w.spawnLayer.get(spawnKey(s))!
		return JSON.stringify([now.orientation, now.y])
	}
	dragHandle(w, 'ring', state)
	expect(w.spawnLayer.get(spawnKey(s))!.orientation).not.toBe(0)
	dragHandle(w, 'arrow', state)
	expect(w.spawnLayer.get(spawnKey(s))!.y).toBeGreaterThan(4)
	// A spawn has no knob or move arrows: a press on the empty air beside it starts nothing.
	w.place()
	w.aim(new THREE.Vector3(90, 30, 62))
	expect(w.drag.start()).toBe(false)
})
