import * as THREE from 'three'
import { placementEuler } from './placement'
import type { MeshBVH } from 'three-mesh-bvh'
import { getAsset, onAssetLoaded } from '../models/assets'
import type { Terrain } from '../terrain/Terrain'
import { splitLod, type CullView } from './instanceCull'
import { InstanceBatch, instancedMesh, watchUploads } from './instanceBatch'
import { packedCount } from './shadowReach'
import { WmoGroupCull } from './wmoGroupCull'
import { CellGrid } from './cellGrid'
import { firstPick, hitId } from './instanceHit'
import { meshTriangles, type ModelCost } from '../engine/perfMeter'
import { wantLiquid, wmoLiquidMaterial } from '../water/liquidMaterial'
import { farDepthMaterial } from '../models/farLayers'
import type { LiquidClass } from '../water/liquids'

/** The least upward part of a surface's normal that a creature stands on (#660): about 70° of slope; steeper is a wall, below 0 a ceiling. */
const FLOOR_MIN_UP = 0.35

export interface WorldObject {
	id: number
	type: string
	/**
	 * Attached-to object id. When set, x/yOff/z/rotY/scale are local to the
	 * parent's transform (the object rides along when the parent moves).
	 * Otherwise x/z are world coordinates and yOff is height above the terrain.
	 */
	parent?: number
	x: number
	z: number
	yOff: number
	rotY: number
	/** Tilt forward and back, and side to side, in radians, about the model's own axes before its turn. */
	tiltX?: number
	tiltZ?: number
	scale: number
	/**
	 * The selection group the object is in (Noggit Red's selection groups): selecting one member
	 * selects them all. Saved in the map file; none when unset.
	 */
	group?: number
}

/** World-space placement of an object (position, yaw, uniform scale). */
export interface WorldPlacement {
	pos: THREE.Vector3
	rot: number
	scale: number
}

const MAX_DEPTH = 8
/** The most moves `ObjectLayer` logs before cutting the log (a sculpt stroke over a city re-snaps thousands a frame). */
const MOVE_LOG = 16384
const NO_MOVES: readonly number[] = []
const NO_IDS: ReadonlySet<number> = new Set()
/** The side of the cells `rootsNear` and `rootsIn` read (#512), in yards: about a chunk. */
const NEAR_CELL = 32
/**
 * A root that reaches further than this from its spot (`reachOf`, which covers its footprint,
 * `groundReach`, too), in yards, is kept in `wide` as well, so a sized `rootsNear` and `rootsTouching`
 * read the cells this far around their rect and those few roots, not every cell.
 */
const WIDE = 64

interface Batch {
	/**
	 * Every object of the type that is not hidden (`rows.items`, ids), with its world matrix and
	 * bounding sphere, and the ones in view (`rows.packed`).
	 */
	rows: InstanceBatch<number>
	mesh: THREE.InstancedMesh
	/** The ids of the instances drawn, by instance index: the ones in view, packed (see cull). */
	ids: number[]
	/** Draws the instances small on screen with the model's LOD, when it has one (see models/lod.ts). */
	lod: THREE.InstancedMesh | null
	lodIds: number[]
	/**
	 * A WMO's lava and water (#287): the instances in view, as `mesh` and `lod` hold them together,
	 * drawn with the liquid shader. Not picked and casting no shadow, as the client's liquids.
	 */
	liquid: THREE.InstancedMesh | null
	liquidIds: number[]
	/** A big WMO's culling by group for the scene pass (world/wmoGroupCull.ts), or null. */
	cull: WmoGroupCull | null
	/** Indices into `rows.items` of the instances drawn in full and with the LOD, and scratch for the split. */
	near: number[]
	far: number[]
	/** How many of `near` and of `far` lead as the ones in the camera's view (`splitLod`'s split). */
	nearFar: { near: number; far: number }
	scratchNear: number[]
	scratchFar: number[]
	/** The rows need building again from `members`: an object joined, left or was hidden. */
	dirty: boolean
	/** The ids of every object of the type, hidden or not, so `update` reads only its own (#329). */
	members: Set<number>
	/** Each id's index in `rows.items`, as of the last rebuild. */
	index: Map<number, number>
	/**
	 * The ids moved since the last `update` while the batch was not dirty (#510): `update` recomputes
	 * only their rows, and the next `cull` writes them into the instance buffers that draw them.
	 */
	moved: Set<number>
	/** The indices into `rows.items` whose rows `update` recomputed, for the next `cull`. */
	movedIdx: number[]
}

// Scratch for `matrixAt`, which runs for every instance a rebuild places (#329). A parent's matrix
// at depth d goes in `parentM[d]`, so the recursion never overwrites one still in use.
const mEuler = new THREE.Euler()
const mQuat = new THREE.Quaternion()
const mScale = new THREE.Vector3()
const mPos = new THREE.Vector3()
const parentM = Array.from({ length: MAX_DEPTH + 1 }, () => new THREE.Matrix4())

/**
 * All placed props. One InstancedMesh per model type keeps draw calls at
 * O(model types) no matter how many objects are placed. Root objects sit on
 * the terrain (y = ground + yOff) and get re-snapped after sculpting; attached
 * objects follow their parent.
 */
export class ObjectLayer {
	readonly group = new THREE.Group()
	readonly objects = new Map<number, WorldObject>()
	/**
	 * The layer is looked at, not edited: a world view's streamed models (#15). `selectObjects` selects
	 * none of them, so nothing that acts on the selection (delete, cut, move, the Inspector) reaches one.
	 */
	lookOnly = false
	/** Bumped on any change to placed objects (or their loaded models): what they are and where. */
	version = 0
	/**
	 * Bumped when what is placed changes, not where (#511): an object added, removed, given another
	 * model or hidden, a model loaded, the layer's view changed. A move (`touch`, `markRegionDirty`)
	 * leaves it and is logged instead, for `movedSince`: what keeps per-object state (the lights and
	 * flames, the particle pools, the WMO list) updates the moved objects alone rather than rebuilding.
	 */
	shapeVersion = 0
	/**
	 * The ids moved since the log was last cut, oldest first, an object's attached children after it;
	 * an id may appear more than once. Cut at `MOVE_LOG` entries, after which a reader further back
	 * gets null and rebuilds.
	 */
	private moveLog: number[] = []
	private moveBase = 0
	/** Counts the logged moves: a reader keeps the one it saw and asks `movedSince` for the rest. */
	get moveSeq(): number {
		return this.moveBase + this.moveLog.length
	}
	/** The ids moved since `seq` (a `moveSeq`), or null when the log no longer reaches back that far. */
	movedSince(seq: number): readonly number[] | null {
		if (seq < this.moveBase) return null
		return seq === this.moveSeq ? NO_MOVES : this.moveLog.slice(seq - this.moveBase)
	}
	/** Objects hidden for this session (H). Not saved in the map, and not undoable, like layer visibility. */
	readonly hidden = new Set<number>()
	/** Draw hidden objects anyway, so they can be picked and shown again. */
	private showHidden = false
	private batches = new Map<string, Batch>()
	/**
	 * The ids attached to each object, by parent id, and the parent each id was filed under (#329), so
	 * `markTree` finds an object's children without walking every object. Kept by `add`, `remove`,
	 * `clear` and `touch`: every change to an object's `parent` is followed by one of them.
	 */
	private kids = new Map<number, Set<number>>()
	private filedParent = new Map<number, number>()
	/**
	 * The root objects filed by their ground point (#512), so `rootsNear` and `rootsIn` read the cells
	 * around a spot rather than every object, and the roots reaching further than `WIDE` (a building).
	 * Kept with `kids`, by `file` (`add`, `touch`, `setType`, a model loading), `remove` and `clear`.
	 */
	private ground = new CellGrid(NEAR_CELL)
	private wide = new Set<number>()
	/**
	 * The ids in each selection group, and the group each id was filed under (#630), so `withGroups`
	 * reads a group's members rather than every object. Kept with `kids`, by `file` (`add`, `touch`),
	 * `setGroup`, `remove` and `clear`: every change to an object's `group` is followed by one of them.
	 */
	private groupIds = new Map<number, Set<number>>()
	private filedGroup = new Map<number, number>()
	private cellScratch: Set<number>[] = []
	private regionScratch: WorldObject[] = []
	private nextId = 1
	/** The next unused selection group number. */
	private nextGroup = 1
	private tmpM = new THREE.Matrix4()
	private tmpM2 = new THREE.Matrix4()
	private up = new THREE.Vector3(0, 1, 0)

	private unsubscribe: () => void

	constructor(private terrain: Terrain) {
		this.group.name = 'objects'
		// Swap placeholder meshes once an async (WoW) model finishes loading.
		this.unsubscribe = onAssetLoaded((type) => {
			const b = this.batches.get(type)
			if (!b) return
			this.version++
			this.shapeVersion++
			this.setMeshes(b, type, b.mesh.instanceMatrix.count)
			b.dirty = true
			// Its box is the model's now, not the placeholder's: how far each one reaches has changed.
			for (const id of b.members) {
				const o = this.objects.get(id)
				if (o) this.fileGround(o)
			}
		})
	}

	setTerrain(t: Terrain) {
		this.terrain = t
		this.markAllDirty()
	}

	add(o: Omit<WorldObject, 'id'> & { id?: number }): WorldObject {
		const obj: WorldObject = { ...o, id: o.id && o.id > 0 ? o.id : this.nextId++ }
		if (!obj.parent) delete obj.parent
		if (!obj.group) delete obj.group
		else this.nextGroup = Math.max(this.nextGroup, obj.group + 1)
		this.nextId = Math.max(this.nextId, obj.id + 1)
		const prev = this.objects.get(obj.id)
		if (prev) this.leaveBatch(prev)
		this.objects.set(obj.id, obj)
		this.joinBatch(obj)
		this.file(obj)
		this.version++
		this.shapeVersion++
		return obj
	}

	remove(id: number): WorldObject | undefined {
		const o = this.objects.get(id)
		if (!o) return
		this.objects.delete(id)
		this.hidden.delete(id)
		this.leaveBatch(o)
		this.unfile(id)
		this.unfileGroup(id)
		this.ground.delete(id)
		this.wide.delete(id)
		this.version++
		this.shapeVersion++
		return o
	}

	private joinBatch(o: WorldObject) {
		const b = this.batch(o.type)
		b.members.add(o.id)
		b.dirty = true
	}

	private leaveBatch(o: WorldObject) {
		const b = this.batches.get(o.type)
		if (b?.members.delete(o.id)) b.dirty = true
	}

	/**
	 * Files an object under its parent in `kids`, moving it from the one it was filed under, and a root
	 * by its ground point in `ground`.
	 */
	private file(o: WorldObject) {
		this.fileGround(o)
		this.fileGroup(o)
		const was = this.filedParent.get(o.id)
		if (was === o.parent) return
		if (was !== undefined) this.unfile(o.id)
		if (o.parent === undefined) return
		let ks = this.kids.get(o.parent)
		if (!ks) this.kids.set(o.parent, (ks = new Set()))
		ks.add(o.id)
		this.filedParent.set(o.id, o.parent)
	}

	private fileGround(o: WorldObject) {
		if (o.parent !== undefined) {
			this.ground.delete(o.id)
			this.wide.delete(o.id)
			return
		}
		this.ground.set(o.id, o.x, o.z)
		if (this.reachOf(o.type, o.scale) > WIDE) this.wide.add(o.id)
		else this.wide.delete(o.id)
	}

	/**
	 * How far a model of `type` at `scale` reaches across the ground from its spot: half its box's
	 * diagonal over x and z.
	 */
	groundReach(type: string, scale: number): number {
		const box = getAsset(type).bbox
		return Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5 * scale
	}

	/**
	 * How far any point of a model of `type` at `scale` can be from its spot, however it is turned or
	 * tilted: its box's farthest corner from the model's origin, which need not be the box's middle (a
	 * building's often isn't). Never less than `groundReach`.
	 */
	private reachOf(type: string, scale: number): number {
		const { min, max } = getAsset(type).bbox
		const x = Math.max(Math.abs(min.x), Math.abs(max.x))
		const y = Math.max(Math.abs(min.y), Math.abs(max.y))
		const z = Math.max(Math.abs(min.z), Math.abs(max.z))
		return Math.hypot(x, y, z) * scale
	}

	/**
	 * Fills `out` with the root objects whose model may reach into the rect (x0, z0)..(x1, z1), hidden
	 * ones too: those whose spot is within their `reachOf` of it (#551). A superset: test each one's
	 * box. Reads the cells `WIDE` around the rect and the wide roots, not every object.
	 */
	rootsTouching(x0: number, z0: number, x1: number, z1: number, out: WorldObject[]): WorldObject[] {
		out.length = 0
		for (const s of this.ground.cellsIn(x0 - WIDE, z0 - WIDE, x1 + WIDE, z1 + WIDE, this.cellScratch)) {
			for (const id of s) {
				if (this.wide.has(id)) continue
				const o = this.objects.get(id)
				if (o && o.parent === undefined) this.pushReaching(o, x0, z0, x1, z1, out)
			}
		}
		this.cellScratch.length = 0
		for (const id of this.wide) {
			const o = this.objects.get(id)
			if (o && o.parent === undefined) this.pushReaching(o, x0, z0, x1, z1, out)
		}
		return out
	}

	/** Adds a root to `out` when its spot is within its `reachOf` of the rect. */
	private pushReaching(o: WorldObject, x0: number, z0: number, x1: number, z1: number, out: WorldObject[]) {
		const dx = Math.max(x0 - o.x, 0, o.x - x1)
		const dz = Math.max(z0 - o.z, 0, o.z - z1)
		const r = this.reachOf(o.type, o.scale)
		if (dx * dx + dz * dz <= r * r) out.push(o)
	}

	/**
	 * Fills `out` with the root objects (no parent) whose ground point is within `r` of (x, z), hidden
	 * ones too; `sized`, within `r` of their footprint instead (`groundReach` added to `r`). Reads the
	 * cells around the spot, not every object (#512).
	 */
	rootsNear(x: number, z: number, r: number, out: WorldObject[], sized = false): WorldObject[] {
		out.length = 0
		const pad = sized ? WIDE : 0
		for (const s of this.ground.cellsIn(x - r - pad, z - r - pad, x + r + pad, z + r + pad, this.cellScratch)) {
			for (const id of s) {
				if (sized && this.wide.has(id)) continue
				const o = this.objects.get(id)
				if (o) this.pushNear(o, x, z, r, sized, out)
			}
		}
		if (sized) {
			for (const id of this.wide) {
				const o = this.objects.get(id)
				if (o) this.pushNear(o, x, z, r, sized, out)
			}
		}
		this.cellScratch.length = 0
		return out
	}

	private pushNear(o: WorldObject, x: number, z: number, r: number, sized: boolean, out: WorldObject[]) {
		if (o.parent !== undefined) return
		const lim = sized ? r + this.groundReach(o.type, o.scale) : r
		const dx = o.x - x
		const dz = o.z - z
		if (dx * dx + dz * dz <= lim * lim) out.push(o)
	}

	/** Fills `out` with the root objects whose ground point is in the rect (x0, z0)..(x1, z1), edges included, hidden ones too. */
	rootsIn(x0: number, z0: number, x1: number, z1: number, out: WorldObject[]): WorldObject[] {
		out.length = 0
		for (const s of this.ground.cellsIn(x0, z0, x1, z1, this.cellScratch)) {
			for (const id of s) {
				const o = this.objects.get(id)
				if (o && o.parent === undefined && o.x >= x0 && o.x <= x1 && o.z >= z0 && o.z <= z1) out.push(o)
			}
		}
		this.cellScratch.length = 0
		return out
	}

	/** Fills `out` with the attached objects (those with a parent), which `rootsNear` leaves out: place them by `worldPosition`. */
	attachedObjects(out: WorldObject[]): WorldObject[] {
		out.length = 0
		for (const id of this.filedParent.keys()) {
			const o = this.objects.get(id)
			if (o && o.parent !== undefined) out.push(o)
		}
		return out
	}

	/** Files an object under its selection group in `groupIds`, moving it from the one it was filed under. */
	private fileGroup(o: WorldObject) {
		const was = this.filedGroup.get(o.id)
		if (was === o.group) return
		if (was !== undefined) this.unfileGroup(o.id)
		if (!o.group) return
		let ms = this.groupIds.get(o.group)
		if (!ms) this.groupIds.set(o.group, (ms = new Set()))
		ms.add(o.id)
		this.filedGroup.set(o.id, o.group)
	}

	private unfileGroup(id: number) {
		const was = this.filedGroup.get(id)
		if (was === undefined) return
		this.filedGroup.delete(id)
		const ms = this.groupIds.get(was)
		ms?.delete(id)
		if (ms && !ms.size) this.groupIds.delete(was)
	}

	/** Puts an object into selection group `g`, or takes it out of its group when `g` is undefined or 0. */
	setGroup(id: number, g: number | undefined) {
		const o = this.objects.get(id)
		if (!o) return
		if (g) {
			o.group = g
			this.nextGroup = Math.max(this.nextGroup, g + 1)
		} else delete o.group
		this.fileGroup(o)
	}

	/** The ids in selection group `g`, read from `groupIds`; empty for no group. Don't change the set. */
	groupMembers(g: number): ReadonlySet<number> {
		return this.groupIds.get(g) ?? NO_IDS
	}

	private unfile(id: number) {
		const was = this.filedParent.get(id)
		if (was === undefined) return
		this.filedParent.delete(id)
		const ks = this.kids.get(was)
		ks?.delete(id)
		if (ks && !ks.size) this.kids.delete(was)
	}

	/**
	 * Changes an object's model, keeping its id, placement and attachments: it leaves its old type's
	 * instanced mesh for the new one's.
	 */
	setType(id: number, type: string) {
		const o = this.objects.get(id)
		if (!o || o.type === type) return
		this.leaveBatch(o)
		o.type = type
		this.joinBatch(o)
		this.fileGround(o)
		this.markTree(o, 0)
		this.version++
		this.shapeVersion++
	}

	/** Call after mutating an object's fields. Attached children follow. */
	touch(id: number) {
		const o = this.objects.get(id)
		if (o) {
			// The fields may have been written over from a snapshot (undo): its parent, or its type.
			this.file(o)
			if (!this.batch(o.type).members.has(o.id)) {
				for (const b of this.batches.values()) if (b.members.delete(o.id)) b.dirty = true
				this.joinBatch(o)
				this.shapeVersion++
			}
			this.markTree(o, 0)
		}
		this.version++
	}

	/**
	 * Marks an object and everything attached to it (recursively) as moved: `update` recomputes their
	 * matrices only, unless their batch is rebuilt anyway (#510).
	 */
	private markTree(o: WorldObject, depth: number) {
		const b = this.batch(o.type)
		if (!b.dirty) b.moved.add(o.id)
		if (this.moveLog.length >= MOVE_LOG) {
			this.moveBase += this.moveLog.length
			this.moveLog.length = 0
		}
		this.moveLog.push(o.id)
		if (depth >= MAX_DEPTH) return
		const ks = this.kids.get(o.id)
		if (!ks) return
		for (const id of ks) {
			const c = this.objects.get(id)
			if (c && c.parent === o.id) this.markTree(c, depth + 1)
		}
	}

	/** The objects attached to `id` (its children, not theirs), read from `kids`. */
	childrenOf(id: number): WorldObject[] {
		const out: WorldObject[] = []
		const ks = this.kids.get(id)
		if (!ks) return out
		for (const k of ks) {
			const c = this.objects.get(k)
			if (c && c.parent === id) out.push(c)
		}
		return out
	}

	/** A selection group number no object has yet. */
	newGroup(): number {
		return this.nextGroup++
	}

	/** The object plus everything attached to it, recursively. */
	descendantIds(id: number): Set<number> {
		return this.descendantsOf([id])
	}

	/**
	 * The objects plus everything attached to any of them, recursively, added to `out` (a new set
	 * when not given; ids already in it are walked too). A breadth-first walk over `kids` (#512): a
	 * Set iterates what is added during the loop, so `out` is its own queue. A child filed under an
	 * id whose `parent` no longer names it (written over from a snapshot, not yet touched) is skipped.
	 */
	descendantsOf(ids: Iterable<number>, out = new Set<number>()): Set<number> {
		if (ids !== out) for (const id of ids) out.add(id)
		for (const id of out) {
			const ks = this.kids.get(id)
			if (!ks) continue
			for (const k of ks) {
				if (out.has(k)) continue
				const c = this.objects.get(k)
				if (c && c.parent === id) out.add(k)
			}
		}
		return out
	}

	/** Whether `o` is the object `id` or hangs on it, through any number of parents. */
	hangsOn(o: WorldObject, id: number): boolean {
		let p: WorldObject | undefined = o
		// The step bound only guards against a cycle in a broken file.
		for (let n = 0; p && n <= this.objects.size; n++) {
			if (p.id === id) return true
			p = p.parent !== undefined ? this.objects.get(p.parent) : undefined
		}
		return false
	}

	/** Ancestors of an object (its parent chain). */
	ancestorIds(o: WorldObject): Set<number> {
		const out = new Set<number>()
		let p = o.parent !== undefined ? this.objects.get(o.parent) : undefined
		while (p && out.size < MAX_DEPTH && !out.has(p.id)) {
			out.add(p.id)
			p = p.parent !== undefined ? this.objects.get(p.parent) : undefined
		}
		return out
	}

	/** View › Layers › Doodads and Buildings off (#43): every m2: or wmo: object is left out. */
	private hideDoodads = false
	private hideBuildings = false

	/** Shows or hides the doodads (m2:) and buildings (wmo:) as a kind; returns true when it changed. */
	setKindsShown(doodads: boolean, buildings: boolean): boolean {
		if (this.hideDoodads === !doodads && this.hideBuildings === !buildings) return false
		this.hideDoodads = !doodads
		this.hideBuildings = !buildings
		this.markAllDirty()
		return true
	}

	/** Whether View hides every object of `type`'s kind. */
	kindHidden(type: string): boolean {
		return (this.hideDoodads && type.startsWith('m2:')) || (this.hideBuildings && type.startsWith('wmo:'))
	}

	/** Whether an object is left out of drawing and picking. */
	isHidden(id: number): boolean {
		if (this.hideDoodads || this.hideBuildings) {
			const o = this.objects.get(id)
			if (o && this.kindHidden(o.type)) return true
		}
		return !this.showHidden && this.hidden.has(id)
	}

	/**
	 * Whether a tool may pick, select or remove an object: it is drawn, and so is the layer (View ›
	 * Layers › Objects). What View hides is click-through (#135).
	 */
	pickable(id: number): boolean {
		return this.group.visible && !this.isHidden(id)
	}

	setHidden(id: number, hide: boolean) {
		const o = this.objects.get(id)
		if (!o || this.hidden.has(id) === hide) return
		if (hide) this.hidden.add(id)
		else this.hidden.delete(id)
		this.batch(o.type).dirty = true
		this.version++
		this.shapeVersion++
	}

	clearHidden() {
		if (!this.hidden.size) return
		this.hidden.clear()
		this.markAllDirty()
	}

	/** Returns true when the setting changed. */
	setShowHidden(show: boolean): boolean {
		if (this.showHidden === show) return false
		this.showHidden = show
		if (this.hidden.size) this.markAllDirty()
		return true
	}

	clear() {
		this.objects.clear()
		this.hidden.clear()
		for (const b of this.batches.values()) b.members.clear()
		this.kids.clear()
		this.filedParent.clear()
		this.groupIds.clear()
		this.filedGroup.clear()
		this.ground.clear()
		this.wide.clear()
		this.markAllDirty()
	}

	markAllDirty() {
		for (const b of this.batches.values()) b.dirty = true
		this.version++
		this.shapeVersion++
	}

	/** Re-snap ground objects within a world-space rect after terrain edits (children follow). */
	markRegionDirty(x0: number, z0: number, x1: number, z1: number) {
		for (const o of this.rootsIn(x0, z0, x1, z1, this.regionScratch)) {
			this.markTree(o, 0)
			this.version++
		}
		this.regionScratch.length = 0
	}

	private parentOf(o: WorldObject, depth: number): WorldObject | undefined {
		if (o.parent === undefined || depth >= MAX_DEPTH) return undefined
		const p = this.objects.get(o.parent)
		return p && p.id !== o.id ? p : undefined
	}

	private matrixAt(o: WorldObject, out: THREE.Matrix4, depth: number): THREE.Matrix4 {
		// Tilt and roll are applied in the model's own frame, then the turn about the world up, as the client does.
		// The scratch is used up by `compose` before the recursion reuses it.
		mQuat.setFromEuler(placementEuler(mEuler, o.rotY, o.tiltX, o.tiltZ))
		mScale.setScalar(o.scale)
		const parent = this.parentOf(o, depth)
		if (!parent) return out.compose(mPos.set(o.x, this.terrain.heightAt(o.x, o.z) + o.yOff, o.z), mQuat, mScale)
		out.compose(mPos.set(o.x, o.yOff, o.z), mQuat, mScale)
		return out.premultiply(this.matrixAt(parent, parentM[depth + 1], depth + 1))
	}

	/** World transform of an object (follows its parent chain). */
	matrixOf(o: WorldObject, out: THREE.Matrix4) {
		return this.matrixAt(o, out, 0)
	}

	worldPosition(o: WorldObject, out: THREE.Vector3) {
		return out.setFromMatrixPosition(this.matrixAt(o, this.tmpM2, 0))
	}

	/** World-space yaw and uniform scale (accumulated through parents). */
	worldPlacement(o: WorldObject): WorldPlacement {
		let rot = o.rotY
		let scale = o.scale
		let p = this.parentOf(o, 0)
		for (let d = 1; p && d <= MAX_DEPTH; d++) {
			rot += p.rotY
			scale *= p.scale
			p = this.parentOf(p, d)
		}
		return { pos: this.worldPosition(o, new THREE.Vector3()), rot, scale }
	}

	/**
	 * Re-home an object: attach it to `parentId` (or the ground when null)
	 * while keeping the given world placement. Mutates the object in place.
	 */
	place(o: WorldObject, parentId: number | null, w: WorldPlacement) {
		const parent = parentId !== null ? this.objects.get(parentId) : undefined
		// Not onto itself or onto anything that hangs on it: walk the parent's chain, not o's whole tree.
		if (parent && !this.hangsOn(parent, o.id)) {
			const pw = this.worldPlacement(parent)
			const inv = this.matrixOf(parent, new THREE.Matrix4()).invert()
			const local = w.pos.clone().applyMatrix4(inv)
			o.parent = parent.id
			o.x = local.x
			o.yOff = local.y
			o.z = local.z
			o.rotY = w.rot - pw.rot
			o.scale = w.scale / pw.scale
		} else {
			delete o.parent
			o.x = w.pos.x
			o.z = w.pos.z
			o.yOff = w.pos.y - this.terrain.heightAt(w.pos.x, w.pos.z)
			o.rotY = w.rot
			o.scale = w.scale
		}
		this.touch(o.id)
	}

	private batch(type: string): Batch {
		let b = this.batches.get(type)
		if (!b) {
			const a = getAsset(type)
			const ids: number[] = []
			const lodIds: number[] = []
			const liquidIds: number[] = []
			const cull = a.skeleton ? null : WmoGroupCull.of(a.geometry)
			b = {
				rows: new InstanceBatch<number>(),
				mesh: this.makeMesh(type, a.geometry, 64, ids, cull),
				ids,
				cull,
				lod: a.lod ? this.makeMesh(type, a.lod, 64, lodIds, null, a.lodMaterial) : null,
				lodIds,
				liquid: a.liquid ? this.makeLiquidMesh(type, a.liquid, 64, liquidIds) : null,
				liquidIds,
				near: [],
				far: [],
				nearFar: { near: 0, far: 0 },
				scratchNear: [],
				scratchFar: [],
				dirty: true,
				members: new Set(),
				index: new Map(),
				moved: new Set(),
				movedIdx: [],
			}
			this.batches.set(type, b)
			this.group.add(b.mesh)
			if (b.lod) this.group.add(b.lod)
			if (b.liquid) this.group.add(b.liquid)
		}
		return b
	}

	/** Replaces a batch's meshes, for a model that loaded or more instances than they hold. */
	private setMeshes(b: Batch, type: string, capacity: number) {
		for (const m of [b.mesh, b.lod, b.liquid]) {
			if (!m) continue
			this.group.remove(m)
			m.dispose()
		}
		const a = getAsset(type)
		b.cull = a.skeleton ? null : WmoGroupCull.of(a.geometry)
		b.mesh = this.makeMesh(type, a.geometry, capacity, b.ids, b.cull)
		b.lod = a.lod ? this.makeMesh(type, a.lod, capacity, b.lodIds, null, a.lodMaterial) : null
		b.liquid = a.liquid ? this.makeLiquidMesh(type, a.liquid, capacity, b.liquidIds) : null
		this.group.add(b.mesh)
		if (b.lod) this.group.add(b.lod)
		if (b.liquid) this.group.add(b.liquid)
	}

	/** A WMO's liquids for `capacity` instances: drawn after the models, like the map's liquids. */
	private makeLiquidMesh(type: string, geometry: THREE.BufferGeometry, capacity: number, ids: number[]) {
		for (const k of (geometry.userData.liquidKinds ?? []) as LiquidClass[]) wantLiquid(k)
		const m = new THREE.InstancedMesh(geometry, wmoLiquidMaterial(), capacity)
		watchUploads(m.instanceMatrix)
		m.count = 0
		m.visible = false
		m.userData.type = type
		m.userData.ids = ids
		m.renderOrder = 10
		m.name = 'wmo-liquid'
		return m
	}

	/** `ids` names the object drawn by each instance, as `cull` packs them; `material` is the model's unless given (a far WMO's LOD). */
	private makeMesh(type: string, geometry: THREE.BufferGeometry, capacity: number, ids: number[], cull: WmoGroupCull | null = null, material?: THREE.Material[]) {
		const a = getAsset(type)
		// Shown by `pack` once it holds an instance.
		const m = instancedMesh(a.skeleton ? geometry : (cull?.geometry ?? geometry), material ?? a.material, capacity, a.skeleton, ids)
		m.userData.type = type
		// A far WMO's merged classes sample their textures from the layer array, its shadow too (#691).
		if (geometry.userData.farLayers) m.customDepthMaterial = farDepthMaterial()
		if (cull) {
			// The scene pass and the near shadow cascade draw only the groups in their frustums; the far
			// cascade and the point lights keep the whole model. A shadow pass is told apart by its own camera.
			// The shadow hooks also keep `cullForShadows`' own, which draw every instance packed in a shadow pass.
			const before = m.onBeforeShadow
			const after = m.onAfterShadow
			m.onBeforeRender = (_r, _s, camera, _g, _m, group) => cull.before(camera, group as unknown as THREE.GeometryGroup | null)
			m.onAfterRender = (_r, _s, camera, _g, _m, group) => cull.after(camera, group as unknown as THREE.GeometryGroup | null)
			m.onBeforeShadow = (r, s, c, shadowCamera, g, dm, group) => {
				before.call(m, r, s, c, shadowCamera, g, dm, group)
				cull.before(shadowCamera, group as unknown as THREE.GeometryGroup | null)
			}
			m.onAfterShadow = (r, s, c, shadowCamera, g, dm, group) => {
				cull.after(shadowCamera, group as unknown as THREE.GeometryGroup | null)
				after.call(m, r, s, c, shadowCamera, g, dm, group)
			}
		}
		// A model with nothing to draw in the game (a collision blocker) shows as a marker with no shadow.
		m.castShadow = !a.marker
		m.receiveShadow = true
		return m
	}

	/** Adds every model type this layer holds or has a batch for to `into` (#505: what a closed map lets go of). */
	modelTypes(into: Set<string>): Set<string> {
		for (const t of this.batches.keys()) into.add(t)
		for (const o of this.objects.values()) into.add(o.type)
		return into
	}

	/**
	 * Takes away the batches of the types no object has any more, with their instanced meshes, and adds
	 * those types to `into` (#15: a world view lets go of the models of the tiles it dropped, which
	 * `modelTypes` would otherwise name for as long as their empty batch stays). A region keeps its empty
	 * batches, so a model deleted and undone back is not set up again, and its type is let go of with
	 * the closed map.
	 */
	dropEmptyBatches(into: Set<string>): Set<string> {
		for (const [type, b] of this.batches) {
			if (b.members.size) continue
			for (const m of [b.mesh, b.lod, b.liquid]) {
				if (!m) continue
				this.group.remove(m)
				m.dispose()
			}
			this.batches.delete(type)
			into.add(type)
		}
		return into
	}

	/** Whether any object of `type` is drawn: not hidden, and in view or a shadow's box as of the last cull. */
	hasVisible(type: string): boolean {
		const b = this.batches.get(type)
		return !!b && (packedCount(b.mesh) > 0 || (b.lod ? packedCount(b.lod) : 0) > 0)
	}

	/** What each model type drew in the last cull, full meshes and LODs, and how many instanced meshes there are (#179). */
	drawnCosts(out: ModelCost[]): number {
		let meshes = 0
		for (const [type, b] of this.batches) {
			meshes += 1 + (b.lod ? 1 : 0) + (b.liquid ? 1 : 0)
			out.push({ type, triangles: meshTriangles(b.mesh), instances: b.mesh.visible ? b.mesh.count : 0 })
			if (b.lod) out.push({ type, triangles: meshTriangles(b.lod), instances: b.lod.visible ? b.lod.count : 0 })
			if (b.liquid) out.push({ type, triangles: meshTriangles(b.liquid), instances: wmoLiquidMaterial().visible ? b.liquid.count : 0 })
		}
		return meshes
	}

	/**
	 * Recomputes the matrices and bounds of the dirty batches' objects. Call once per frame, before
	 * `cull`, which packs the ones in view into the instance buffers.
	 */
	update() {
		for (const [type, b] of this.batches) {
			if (!b.dirty) {
				if (b.moved.size) this.updateMoved(b)
				continue
			}
			b.dirty = false
			b.moved.clear()
			b.movedIdx.length = 0
			const rows = b.rows
			const all = rows.items
			all.length = 0
			b.index.clear()
			for (const id of b.members) {
				if (this.isHidden(id)) continue
				b.index.set(id, all.length)
				all.push(id)
			}
			const n = all.length
			if (n > b.mesh.instanceMatrix.count) {
				let cap = b.mesh.instanceMatrix.count
				while (cap < n) cap *= 2
				this.setMeshes(b, type, cap)
			}
			if (rows.matrices.length < n * 16) rows.reserve(b.mesh.instanceMatrix.count)
			const geometry = b.mesh.geometry
			for (let i = 0; i < n; i++) rows.setRow(i, this.matrixOf(this.objects.get(all[i])!, this.tmpM), geometry)
			// Whatever was packed no longer matches; the next cull repacks it.
			rows.repack = true
		}
	}

	/** Recomputes the rows of a batch's moved objects only, and notes them for `cull` (#510). */
	private updateMoved(b: Batch) {
		const geometry = b.mesh.geometry
		for (const id of b.moved) {
			const i = b.index.get(id)
			const o = this.objects.get(id)
			// A hidden object has no row.
			if (i === undefined || !o) continue
			b.rows.setRow(i, this.matrixOf(o, this.tmpM), geometry)
			b.movedIdx.push(i)
		}
		b.moved.clear()
	}

	/**
	 * Draws only the instances in `view`: they are packed to the front of each batch's instance buffer,
	 * so a type with nothing in view costs no draw calls. Instances small on screen go to the LOD mesh.
	 * The M2 types are the doodads, which the view's `doodadReach` cuts by distance.
	 * Call once per frame, after `update`.
	 */
	cull(view: CullView) {
		for (const [type, b] of this.batches) {
			const rows = b.rows
			const exempt = view.gate && view.gateExempt !== undefined ? (b.index.get(view.gateExempt) ?? -1) : -1
			const changed = rows.cull(view, exempt, type.startsWith('m2:'))
			// Rows moved since the last cull, in a packing that is otherwise the same, are written in place.
			const moved = b.movedIdx
			if (b.liquid) {
				// A WMO's liquids show only in view: they cast no shadow.
				if (changed) {
					rows.pack(b.liquid, b.liquidIds)
					b.liquid.visible = b.liquid.count > 0
				} else if (moved.length) rows.patch(b.liquid, moved)
			}
			if (!b.lod) {
				if (changed) rows.pack(b.mesh, b.ids)
				else if (moved.length) rows.patch(b.mesh, moved)
			} else if (splitLod(view, rows.spheres, rows.packed, b.near, b.far, b.scratchNear, b.scratchFar, rows.split.view, b.nearFar) || changed) {
				// The split changes as the camera moves, even when the instances in view don't.
				rows.pack(b.mesh, b.ids, b.near, b.nearFar.near)
				rows.pack(b.lod, b.lodIds, b.far, b.nearFar.far)
			} else if (moved.length) {
				rows.patch(b.mesh, moved, b.near, b.nearFar.near)
				rows.patch(b.lod, moved, b.far, b.nearFar.far)
			}
			moved.length = 0
		}
		// A big WMO drawn once is culled by group, every frame, as its groups' view changes with the camera.
		for (const b of this.batches.values()) {
			if (!b.cull) continue
			const one = WmoGroupCull.enabled && packedCount(b.mesh) === 1 && view.camera && b.mesh.visible
			b.cull.update(one ? view.camera! : null, view.frustums[0], b.mesh.instanceMatrix.array, view.shadowCamera ?? null, view.shadowFrustum ?? null)
		}
	}

	/** Hits on the drawn instances, nearest first: one per instance, from its model's bounds tree. */
	private intersect(raycaster: THREE.Raycaster, wmoOnly = false): THREE.Intersection[] {
		// A hidden layer is click-through, and blocks no sight line either.
		if (!this.group.visible) return []
		const meshes: THREE.Object3D[] = []
		for (const [type, b] of this.batches) {
			if (wmoOnly && !type.startsWith('wmo:')) continue
			if (b.mesh.count > 0) meshes.push(b.mesh)
			// A LOD shares its model's bounds tree, so it picks the full model.
			if (b.lod && b.lod.count > 0) meshes.push(b.lod)
		}
		const first = raycaster.firstHitOnly
		raycaster.firstHitOnly = true
		try {
			return raycaster.intersectObjects(meshes, false)
		} finally {
			raycaster.firstHitOnly = first
		}
	}

	private amongInv = new THREE.Matrix4()
	private amongM = new THREE.Matrix4()
	private amongRay = new THREE.Ray()
	private amongPoint = new THREE.Vector3()
	private amongHit = { id: 0, point: new THREE.Vector3(), distance: 0 }

	/**
	 * The nearest surface under the ray among the first `count` of `ids` (skipping `exclude`), each
	 * tested through its own model's bounds tree: for a ray only a few nearby models can meet, far
	 * cheaper than raycastSurface, which walks every instance of every model. The result (and its
	 * point) is reused by the next call.
	 */
	raycastAmong(ray: THREE.Ray, ids: ArrayLike<number>, count: number, exclude?: Set<number>): { id: number; point: THREE.Vector3; distance: number } | null {
		let best = Infinity
		for (let i = 0; i < count; i++) {
			const id = ids[i]
			if (exclude?.has(id) || !this.pickable(id)) continue
			const o = this.objects.get(id)
			if (!o) continue
			const asset = getAsset(o.type)
			const tree = asset.ready ? (asset.geometry.boundsTree as MeshBVH | undefined) : undefined
			if (!tree) continue
			this.matrixOf(o, this.amongM)
			const local = this.amongRay.copy(ray).applyMatrix4(this.amongInv.copy(this.amongM).invert())
			if (!local.intersectsBox(asset.bbox)) continue
			const hit = tree.raycastFirst(local, THREE.DoubleSide)
			if (!hit) continue
			const p = this.amongPoint.copy(hit.point).applyMatrix4(this.amongM)
			const d = p.distanceTo(ray.origin)
			if (d >= best) continue
			best = d
			this.amongHit.id = id
			this.amongHit.point.copy(p)
			this.amongHit.distance = d
		}
		return best < Infinity ? this.amongHit : null
	}

	/**
	 * The first surface of model `id` along `ray`, and whether the ray meets it from behind (its face
	 * points along the ray), as it does from inside a closed mesh; null for a miss or a model still
	 * loading. The sign is the same in the model's space as in the world's, so it is taken there.
	 */
	raycastModel(ray: THREE.Ray, id: number): { distance: number; back: boolean } | null {
		const o = this.objects.get(id)
		if (!o) return null
		const asset = getAsset(o.type)
		const tree = asset.ready ? (asset.geometry.boundsTree as MeshBVH | undefined) : undefined
		if (!tree) return null
		this.matrixOf(o, this.amongM)
		const local = this.amongRay.copy(ray).applyMatrix4(this.amongInv.copy(this.amongM).invert())
		const hit = tree.raycastFirst(local, THREE.DoubleSide)
		if (!hit?.face) return null
		const p = this.amongPoint.copy(hit.point).applyMatrix4(this.amongM)
		return { distance: p.distanceTo(ray.origin), back: hit.face.normal.dot(local.direction) > 0 }
	}

	private surfM = new THREE.Matrix4()
	private surfInv = new THREE.Matrix4()
	private surfRay = new THREE.Ray()
	private surfN = new THREE.Vector3()
	private surfP = new THREE.Vector3()

	/**
	 * The world box of model `id` (its bounds turned and scaled as placed), or null while it loads.
	 * Readies `surfaceAt` for that model.
	 */
	surfaceBox(id: number, out: THREE.Box3): THREE.Box3 | null {
		const o = this.objects.get(id)
		if (!o) return null
		const asset = getAsset(o.type)
		if (!asset.ready || !asset.geometry.boundsTree) return null
		this.matrixOf(o, this.surfM)
		this.surfInv.copy(this.surfM).invert()
		return out.copy(asset.bbox).applyMatrix4(this.surfM)
	}

	/**
	 * The height of model `id`'s surface over (x, z), along a vertical line through it (Fit ground to a
	 * model, #168): with `floor`, its lowest face that looks up, which a floor is (a foundation's
	 * underside looks down) between `lo` and `hi`; else its lowest face of any kind, its underside. NaN
	 * where it has none. Call `surfaceBox` for the model first.
	 */
	surfaceAt(id: number, x: number, z: number, floor: boolean, bottom: number, lo = -Infinity, hi = Infinity): number {
		const o = this.objects.get(id)
		const tree = o ? (getAsset(o.type).geometry.boundsTree as MeshBVH | undefined) : undefined
		if (!tree) return NaN
		this.surfRay.origin.set(x, bottom, z)
		this.surfRay.direction.set(0, 1, 0)
		this.surfRay.applyMatrix4(this.surfInv)
		let best = NaN
		for (const hit of tree.raycast(this.surfRay, THREE.DoubleSide)) {
			if (floor) {
				if (!hit.face) continue
				if (this.surfN.copy(hit.face.normal).transformDirection(this.surfM).y < 0.5) continue
			}
			const y = this.surfP.copy(hit.point).applyMatrix4(this.surfM).y
			if (y < lo || y > hi) continue
			if (Number.isNaN(best) || y < best) best = y
		}
		return best
	}

	/** World yaw, accumulated through the parents, without allocating. */
	worldYaw(o: WorldObject): number {
		let rot = o.rotY
		let p = this.parentOf(o, 0)
		for (let d = 1; p && d <= MAX_DEPTH; d++) {
			rot += p.rotY
			p = this.parentOf(p, d)
		}
		return rot
	}

	/** World uniform scale, accumulated through the parents, without allocating. */
	worldScale(o: WorldObject): number {
		let scale = o.scale
		let p = this.parentOf(o, 0)
		for (let d = 1; p && d <= MAX_DEPTH; d++) {
			scale *= p.scale
			p = this.parentOf(p, d)
		}
		return scale
	}

	/** Nearest object surface under the ray, skipping `exclude` ids. */
	raycastSurface(raycaster: THREE.Raycaster, exclude?: Set<number>): { id: number; point: THREE.Vector3; distance: number } | null {
		const hits = this.intersect(raycaster)
		for (const h of hits) {
			const id = hitId(h)
			if (id === undefined || exclude?.has(id)) continue
			// An object removed since the last pack (an undone placement) is still in its batch until update.
			const o = this.objects.get(id)
			if (!o || !getAsset(o.type).ready) continue
			return { id, point: h.point.clone(), distance: h.distance }
		}
		return null
	}

	private floorM = new THREE.Matrix4()
	private floorN = new THREE.Matrix3()
	private floorNormal = new THREE.Vector3()

	/**
	 * The nearest object surface under the ray that faces up enough to stand on (#660), skipping
	 * ceilings and walls, and `exclude` ids: a cave's or a dungeon's floor seen past its roof. Every
	 * hit of every model along the ray is tested, not just each model's first, since a building's
	 * own ceiling comes before its floor.
	 */
	raycastFloor(raycaster: THREE.Raycaster, exclude?: Set<number>): { id: number; point: THREE.Vector3; distance: number } | null {
		if (!this.group.visible) return null
		const meshes: THREE.Object3D[] = []
		for (const b of this.batches.values()) {
			if (b.mesh.count > 0) meshes.push(b.mesh)
			if (b.lod && b.lod.count > 0) meshes.push(b.lod)
		}
		const first = raycaster.firstHitOnly
		raycaster.firstHitOnly = false
		let hits: THREE.Intersection[]
		try {
			hits = raycaster.intersectObjects(meshes, false)
		} finally {
			raycaster.firstHitOnly = first
		}
		for (const h of hits) {
			const id = hitId(h)
			if (id === undefined || exclude?.has(id) || !h.face) continue
			const o = this.objects.get(id)
			if (!o || !getAsset(o.type).ready) continue
			const mesh = h.object as THREE.InstancedMesh
			mesh.getMatrixAt(h.instanceId!, this.floorM)
			this.floorM.premultiply(mesh.matrixWorld)
			const n = this.floorNormal.copy(h.face.normal).applyMatrix3(this.floorN.getNormalMatrix(this.floorM)).normalize()
			if (n.y < FLOOR_MIN_UP) continue
			return { id, point: h.point.clone(), distance: h.distance }
		}
		return null
	}

	/**
	 * Whether a drawn building (WMO) meets the ray within its `far`: a sight-line test, cheap since a
	 * map has few buildings beside its many doodads.
	 */
	wmoBlocks(raycaster: THREE.Raycaster): boolean {
		for (const h of this.intersect(raycaster, true)) if (hitId(h) !== undefined) return true
		return false
	}

	/** Returns the id of the object under the ray, or null. */
	pick(raycaster: THREE.Raycaster): number | null {
		return this.pickHit(raycaster)?.id ?? null
	}

	/** The object under the ray and how far along the ray it was hit, or null. */
	pickHit(raycaster: THREE.Raycaster): { id: number; distance: number } | null {
		return firstPick(this.intersect(raycaster))
	}

	list(): WorldObject[] {
		return [...this.objects.values()]
	}

	dispose() {
		this.unsubscribe()
		for (const b of this.batches.values()) {
			b.mesh.dispose()
			b.lod?.dispose()
			b.liquid?.dispose()
		}
		this.batches.clear()
		this.group.clear()
	}
}
