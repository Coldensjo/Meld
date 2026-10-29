import { pressed } from '../ui/commands'
import * as THREE from 'three'
import type { vmangos } from '../wails/models'
import { editor, setStatus, ui } from '../state/editor.svelte'
import { markMoved, movableSelection, selectObjects, withGroups } from '../state/selection'
import { getAsset } from '../models/assets'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import type { ObjectClip } from '../world/clipboard'
import type { Tool, ToolContext } from './Tool'
import { groundNormal, tiltToNormal } from '../world/groundTilt'
import { GhostPool } from './ghosts'
import { areaCells, areaShape, objectsInArea, setAreaCells } from '../state/areaSelection'
import { combineArea, rectCells } from '../terrain/areaShape'
import type { MaskOp } from '../terrain/maskSelect'
import { pasteLandings, type Landing } from '../world/pasteLanding'
import { spawnKey } from '../world/SpawnLayer'
import { pickNearest } from '../world/pickNearest'
import { placementEuler } from '../world/placement'
import { applySpawn, newWaypoint, selectSpawn, spawnChange, syncSpawnUi, withPoint, type SpawnFields } from '../world/spawnEdits'
import { slotFieldsAt } from '../world/formations'
import { InputsKey } from './inputsKey'
import { groupTransformCommand } from '../world/objectCommands'
import { AreaOutline, pressOp } from './areaOutline'

const UP = new THREE.Vector3(0, 1, 0)

/**
 * How far, in screen pixels, the pointer must move after a press on a model, spawn or path point
 * before it drags, so a click or a double-click never shifts what it selects.
 */
const DRAG_PX = 4

const tmpQ = new THREE.Quaternion()
/** The clip objects with no paste going, so a frame without one doesn't allocate an empty list. */
const NO_CLIP_OBJECTS: ObjectClip['objects'] = []
const tmpE = new THREE.Euler()
const tmpS = new THREE.Vector3()
/** An attached model's world spot, for the selection brush. */
const brushPos = new THREE.Vector3()

/** An area drag's corner, in cells. */
interface Cell {
	x: number
	z: number
}

/**
 * The Select tool. A click on a model selects it (Shift adds or removes it) and a drag moves the
 * selection along whatever is under the cursor; the clicked model leads and the others keep their
 * offsets. A drag on the ground selects an area, and with it every model standing in it. While
 * pasting, the floating clip follows the cursor and a click drops it.
 */
export class SelectTool implements Tool {
	get usesBrush() {
		return editor.selectBrush
	}
	/** A selection brush stroke: the selection it builds, and whether it takes models out. */
	private brushing: { remove: boolean; ids: Set<number> } | null = null
	/** Scratch for `brushAt`. */
	private brushNear: WorldObject[] = []
	private normal = { x: 0, y: 1, z: 0 }
	/** Dragging the selection: `lead` is the clicked model; `others` keep their world offset from it. */
	private dragging: {
		lead: number
		dx: number
		dz: number
		lift: number
		/** The lead's world height when the drag began, for a move across a level plane (follow cursor off) or a group that keeps its heights. */
		startY: number
		exclude: Set<number>
		moved: boolean
		others: Array<{ id: number; ox: number; oz: number }>
		before: WorldObject[]
	} | null = null
	private plane = new THREE.Plane()
	private planeHit = new THREE.Vector3()
	/** Dragging a region's spawn along the surface under the cursor, keeping its offset from the cursor. */
	private spawnDrag: { key: string; dx: number; dz: number; before: SpawnFields; moved: boolean } | null = null
	/** Dragging point `i` of a creature's path (Path editing), with the path as it was. */
	private pointDrag: { key: string; i: number; before: vmangos.Waypoint[]; moved: boolean } | null = null
	/** Where the press that may start a drag was, in client pixels; a drag waits for DRAG_PX from it. */
	private pressX = 0
	private pressY = 0
	/** The pointer has moved DRAG_PX from the press, so a model, spawn or point under it drags. */
	private pastThreshold = false
	/** The cell an area drag started at. */
	private rectStart: Cell | null = null
	/** The cell an area drag has reached; `publishRect` copies the area into `editor.selection` once a frame. */
	private rectEnd: Cell = { x: 0, z: 0 }
	private rectDirty = false
	/** How the rect being dragged meets the area there is (#712): Shift adds, Ctrl subtracts, a plain drag replaces. */
	private rectOp: MaskOp = 'replace'
	/** Scratch for `dragRect` and `rectOutline`. */
	private rectBox = { x0: 0, z0: 0, x1: 0, z1: 0 }
	private rectPts: number[] = []
	/** A lasso being dragged or a polygon being clicked (#183, areaOutline.ts). */
	private outline = new AreaOutline((ctx, drawn, op) => this.commitArea(ctx, drawn, op))
	/** Where a floating area paste would land (corner cell), updated every frame. */
	pasteAt: Cell | null = null
	/** Where a floating model paste would land (its anchor, on the surface under the cursor), updated every frame. */
	pasteWorld: THREE.Vector3 | null = null
	/** The model paste's anchor is on a model, so its roots stand on the models under them (#191). */
	pasteOnModel = false
	/** The roots' landings for the ghosts, worked out again only when the anchor, the clip or the models change. */
	private landings: Map<number, Landing> | null = null
	private landingKey = new InputsKey()
	/** Previews of the models being pasted, one mesh per clip object, grown as needed. */
	private ghosts = new GhostPool(false)
	private ghostTmp = new THREE.Vector3()
	/** The ghosts by clip id, for the attached ones' parents; cleared each frame. */
	private ghostByCid = new Map<number, THREE.Mesh>()

	constructor(
		private hooks: {
			/** The area clip's size while an area is being pasted. */
			clipSize: () => { w: number; h: number } | null
			/** The model clip while models are being pasted. */
			objectClip: () => ObjectClip | null
			commitPaste: () => void
			/** Spawns the creature or object template being placed at a point (see SpawnActions.placeSpawnAt). */
			placeSpawn: (at: THREE.Vector3, rotY?: number) => void
			cancelPaste: () => void
			/** A click on a spawn while a formation or pool is built (`ui.spawnPick`, see SpawnActions.pickSpawn). */
			pickSpawn: (s: vmangos.WorldSpawn) => void
		},
	) {}

	activate(ctx: ToolContext) {
		this.ghosts.attach(ctx.scene)
		this.outline.attach(ctx.scene)
		ctx.holeWalls.attach(ctx.scene)
	}

	private cell(ctx: ToolContext, hit: THREE.Vector3): Cell {
		const cs = ctx.terrain.cellSize
		const n = ctx.terrain.size
		return {
			x: Math.min(n, Math.max(0, Math.round(hit.x / cs))),
			z: Math.min(n, Math.max(0, Math.round(hit.z / cs))),
		}
	}

	dispose() {
		this.outline.dispose()
	}

	deactivate(ctx: ToolContext) {
		this.rectStart = null
		this.dragging = null
		this.ghosts.detach(ctx.scene)
		this.outline.detach(ctx.scene)
		ctx.holeWalls.detach(ctx.scene)
		if (ui.pasting) this.hooks.cancelPaste()
	}

	/** Shows the clip's models at the anchor `at`, or hides the previews when there is no clip. */
	private updateGhosts(ctx: ToolContext, clip: ObjectClip | null, at: THREE.Vector3 | null) {
		const list = clip && at ? clip.objects : NO_CLIP_OBJECTS
		let landings: Map<number, Landing> | null = null
		if (clip && at && this.pasteOnModel) {
			const key = this.landingKey
				.begin()
				.add(Math.round(at.x * 100))
				.add(Math.round(at.z * 100))
				.add(ctx.objects.version)
				.add(clip)
			if (key.changed() || !this.landings) {
				this.landings = pasteLandings(ctx.objects, ctx.terrain, clip.objects, at.x, at.z)
			}
			landings = this.landings
		}
		this.ghosts.grow(list.length)
		const byCid = this.ghostByCid
		byCid.clear()
		for (let i = 0; i < this.ghosts.length; i++) {
			const o = list[i]
			if (!o || !at) {
				this.ghosts.at(i).visible = false
				continue
			}
			const g = this.ghosts.show(i, getAsset(o.type))
			g.visible = true
			byCid.set(o.cid, g)
			if (o.cparent !== undefined) {
				const p = byCid.get(o.cparent)
				if (!p) {
					g.visible = false
					continue
				}
				g.matrix.compose(this.ghostTmp.set(o.x, o.yOff, o.z), tmpQ.setFromEuler(placementEuler(tmpE, o.rotY, o.tiltX, o.tiltZ)), tmpS.setScalar(o.scale))
				g.matrix.premultiply(p.matrix)
			} else {
				const x = at.x + o.x
				const z = at.z + o.z
				const base = landings?.get(o.cid)?.y ?? ctx.terrain.heightAt(x, z)
				g.matrix.compose(this.ghostTmp.set(x, base + o.yOff, z), tmpQ.setFromEuler(placementEuler(tmpE, o.rotY, o.tiltX, o.tiltZ)), tmpS.setScalar(o.scale))
			}
			g.matrixWorld.copy(g.matrix)
		}
	}

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
		this.pressX = e.clientX
		this.pressY = e.clientY
		this.pastThreshold = false
		if (ui.pasting) {
			this.hooks.commitPaste()
			return
		}
		// A hole's edge or badge under the cursor comes before a model over it: the edge is lit up, so
		// the intent is clear, and the press moves the edge or cuts/fills a cell at it.
		if (ctx.holeWalls.onDown(ctx)) return
		// While a polygon is open, every click is its next corner, on a model as anywhere else.
		if (this.outline.polygon) {
			const at = this.groundPoint(ctx, hit)
			if (at) this.outline.press(ctx, at, e)
			return
		}
		// The model or the spawn nearest along the click: a creature on a building's floor is the creature.
		const { id, spawn } = pickNearest(ctx.objects, ctx.spawns, ctx.raycaster)
		if (id !== null) {
			this.pressObject(ctx, id, hit, e.shiftKey)
			return
		}
		if (ui.placeCreature || ui.placeObject) {
			// Shift keeps placing the same template; a plain click places one and stops.
			const surf = ctx.floor()
			if (surf) this.hooks.placeSpawn(surf.point.clone())
			if (!e.shiftKey) ui.placeCreature = ui.placeObject = null
			return
		}
		if (ui.pathEdit && editor.selectedSpawn && this.pressPath(ctx, spawnKey(editor.selectedSpawn))) return
		// While a formation or pool is built, a click on a spawn adds it (or takes it out) instead of selecting it.
		if (ui.spawnPick) {
			if (spawn) this.hooks.pickSpawn(spawn)
			return
		}
		// A creature or object of the region (or nothing) is selected, and a drag moves it. The panel
		// gets a copy, so its state never wraps the drawn spawn.
		selectSpawn(spawn)
		if (spawn) {
			if (editor.selectedIds.length) selectObjects(ctx.objects, [])
			const at = ctx.floor()?.point ?? hit
			if (at)
				this.spawnDrag = {
					key: spawnKey(spawn),
					dx: spawn.x - at.x,
					dz: spawn.z - at.z,
					before: { x: spawn.x, y: spawn.y, z: spawn.z, followDist: spawn.followDist, followAngle: spawn.followAngle },
					moved: false,
				}
			return
		}
		const at = this.groundPoint(ctx, hit)
		if (!at) return
		if (editor.selectBrush) {
			// A plain stroke starts a new selection; Shift adds to the one there is, Ctrl takes models out.
			this.brushing = { remove: e.ctrlKey, ids: new Set(e.shiftKey || e.ctrlKey ? editor.selectedIds : []) }
			if (!e.shiftKey && !e.ctrlKey) editor.selection = null
			this.brushAt(ctx, at)
			return
		}
		if (editor.selectShape !== 'rect') {
			this.outline.press(ctx, at, e)
			return
		}
		// As the lasso (#183, #712): Shift adds the rect to the area, Ctrl takes it out, a plain drag replaces it.
		const op = pressOp(e)
		this.rectOp = op
		this.rectStart = this.cell(ctx, at)
		this.rectEnd = this.rectStart
		this.rectDirty = false
		if (op !== 'replace') return
		// A plain drag shows the new rect as the area while it is dragged; an add or subtract keeps the area
		// there is on show and draws the rect as an outline over it.
		selectObjects(ctx.objects, [])
		editor.selection = { x0: this.rectStart.x, z0: this.rectStart.z, x1: this.rectStart.x, z1: this.rectStart.z }
	}

	private solidHit = new THREE.Vector3()

	/**
	 * Makes the cells a lasso, polygon or rect drew the selected area, added to or taken from the one
	 * there is by `op`, and selects the models in it.
	 */
	private commitArea(ctx: ToolContext, drawn: Uint8Array, op: MaskOp) {
		const t = ctx.terrain
		const size = t.size
		const before = editor.selectedIds
		const cells = combineArea(op === 'replace' ? null : areaCells(t, size), drawn, op)
		const r = setAreaCells(t, size, cells)
		const inside = r
			? withGroups(
					ctx.objects,
					objectsInArea(ctx.objects, t, size, t.cellSize).map((m) => m.id),
				)
			: []
		// Shift keeps the models selected before; Ctrl drops those no longer in the area.
		const insideSet = op === 'subtract' ? new Set(inside) : null
		const ids = op === 'add' ? [...before, ...inside] : insideSet ? before.filter((id) => insideSet.has(id)) : inside
		selectObjects(ctx.objects, ids)
		const m = editor.selectedIds.length
		const objs = `${m} ${m === 1 ? 'object' : 'objects'}`
		if (!r) setStatus('The area is empty.')
		else if (!areaShape(t, size)) setStatus(`Selected ${r.x1 - r.x0} × ${r.z1 - r.z0} cells with ${objs}.`)
		else {
			let count = 0
			for (let i = 0; i < cells.length; i++) if (cells[i]) count++
			setStatus(`Selected ${count} cells (${r.x1 - r.x0} × ${r.z1 - r.z0} around) with ${objs}.`)
		}
	}

	/** The rect being dragged as world x, z pairs around its sides, a point a cell, in a reused array. */
	private rectOutline(cs: number): number[] {
		const r = this.dragRect()
		const p = this.rectPts
		p.length = 0
		for (let x = r.x0; x < r.x1; x++) p.push(x * cs, r.z0 * cs)
		for (let z = r.z0; z < r.z1; z++) p.push(r.x1 * cs, z * cs)
		for (let x = r.x1; x > r.x0; x--) p.push(x * cs, r.z1 * cs)
		for (let z = r.z1; z > r.z0; z--) p.push(r.x0 * cs, z * cs)
		if (!p.length) p.push(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
		return p
	}

	/** The cells between the drag's start and where it has reached. */
	private dragRect() {
		const a = this.rectStart ?? this.rectEnd
		const b = this.rectEnd
		const r = this.rectBox
		r.x0 = Math.min(a.x, b.x)
		r.z0 = Math.min(a.z, b.z)
		r.x1 = Math.max(a.x, b.x)
		r.z1 = Math.max(a.z, b.z)
		return r
	}

	/**
	 * The selection brush at `at`: every drawn model whose place is within the brush radius joins the
	 * stroke's selection (or leaves it, with Ctrl), as Noggit Red's `range_add_to_selection`.
	 */
	private brushAt(ctx: ToolContext, at: THREE.Vector3) {
		const b = this.brushing
		if (!b) return
		const L = ctx.objects
		const r = editor.brush.radius
		let changed = b.ids.size === 0 && editor.selectedIds.length > 0
		// The roots from the layer's cells around the brush (#512); the attached ones by their world spot.
		for (const o of L.rootsNear(at.x, at.z, r, this.brushNear)) if (this.brushOne(L, b, o)) changed = true
		for (const o of L.attachedObjects(this.brushNear)) {
			const p = L.worldPosition(o, brushPos)
			if ((p.x - at.x) ** 2 + (p.z - at.z) ** 2 <= r * r && this.brushOne(L, b, o)) changed = true
		}
		this.brushNear.length = 0
		if (changed) selectObjects(L, b.ids, editor.selected?.id)
	}

	/** Adds a model the selection brush reached (with its group) to the stroke's selection, or takes it out; true when that changed it. */
	private brushOne(L: ObjectLayer, b: { remove: boolean; ids: Set<number> }, o: WorldObject): boolean {
		if (!L.pickable(o.id)) return false
		let changed = false
		for (const m of o.group ? withGroups(L, [o.id]) : [o.id]) {
			if (b.remove) {
				if (b.ids.delete(m)) changed = true
			} else if (!b.ids.has(m)) {
				b.ids.add(m)
				changed = true
			}
		}
		return changed
	}

	/**
	 * The ground under the cursor for an area selection: the terrain hit, or, where the cursor is over
	 * a hole (the pick ray passes through holes), where the ground would be, so an area can start or
	 * end on a hole and a hole can be selected on its own to fill it.
	 */
	private groundPoint(ctx: ToolContext, hit: THREE.Vector3 | null): THREE.Vector3 | null {
		if (hit && !ctx.terrain.isHole(hit.x, hit.z)) return hit
		return ctx.terrain.raycast(ctx.raycaster.ray, this.solidHit, 4000, true) ? this.solidHit : hit
	}

	/**
	 * A click while editing a creature's path: on a point, picks it and starts dragging it; on the
	 * ground, adds a point after the picked one (or at the end) where the click was. Returns false
	 * when there is no path to edit, so the click selects as usual.
	 */
	private pressPath(ctx: ToolContext, key: string): boolean {
		const s = ctx.spawns.get(key)
		if (!s || s.kind === 'object') {
			ui.pathEdit = false
			return false
		}
		const points = s.waypoints ?? []
		const i = ctx.paths.pickPoint(ctx.raycaster)
		if (i >= 0) {
			editor.selectedWaypoint = i
			this.pointDrag = { key, i, before: points, moved: false }
			return true
		}
		const surf = ctx.surface()
		if (!surf) return true
		const at = editor.selectedWaypoint >= 0 && editor.selectedWaypoint < points.length ? editor.selectedWaypoint + 1 : points.length
		const vals: SpawnFields = { waypoints: withPoint(points, at, newWaypoint(surf.point.x, surf.point.y, surf.point.z), true) }
		// A creature given a path walks it.
		if (s.movementType !== 2) vals.movementType = 2
		const cmd = spawnChange(ctx.spawns, key, vals, `Add path point (${s.name})`)
		if (cmd) ctx.history.push(cmd)
		editor.selectedWaypoint = at
		return true
	}

	/** A click on model `id`: selects it (Shift toggles it in the selection) and starts dragging the selection. */
	private pressObject(ctx: ToolContext, id: number, hit: THREE.Vector3 | null, shift: boolean) {
		const o = ctx.objects.objects.get(id)
		if (!o) return
		selectSpawn(null)
		let ids = editor.selectedIds
		// A model in a selection group comes with the whole group.
		const members = withGroups(ctx.objects, [id])
		if (shift) {
			// Shift+click adds or removes without moving anything.
			const had = ids.includes(id)
			const memberSet = new Set(members)
			ids = had ? ids.filter((i) => !memberSet.has(i)) : [...ids, ...members]
			selectObjects(ctx.objects, ids, had ? undefined : id)
			return
		}
		if (!ids.includes(id)) ids = members
		selectObjects(ctx.objects, ids, id)
		// Drag along whatever surface is under the cursor (never the selection itself or things attached
		// to it); the lead re-attaches to what it lands on.
		const exclude = ctx.objects.descendantsOf(ids)
		const surf = ctx.surface(exclude)
		const w = ctx.objects.worldPlacement(o)
		const at = surf?.point ?? hit
		if (!at) return
		const moving = movableSelection(ctx.objects)
		const others = moving
			.filter((s) => s.id !== id)
			.map((s) => {
				const sw = ctx.objects.worldPlacement(s)
				return { id: s.id, ox: sw.pos.x - w.pos.x, oz: sw.pos.z - w.pos.z }
			})
		const before = [o, ...others.map((s) => ctx.objects.objects.get(s.id)!)].map((s) => ({ ...s }))
		this.dragging = { lead: id, dx: w.pos.x - at.x, dz: w.pos.z - at.z, lift: Math.max(0, w.pos.y - at.y), startY: w.pos.y, exclude, moved: false, others, before }
	}

	onMove(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
		if (ctx.holeWalls.active) {
			ctx.holeWalls.onMove(ctx)
			return
		}
		if ((this.pointDrag || this.spawnDrag || this.dragging) && !this.pastThreshold) {
			if (Math.hypot(e.clientX - this.pressX, e.clientY - this.pressY) < DRAG_PX) return
			this.pastThreshold = true
		}
		const pd = this.pointDrag
		if (pd) {
			const s = ctx.spawns.get(pd.key)
			const surf = ctx.floor()
			const p = s?.waypoints?.[pd.i]
			if (!s || !surf || !p || !ctx.terrain.contains(surf.point.x, surf.point.z)) return
			ctx.spawns.touch(s)
			s.waypoints = withPoint(s.waypoints, pd.i, { ...p, x: surf.point.x, y: surf.point.y, z: surf.point.z })
			ctx.spawns.refresh(s)
			pd.moved = true
			return
		}
		const sd = this.spawnDrag
		if (sd) {
			const s = ctx.spawns.get(sd.key)
			const surf = ctx.floor()
			if (!s || !surf) return
			const x = surf.point.x + sd.dx
			const z = surf.point.z + sd.dz
			if (!ctx.terrain.contains(x, z)) return
			ctx.spawns.touch(s)
			// A spawn stands on what is under the cursor: the ground where it is, or a building's floor.
			s.x = x
			s.z = z
			s.y = surf.parent === null ? ctx.terrain.heightAt(x, z) : surf.point.y
			ctx.spawns.refresh(s)
			sd.moved = true
			return
		}
		if (this.brushing) {
			const at = this.groundPoint(ctx, hit)
			if (at) this.brushAt(ctx, at)
			return
		}
		if (this.outline.lasso) {
			const at = this.groundPoint(ctx, hit)
			if (at) this.outline.extend(ctx, at)
			return
		}
		if (this.rectStart) {
			const at = this.groundPoint(ctx, hit)
			if (!at) return
			const c = this.cell(ctx, at)
			if (c.x !== this.rectEnd.x || c.z !== this.rectEnd.z) {
				this.rectEnd = c
				this.rectDirty = true
			}
			return
		}
		const d = this.dragging
		const o = d ? ctx.objects.objects.get(d.lead) : undefined
		if (!d || !o) return
		const group = d.others.length > 0
		// noggit's mouse-move checkboxes: a single model either follows the cursor's ground point or
		// slides across a level plane at its own height; a group either lands on the ground or keeps
		// every model's height. Keeping a height means keeping the parent too.
		const onSurface = group ? editor.moveSnapGroup : editor.moveFollowCursor
		const w = ctx.objects.worldPlacement(o)
		if (onSurface) {
			const surf = ctx.surface(d.exclude)
			if (!surf) return
			w.pos.set(surf.point.x + d.dx, surf.point.y + d.lift, surf.point.z + d.dz)
			ctx.objects.place(o, surf.parent, w)
			if (editor.followGround && surf.parent === null) {
				const t = ctx.terrain
				const n = groundNormal((x, z) => t.heightAt(x, z), o.x, o.z, t.cellSize, editor.followGroundSmooth, this.normal)
				Object.assign(o, tiltToNormal(n.x, n.y, n.z, o.rotY))
				ctx.objects.touch(o.id)
			}
		} else {
			// Where the pointer's ray crosses the level plane through the lead's starting height.
			this.plane.set(UP, -d.startY)
			if (!ctx.raycaster.ray.intersectPlane(this.plane, this.planeHit)) return
			const nx = this.planeHit.x + d.dx
			const nz = this.planeHit.z + d.dz
			if (!ctx.terrain.contains(nx, nz)) return
			w.pos.set(nx, d.startY, nz)
			ctx.objects.place(o, o.parent ?? null, w)
		}
		// The rest of the selection keeps its offset from the lead: set on the ground where it lands
		// (its height above it kept), or left at its height.
		for (const other of d.others) {
			const s = ctx.objects.objects.get(other.id)
			if (!s) continue
			const sw = ctx.objects.worldPlacement(s)
			const nx = w.pos.x + other.ox
			const nz = w.pos.z + other.oz
			if (!ctx.terrain.contains(nx, nz)) continue
			sw.pos.x = nx
			sw.pos.z = nz
			if (onSurface && s.parent === undefined) sw.pos.y = ctx.terrain.heightAt(nx, nz) + s.yOff
			ctx.objects.place(s, s.parent ?? null, sw)
		}
		d.moved = true
		markMoved(o.id)
	}

	onUp(ctx: ToolContext, _hit?: THREE.Vector3 | null, _e?: PointerEvent) {
		ctx.holeWalls.onUp(ctx)
		if (this.brushing) {
			this.brushing = null
			return
		}
		const pd = this.pointDrag
		this.pointDrag = null
		if (pd) {
			const s = ctx.spawns.get(pd.key)
			if (!pd.moved || !s) return
			const layer = ctx.spawns
			const after = s.waypoints
			syncSpawnUi(layer)
			ctx.history.push({
				label: `Move path point (${s.name})`,
				undo: () => applySpawn(layer, pd.key, { waypoints: pd.before }),
				redo: () => applySpawn(layer, pd.key, { waypoints: after }),
			})
			return
		}
		const sd = this.spawnDrag
		this.spawnDrag = null
		if (sd) {
			const s = ctx.spawns.get(sd.key)
			if (!s) return
			// A click (no drag) only selects; the creature editor opens from the right-click menu.
			if (!sd.moved) return
			const layer = ctx.spawns
			// A follower dragged takes its slot where it was dropped (#172).
			const slot = slotFieldsAt(layer.spawns, s, s.x, s.z)
			if (slot) Object.assign(s, slot)
			const after: SpawnFields = { x: s.x, y: s.y, z: s.z, followDist: s.followDist, followAngle: s.followAngle }
			syncSpawnUi(layer)
			ctx.history.push({ label: `Move ${s.name}`, undo: () => applySpawn(layer, sd.key, sd.before), redo: () => applySpawn(layer, sd.key, after) })
			return
		}
		if (this.outline.lasso) {
			this.outline.close(ctx)
			return
		}
		if (this.rectStart) {
			const r = this.dragRect()
			this.rectStart = null
			const op = this.rectOp
			if (r.x1 === r.x0 || r.z1 === r.z0) {
				// A plain click (no area) clears the area; a Shift or Ctrl click leaves it as it was.
				if (op === 'replace') editor.selection = null
				return
			}
			const size = ctx.terrain.size
			this.commitArea(ctx, rectCells(r, size), op)
			return
		}
		const d = this.dragging
		this.dragging = null
		if (!d?.moved) return
		const after = d.before.map((b) => ctx.objects.objects.get(b.id)).filter((o): o is WorldObject => !!o)
		const before = d.before.filter((b) => after.some((a) => a.id === b.id))
		ctx.history.push(groupTransformCommand(ctx.objects, before, after))
	}

	frame(ctx: ToolContext, hit: THREE.Vector3 | null) {
		this.publishRect()
		ctx.holeWalls.frame(ctx)
		// An add or subtract rect is drawn as its outline over the area there is, a point a cell along its sides.
		const open = this.outline.polygon || this.outline.lasso
		this.outline.draw(ctx, hit, !open && this.rectStart && this.rectOp !== 'replace' ? this.rectOutline(ctx.terrain.cellSize) : null)
		const clip = ui.pasting ? this.hooks.objectClip() : null
		if (clip) {
			// Models paste onto the ground under the cursor (buildings included, since the ray stops there).
			const surf = hit ? ctx.surface() : null
			this.pasteWorld = surf ? surf.point : null
			this.pasteOnModel = !!surf && surf.parent !== null
			this.updateGhosts(ctx, clip, this.pasteWorld)
			return
		}
		this.updateGhosts(ctx, null, null)
		const size = ui.pasting ? this.hooks.clipSize() : null
		if (!size || !hit) return
		const cs = ctx.terrain.cellSize
		this.pasteAt = { x: Math.round(hit.x / cs - size.w / 2), z: Math.round(hit.z / cs - size.h / 2) }
	}

	/** Puts the area being dragged into `editor.selection` when it reached another cell since the last call. */
	private publishRect() {
		const a = this.rectStart
		if (!a || !this.rectDirty || this.rectOp !== 'replace') return
		this.rectDirty = false
		editor.selection = { ...this.dragRect() }
	}

	onKey(ctx: ToolContext, e: KeyboardEvent) {
		if (ui.pasting) {
			if (e.key === 'Escape') this.hooks.cancelPaste()
			else if (e.key === 'Enter') this.hooks.commitPaste()
			else if (pressed('liftUp', e)) editor.paste.heightOffset += e.shiftKey ? 5 : 1
			else if (pressed('liftDown', e)) editor.paste.heightOffset -= e.shiftKey ? 5 : 1
			else return false
			return true
		}
		if (this.outline.polygon) {
			if (e.key === 'Enter') this.outline.close(ctx)
			else if (e.key === 'Escape') this.outline.cancel()
			else if (e.key === 'Backspace') this.outline.dropLast()
			else return false
			return true
		}
		if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey && !e.altKey) {
			const order = ['rect', 'lasso', 'polygon'] as const
			editor.selectShape = order[(order.indexOf(editor.selectShape) + 1) % order.length]
			editor.selectBrush = false
			setStatus(`Select: ${editor.selectShape === 'rect' ? 'rectangle' : editor.selectShape} (L cycles).`, 2000)
			return true
		}
		if (pressed('escDeselect', e) && (editor.selection || editor.selectedIds.length)) {
			editor.selection = null
			selectObjects(ctx.objects, [])
			return true
		}
		return false
	}
}
