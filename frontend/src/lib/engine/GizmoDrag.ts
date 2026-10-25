import * as THREE from 'three'
import { editor, queueViewportHint } from '../state/editor.svelte'
import type { Command } from '../state/history'
import { markMoved, movableSelection } from '../state/selection'
import type { Terrain } from '../terrain/Terrain'
import { groupTransformCommand, transformCommand } from '../tools/ObjectTools'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import { clampScale } from '../world/placement'
import { turnAbout, type Point2 } from '../world/pivot'
import { spawnKey, spawnOrientation, spawnRotation, type SpawnLayer } from '../world/SpawnLayer'
import { applySpawn, syncSpawnUi, type SpawnFields } from '../world/spawnEdits'
import type { vmangos } from '../../../wailsjs/go/models'
import type { GizmoHandle, TransformGizmo } from './TransformGizmo'

/** The step a ring drag snaps to with Shift held: 15 degrees. */
const SNAP_ANGLE = Math.PI / 12

/**
 * Where `p` lies round `o` on the ring, in radians: 0 along +x, growing towards -z, the convention
 * the ring's sweep arc draws with (`TransformGizmo.setSweep`).
 */
export function ringAngle(p: Point2, o: Point2): number {
	return Math.atan2(-(p.z - o.z), p.x - o.x)
}

/** An angle snapped to the nearest 15 degrees (Shift on a ring drag). */
export function snapAngle(a: number): number {
	return Math.round(a / SNAP_ANGLE) * SNAP_ANGLE
}

/** A distance snapped to the nearest half yard (Shift on a move or height drag). */
export function snapHalfYard(v: number): number {
	return Math.round(v * 2) / 2
}

/** How far `p` lies from `from` along the ground direction `axis` (a move arrow's drag). */
export function alongAxis(p: Point2, from: Point2, axis: Point2): number {
	return (p.x - from.x) * axis.x + (p.z - from.z) * axis.z
}

/**
 * Where one model of a group drag lands on the ground, from where it stood (`s`): moved by (mx, mz),
 * and, with Rotate around pivot point (`about`), turned by `turn` about the pivot and its spread from
 * the pivot scaled by `factor`; without it each model turns and scales in place. Writes into `out`.
 */
export function groupSpot(s: Point2, pivot: Point2, mx: number, mz: number, turn: number, factor: number, about: boolean, out: Point2): Point2 {
	let x = s.x + mx
	let z = s.z + mz
	if (about && turn !== 0) {
		turnAbout(s.x, s.z, pivot.x, pivot.z, turn, out)
		x = out.x
		z = out.z
	}
	if (about && factor !== 1) {
		x = pivot.x + (x - pivot.x) * factor
		z = pivot.z + (z - pivot.z) * factor
	}
	out.x = x
	out.z = z
	return out
}

/** The viewport cursor while a handle is held. */
function heldCursor(handle: GizmoHandle): string {
	return handle === 'ring' ? 'grabbing' : handle === 'scale' ? 'ew-resize' : handle === 'arrow' ? 'ns-resize' : 'move'
}

/** What GizmoDrag needs of the Engine. */
export interface GizmoHost {
	/** The handles drawn round the selection. */
	readonly gizmo: TransformGizmo
	readonly raycaster: THREE.Raycaster
	/** The camera the view is drawn and picked with. */
	readonly camera: THREE.Camera
	/** The pointer in normalized device coordinates. */
	readonly ndc: THREE.Vector2
	/** The top-down view's camera, whose zoom turns the pointer's height on screen into yards. */
	readonly ortho: THREE.OrthographicCamera
	/** Whether the view is the top-down one. */
	readonly topDown: boolean
	/** The active tab's models, spawns, ground and History. */
	readonly objects: ObjectLayer
	readonly spawnLayer: SpawnLayer
	readonly terrain: Terrain
	readonly history: { push(cmd: Command): void }
	/** Sets the viewport's cursor ('' for the default). */
	setCursor(cursor: string): void
	/** Whether keyboard and gizmo editing of the selected models applies (Engine.canNudge). */
	canNudge(): boolean
	/** The primary selected model. */
	selectedObject(): WorldObject | undefined
	/** The pivot a group turns about (Engine.selectionPivot). */
	selectionPivot(targets: readonly WorldObject[]): Point2
}

/** What every drag keeps from the press. */
interface DragBase {
	handle: GizmoHandle
	/** What the ring turns about and the knob scales from: the model's, group pivot's or spawn's ground spot. */
	centre: Point2
	/** The cursor's angle round the centre at the press (ring). */
	startAngle: number
	/** The cursor's height on the upright plane at the press (arrow). */
	startY: number
	/** The cursor's distance from the centre at the press, in the ring's plane (knob). */
	startDist: number
	/** A move arrow's drag: the ground direction it moves along and where the cursor met the plane. */
	move?: { axis: THREE.Vector3; from: THREE.Vector3 }
}

/** One model: its fields and world position at the press. */
interface OneDrag extends DragBase {
	kind: 'one'
	before: WorldObject
	pos: THREE.Vector3
}

/** A multi-selection dragged as one: its models, their fields before and each one's world placement at the press. */
interface GroupDrag extends DragBase {
	kind: 'group'
	targets: WorldObject[]
	before: WorldObject[]
	start: Array<{ x: number; z: number; y: number; rot: number; scale: number }>
}

/** A selected creature or region object: its key and its facing and height before the drag. */
interface SpawnDrag extends DragBase {
	kind: 'spawn'
	key: string
	orientation: number
	y: number
}

type Drag = OneDrag | GroupDrag | SpawnDrag

const UP = new THREE.Vector3(0, 1, 0)

/**
 * The drag of the selection's handles (#555, out of Engine): one model's ring, height arrow, scale
 * knob and move arrows, a multi-selection's worked as one about its pivot, and a selected spawn's
 * ring and arrow. Each drag is one undo step, pushed on release. Engine forwards the pointer to
 * `start`, `update` and `end`.
 */
export class GizmoDrag {
	private drag: Drag | null = null
	/** The plane the cursor is read on, and where it meets it. */
	private plane = new THREE.Plane()
	private point = new THREE.Vector3()
	private normal = new THREE.Vector3()
	private tmpV = new THREE.Vector3()
	private spot: Point2 = { x: 0, z: 0 }

	constructor(private host: GizmoHost) {}

	/** Whether a handle is held. */
	get active(): boolean {
		return this.drag !== null
	}

	/** The selected creature or region object the gizmo works on, when no model is selected (Select tool). */
	selectedSpawn(): vmangos.WorldSpawn | undefined {
		if (editor.tool !== 'select' || editor.selectedIds.length || !editor.selectedSpawn) return undefined
		return this.host.spawnLayer.get(spawnKey(editor.selectedSpawn)) ?? undefined
	}

	/** Begins dragging the handle under the pointer. Returns true if one was hit. */
	start(): boolean {
		const h = this.host
		if (h.canNudge() && editor.selectedIds.length > 1) return this.startGroup()
		const o = h.canNudge() && editor.selectedIds.length === 1 ? h.selectedObject() : undefined
		if (!o) return this.startSpawn()
		const handle = this.pickHandle()
		if (!handle) return false
		const pos = h.objects.worldPosition(o, new THREE.Vector3())
		const base = this.grab(handle, pos)
		if (!base) return false
		this.drag = { ...base, kind: 'one', before: { ...o }, pos }
		h.setCursor(heldCursor(handle))
		return true
	}

	/** Moves the held handle to the pointer; `snap` (Shift) snaps the step. */
	update(snap: boolean) {
		const d = this.drag
		if (!d || !this.cursorOnPlane(d.handle)) return
		if (d.kind === 'spawn') this.updateSpawn(d, snap)
		else if (d.kind === 'group') this.updateGroup(d, snap)
		else this.updateOne(d, snap)
	}

	/** Lets go of the handle and pushes the drag's one undo step, if it changed anything. */
	end() {
		const d = this.drag
		const h = this.host
		this.drag = null
		h.gizmo.setSweep(0, 0)
		h.setCursor('')
		if (!d) return
		if (d.kind === 'spawn') {
			const layer = h.spawnLayer
			const key = d.key
			const s = layer.get(key)
			syncSpawnUi(layer)
			if (!s || (s.orientation === d.orientation && s.y === d.y)) return
			const before: SpawnFields = d.handle === 'ring' ? { orientation: d.orientation } : { y: d.y }
			const after: SpawnFields = d.handle === 'ring' ? { orientation: s.orientation } : { y: s.y }
			h.history.push({ label: `${d.handle === 'ring' ? 'Turn' : 'Raise'} ${s.name}`, undo: () => applySpawn(layer, key, before), redo: () => applySpawn(layer, key, after) })
			return
		}
		if (d.kind === 'group') {
			const same = (a: WorldObject, b: WorldObject) => a.x === b.x && a.z === b.z && a.yOff === b.yOff && a.rotY === b.rotY && a.scale === b.scale
			if (d.targets.every((o, i) => same(o, d.before[i]))) return
			const verb = d.handle === 'ring' ? 'Turn' : d.handle === 'scale' ? 'Scale' : d.move ? 'Move' : 'Raise'
			h.history.push(groupTransformCommand(h.objects, d.before, d.targets, `${verb} ${d.targets.length} objects`))
			return
		}
		const o = h.selectedObject()
		if (!o) return
		const b = d.before
		if (o.rotY !== b.rotY || o.yOff !== b.yOff || o.x !== b.x || o.z !== b.z || o.scale !== b.scale) h.history.push(transformCommand(h.objects, b, o))
	}

	/** The handle under the pointer, while the handles show. */
	private pickHandle(): GizmoHandle | null {
		const h = this.host
		if (!h.gizmo.visible) return null
		h.raycaster.setFromCamera(h.ndc, h.camera)
		return h.gizmo.pick(h.raycaster)
	}

	/**
	 * Sets the drag plane for `handle` about `centre` and reads the cursor on it: the ring's flat plane
	 * for the ring, the knob and the move arrows, an upright one through the centre facing the camera
	 * for the height arrow. Returns what the drag keeps from the press, or null when the cursor misses
	 * the plane.
	 */
	private grab(handle: GizmoHandle, centre: Point2): DragBase | null {
		const h = this.host
		const base: DragBase = { handle, centre: { x: centre.x, z: centre.z }, startAngle: 0, startY: 0, startDist: 1 }
		if (handle === 'arrow') {
			this.normal
				.copy(h.camera.position)
				.sub(this.tmpV.set(centre.x, 0, centre.z))
				.setY(0)
				.normalize()
			this.plane.setFromNormalAndCoplanarPoint(this.normal, this.tmpV)
			if (!this.cursorOnPlane('arrow')) return null
			base.startY = this.point.y
			return base
		}
		this.plane.setFromNormalAndCoplanarPoint(UP, this.tmpV.set(centre.x, h.gizmo.ringY, centre.z))
		if (!h.raycaster.ray.intersectPlane(this.plane, this.point)) return null
		if (handle === 'moveX' || handle === 'moveZ') {
			base.move = { axis: h.gizmo.axisDir(handle, new THREE.Vector3()), from: this.point.clone() }
		} else {
			base.startAngle = ringAngle(this.point, centre)
			base.startDist = Math.max(0.05, Math.hypot(this.point.x - centre.x, this.point.z - centre.z))
		}
		return base
	}

	/**
	 * Puts where the drag is into `point`: the cursor on the drag plane, or, for the height arrow in
	 * the top-down view (whose straight-down ray never meets the arrow's upright plane), a height from
	 * the cursor's height on screen, a yard per yard of the view. Returns false when the cursor misses
	 * the plane.
	 */
	private cursorOnPlane(handle: GizmoHandle): boolean {
		const h = this.host
		if (handle === 'arrow' && h.topDown) {
			const o = h.ortho
			this.point.y = (h.ndc.y * (o.top - o.bottom)) / (2 * o.zoom)
			return true
		}
		h.raycaster.setFromCamera(h.ndc, h.camera)
		return !!h.raycaster.ray.intersectPlane(this.plane, this.point)
	}

	private updateOne(d: OneDrag, snap: boolean) {
		const h = this.host
		const o = h.selectedObject()
		if (!o) return
		const p = this.point
		if (d.move) {
			// Along the arrow: a model on the ground stays on it where it lands; an attached one keeps its height.
			let along = alongAxis(p, d.move.from, d.move.axis)
			if (snap) along = snapHalfYard(along)
			const w = h.objects.worldPlacement(o)
			w.pos.x = THREE.MathUtils.clamp(d.pos.x + d.move.axis.x * along, 0, h.terrain.worldSize)
			w.pos.z = THREE.MathUtils.clamp(d.pos.z + d.move.axis.z * along, 0, h.terrain.worldSize)
			w.pos.y = o.parent === undefined ? h.terrain.heightAt(w.pos.x, w.pos.z) + d.before.yOff : d.pos.y
			h.objects.place(o, o.parent ?? null, w)
			queueViewportHint(`Move ${along >= 0 ? '+' : ''}${along.toFixed(2)} along ${d.handle === 'moveX' ? 'x' : 'z'}`)
		} else if (d.handle === 'ring') {
			let rot = d.before.rotY + (ringAngle(p, d.centre) - d.startAngle)
			if (snap) rot = snapAngle(rot)
			o.rotY = rot
			h.gizmo.setSweep(d.startAngle, rot - d.before.rotY)
			const deg = Math.round(THREE.MathUtils.euclideanModulo(THREE.MathUtils.radToDeg(rot), 360)) % 360
			queueViewportHint(`Rotation ${deg}°`)
		} else if (d.handle === 'scale') {
			// The knob rides the ring, whose radius grows with the scale, so it follows the cursor.
			let scale = d.before.scale * (Math.hypot(p.x - d.centre.x, p.z - d.centre.z) / d.startDist)
			if (snap) scale = Math.round(scale * 10) / 10
			o.scale = clampScale(scale)
			queueViewportHint(`Scale ×${o.scale.toFixed(2)}`)
		} else {
			let dy = p.y - d.startY
			if (snap) dy = snapHalfYard(dy)
			const w = h.objects.worldPlacement(o)
			w.pos.y = d.pos.y + dy
			h.objects.place(o, o.parent ?? null, w)
			queueViewportHint(`Height ${o.yOff >= 0 ? '+' : ''}${o.yOff.toFixed(2)}`)
		}
		h.objects.touch(o.id)
		editor.selected = { ...o }
	}

	/**
	 * A multi-selection's handles work the group as one about its pivot: the ring turns it (each model
	 * about the pivot with Rotate around pivot point, else in place), the knob scales it (the models and
	 * their spread from the pivot), the arrow lifts it and a move arrow slides it.
	 */
	private startGroup(): boolean {
		const h = this.host
		const targets = movableSelection(h.objects)
		if (targets.length < 2) return false
		const handle = this.pickHandle()
		if (!handle) return false
		const base = this.grab(handle, h.selectionPivot(targets))
		if (!base) return false
		const start = targets.map((o) => {
			const w = h.objects.worldPlacement(o)
			return { x: w.pos.x, z: w.pos.z, y: w.pos.y, rot: w.rot, scale: w.scale }
		})
		this.drag = { ...base, kind: 'group', targets, before: targets.map((o) => ({ ...o })), start }
		h.setCursor(heldCursor(handle))
		return true
	}

	private updateGroup(d: GroupDrag, snap: boolean) {
		const h = this.host
		const p = this.point
		const c = d.centre
		const n = d.targets.length
		let turn = 0
		let factor = 1
		let dy = 0
		let mx = 0
		let mz = 0
		if (d.move) {
			let along = alongAxis(p, d.move.from, d.move.axis)
			if (snap) along = snapHalfYard(along)
			mx = d.move.axis.x * along
			mz = d.move.axis.z * along
			queueViewportHint(`Move ${along >= 0 ? '+' : ''}${along.toFixed(2)} along ${d.handle === 'moveX' ? 'x' : 'z'} (${n} objects)`)
		} else if (d.handle === 'ring') {
			turn = ringAngle(p, c) - d.startAngle
			if (snap) turn = snapAngle(turn)
			h.gizmo.setSweep(d.startAngle, turn)
			queueViewportHint(`Rotation ${Math.round(THREE.MathUtils.radToDeg(turn))}° (${n} objects)`)
		} else if (d.handle === 'scale') {
			factor = Math.hypot(p.x - c.x, p.z - c.z) / d.startDist
			if (snap) factor = Math.max(0.1, Math.round(factor * 10) / 10)
			queueViewportHint(`Scale ×${factor.toFixed(2)} (${n} objects)`)
		} else {
			dy = p.y - d.startY
			if (snap) dy = snapHalfYard(dy)
			queueViewportHint(`Height ${dy >= 0 ? '+' : ''}${dy.toFixed(2)} (${n} objects)`)
		}
		const about = editor.rotatePivot
		const slid = turn !== 0 || factor !== 1 || mx !== 0 || mz !== 0
		for (let i = 0; i < n; i++) {
			const o = d.targets[i]
			const s = d.start[i]
			const w = h.objects.worldPlacement(o)
			const at = groupSpot(s, c, mx, mz, turn, factor, about, this.spot)
			w.pos.x = THREE.MathUtils.clamp(at.x, 0, h.terrain.worldSize)
			w.pos.z = THREE.MathUtils.clamp(at.z, 0, h.terrain.worldSize)
			// A ground model is re-seated on the terrain where it lands; an attached one keeps its height.
			w.pos.y = (o.parent === undefined && slid ? h.terrain.heightAt(w.pos.x, w.pos.z) + d.before[i].yOff : s.y) + dy
			w.rot = s.rot + turn
			w.scale = clampScale(s.scale * factor)
			h.objects.place(o, o.parent ?? null, w)
			markMoved(o.id)
		}
	}

	/** The spawn's ring turns its facing and its arrow its height; its position stays. */
	private startSpawn(): boolean {
		const h = this.host
		const s = this.selectedSpawn()
		if (!s) return false
		const handle = this.pickHandle()
		if (handle !== 'ring' && handle !== 'arrow') return false
		const base = this.grab(handle, s)
		if (!base) return false
		this.drag = { ...base, kind: 'spawn', key: spawnKey(s), orientation: s.orientation, y: s.y }
		h.setCursor(heldCursor(handle))
		return true
	}

	private updateSpawn(d: SpawnDrag, snap: boolean) {
		const h = this.host
		const s = h.spawnLayer.get(d.key)
		if (!s) return
		if (d.handle === 'ring') {
			const was = spawnRotation(d.orientation)
			let rot = was + (ringAngle(this.point, d.centre) - d.startAngle)
			if (snap) rot = snapAngle(rot)
			h.gizmo.setSweep(d.startAngle, rot - was)
			applySpawn(h.spawnLayer, d.key, { orientation: spawnOrientation(rot) }, true)
			queueViewportHint(`Facing ${Math.round(THREE.MathUtils.radToDeg(spawnOrientation(rot)))}°`)
		} else {
			let dy = this.point.y - d.startY
			if (snap) dy = snapHalfYard(dy)
			const y = d.y + dy
			applySpawn(h.spawnLayer, d.key, { y }, true)
			const above = y - h.terrain.heightAt(s.x, s.z)
			queueViewportHint(`Height ${above >= 0 ? '+' : ''}${above.toFixed(2)} above the ground`)
		}
	}
}
