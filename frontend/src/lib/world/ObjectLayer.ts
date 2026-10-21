import * as THREE from 'three'
import { placementEuler } from './placement'
import type { MeshBVH } from 'three-mesh-bvh'
import { getAsset, onAssetLoaded } from '../models/assets'
import type { Terrain } from '../terrain/Terrain'
import { SkinnedInstancedMesh } from './Animator'
import { cullSpheres, instanceSphere, packMatrices, splitLod, type CullView } from './instanceCull'
import { cullForShadows } from './shadowReach'
import { WmoGroupCull } from './wmoGroupCull'
import { meshTriangles, type ModelCost } from '../engine/perfMeter'
import { wantLiquid, wmoLiquidMaterial } from '../water/liquidMaterial'
import type { LiquidClass } from '../water/liquids'

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

interface Batch {
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
  /** Indices into `all` of the instances drawn in full and with the LOD. */
  near: number[]
  far: number[]
  /** Every object of the type that is not hidden, with its world matrix and bounding sphere. */
  all: number[]
  matrices: Float32Array
  spheres: Float32Array
  /** Indices into `all` of the instances drawn, and scratch for the next frame's. */
  packed: number[]
  scratch: number[]
  scratchFar: number[]
  dirty: boolean
	/** The ids of every object of the type, hidden or not, so `update` reads only its own (#329). */
	members: Set<number>
	/** Each id's index in `all`, as of the last rebuild. */
	index: Map<number, number>
	/**
	 * The ids moved since the last `update` while the batch was not dirty (#510): `update` recomputes
	 * only their rows, and the next `cull` writes them into the instance buffers that draw them.
	 */
	moved: Set<number>
	/** The indices into `all` whose rows `update` recomputed, for the next `cull`. */
	movedIdx: number[]
}

/** With more moved rows than this, a mesh uploads its whole instance buffer rather than a range a row. */
const RANGES_MAX = 32

/** The instance buffers `pack` rewrote that three has not uploaded yet: a range upload would cut that short. */
const wholePending = new WeakSet<THREE.InstancedBufferAttribute>()

/** The position of `v` in the ascending `sorted`, or -1. */
function indexIn(sorted: number[], v: number): number {
	let lo = 0
	let hi = sorted.length - 1
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		const x = sorted[mid]
		if (x === v) return mid
		if (x < v) lo = mid + 1
		else hi = mid - 1
	}
	return -1
}

/** Sets up an instance buffer for rewrites every frame, and clears its pending whole upload once three has made it. */
function watchUploads(attr: THREE.InstancedBufferAttribute) {
	attr.setUsage(THREE.DynamicDrawUsage)
	attr.onUpload(() => wholePending.delete(attr))
}

// Scratch for `patch`.
const patchM = new THREE.Matrix4()
const patchS = new Float32Array(4)
const patchSphere = new THREE.Sphere()

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

	/** Files an object under its parent in `kids`, moving it from the one it was filed under. */
	private file(o: WorldObject) {
		const was = this.filedParent.get(o.id)
		if (was === o.parent) return
		if (was !== undefined) this.unfile(o.id)
		if (o.parent === undefined) return
		let ks = this.kids.get(o.parent)
		if (!ks) this.kids.set(o.parent, (ks = new Set()))
		ks.add(o.id)
		this.filedParent.set(o.id, o.parent)
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
	private hangsOn(o: WorldObject, id: number): boolean {
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
    this.markAllDirty()
  }

  markAllDirty() {
    for (const b of this.batches.values()) b.dirty = true
    this.version++
    this.shapeVersion++
  }

  /** Re-snap ground objects within a world-space rect after terrain edits (children follow). */
  markRegionDirty(x0: number, z0: number, x1: number, z1: number) {
    for (const o of this.objects.values()) {
      if (o.parent === undefined && o.x >= x0 && o.x <= x1 && o.z >= z0 && o.z <= z1) {
        this.markTree(o, 0)
        this.version++
      }
    }
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
        mesh: this.makeMesh(type, a.geometry, 64, ids, cull),
        ids,
        cull,
        lod: a.lod ? this.makeMesh(type, a.lod, 64, lodIds) : null,
        lodIds,
        liquid: a.liquid ? this.makeLiquidMesh(type, a.liquid, 64, liquidIds) : null,
        liquidIds,
        near: [],
        far: [],
        all: [],
        matrices: new Float32Array(0),
        spheres: new Float32Array(0),
        packed: [],
        scratch: [],
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
    b.lod = a.lod ? this.makeMesh(type, a.lod, capacity, b.lodIds) : null
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

  /** `ids` names the object drawn by each instance, as `cull` packs them. */
  private makeMesh(type: string, geometry: THREE.BufferGeometry, capacity: number, ids: number[], cull: WmoGroupCull | null = null) {
    const a = getAsset(type)
    const m = a.skeleton ? new SkinnedInstancedMesh(geometry, a.material, capacity, a.skeleton) : new THREE.InstancedMesh(cull?.geometry ?? geometry, a.material, capacity)
    if (cull) {
      // The scene pass and the near shadow cascade draw only the groups in their frustums; the far
      // cascade and the point lights keep the whole model. A shadow pass is told apart by its own camera.
      m.onBeforeRender = (_r, _s, camera, _g, _m, group) => cull.before(camera, group as unknown as THREE.GeometryGroup | null)
      m.onAfterRender = (_r, _s, camera, _g, _m, group) => cull.after(camera, group as unknown as THREE.GeometryGroup | null)
      m.onBeforeShadow = (_r, _s, _c, shadowCamera, _g, _m, group) => cull.before(shadowCamera, group as unknown as THREE.GeometryGroup | null)
      m.onAfterShadow = (_r, _s, _c, shadowCamera, _g, _m, group) => cull.after(shadowCamera, group as unknown as THREE.GeometryGroup | null)
    }
    watchUploads(m.instanceMatrix)
    m.count = 0
    // Shown by `pack` once it holds an instance.
    m.visible = false
    m.userData.type = type
    m.userData.ids = ids
    // Our own cull packs what is in view; three only culls it per point-light shadow face.
    cullForShadows(m)
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

  /** Whether any object of `type` is drawn: not hidden, and in view as of the last cull. */
  hasVisible(type: string): boolean {
    const b = this.batches.get(type)
    return !!b && (b.mesh.count > 0 || (b.lod?.count ?? 0) > 0)
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
      b.all.length = 0
			b.index.clear()
			for (const id of b.members) {
				if (this.isHidden(id)) continue
				b.index.set(id, b.all.length)
				b.all.push(id)
			}
      const n = b.all.length
      if (n > b.mesh.instanceMatrix.count) {
        let cap = b.mesh.instanceMatrix.count
        while (cap < n) cap *= 2
        this.setMeshes(b, type, cap)
      }
      if (b.matrices.length < n * 16) {
        b.matrices = new Float32Array(b.mesh.instanceMatrix.count * 16)
        b.spheres = new Float32Array(b.mesh.instanceMatrix.count * 4)
      }
      const geometry = b.mesh.geometry
      for (let i = 0; i < n; i++) {
        this.matrixOf(this.objects.get(b.all[i])!, this.tmpM)
        this.tmpM.toArray(b.matrices, i * 16)
        instanceSphere(geometry, this.tmpM, b.spheres, i * 4)
      }
      // Whatever was packed no longer matches; the next cull repacks it.
      b.packed.length = 0
      b.packed.push(-1)
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
			this.matrixOf(o, this.tmpM)
			this.tmpM.toArray(b.matrices, i * 16)
			instanceSphere(geometry, this.tmpM, b.spheres, i * 4)
			b.movedIdx.push(i)
		}
		b.moved.clear()
	}

  /**
   * Draws only the instances in `view`: they are packed to the front of each batch's instance buffer,
   * so a type with nothing in view costs no draw calls. Instances small on screen go to the LOD mesh.
   * Call once per frame, after `update`.
   */
  cull(view: CullView) {
    for (const b of this.batches.values()) {
      const exempt = view.gate && view.gateExempt !== undefined ? (b.index.get(view.gateExempt) ?? -1) : -1
      const changed = cullSpheres(view, b.spheres, b.all.length, b.packed, b.scratch, exempt)
			// Rows moved since the last cull, in a packing that is otherwise the same, are written in place.
			const moved = b.movedIdx.length > 0
      if (b.liquid) {
				if (changed) this.pack(b, b.liquid, b.liquidIds, b.packed)
				else if (moved) this.patch(b, b.liquid, b.packed)
			}
      if (!b.lod) {
        if (changed) this.pack(b, b.mesh, b.ids, b.packed)
				else if (moved) this.patch(b, b.mesh, b.packed)
      } else if (splitLod(view, b.spheres, b.packed, b.near, b.far, b.scratch, b.scratchFar) || changed) {
				// The split changes as the camera moves, even when the instances in view don't.
				this.pack(b, b.mesh, b.ids, b.near)
				this.pack(b, b.lod, b.lodIds, b.far)
			} else if (moved) {
				this.patch(b, b.mesh, b.near)
				this.patch(b, b.lod, b.far)
			}
			b.movedIdx.length = 0
    }
    // A big WMO drawn once is culled by group, every frame, as its groups' view changes with the camera.
    for (const b of this.batches.values()) {
      if (!b.cull) continue
      const one = WmoGroupCull.enabled && b.mesh.count === 1 && view.camera && b.mesh.visible
      b.cull.update(one ? view.camera! : null, view.frustums[0], b.mesh.instanceMatrix.array, view.shadowCamera ?? null, view.shadowFrustum ?? null)
    }
  }

  /** Packs the instances `which` names (indices into `b.all`) to the front of `mesh`. */
  private pack(b: Batch, mesh: THREE.InstancedMesh, ids: number[], which: number[]) {
    packMatrices(b.matrices, which, mesh.instanceMatrix.array as Float32Array)
    ids.length = which.length
    for (let k = 0; k < which.length; k++) ids[k] = b.all[which[k]]
    mesh.count = which.length
    // An empty mesh is hidden: three would still set up each of its groups in every pass (#323).
    mesh.visible = which.length > 0
		// The whole buffer: a range left from a `patch` not yet uploaded would cut the upload short.
		mesh.instanceMatrix.clearUpdateRanges()
    mesh.instanceMatrix.needsUpdate = true
		wholePending.add(mesh.instanceMatrix)
    // Picking tests the mesh's sphere first, so it must cover the instances drawn.
    mesh.computeBoundingSphere()
  }

	/**
	 * Writes the rows `update` recomputed (`b.movedIdx`) into `mesh`, where `which` (ascending indices
	 * into `b.all`, as packed) draws them, and uploads only those rows (#510). The mesh's sphere grows to
	 * cover them; the next `pack` fits it again.
	 */
	private patch(b: Batch, mesh: THREE.InstancedMesh, which: number[]) {
		const attr = mesh.instanceMatrix
		const arr = attr.array as Float32Array
		const ranged = !wholePending.has(attr) && b.movedIdx.length <= RANGES_MAX
		let any = false
		for (const i of b.movedIdx) {
			const k = indexIn(which, i)
			if (k < 0) continue
			const s = i * 16
			const d = k * 16
			for (let j = 0; j < 16; j++) arr[d + j] = b.matrices[s + j]
			if (ranged) attr.addUpdateRange(d, 16)
			patchM.fromArray(b.matrices, s)
			instanceSphere(mesh.geometry, patchM, patchS, 0)
			patchSphere.center.set(patchS[0], patchS[1], patchS[2])
			patchSphere.radius = patchS[3]
			if (mesh.boundingSphere) mesh.boundingSphere.union(patchSphere)
			any = true
		}
		if (!any) return
		if (!ranged) attr.clearUpdateRanges()
		attr.needsUpdate = true
		if (!mesh.boundingSphere) mesh.computeBoundingSphere()
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
      if (h.instanceId === undefined) continue
      const id = (h.object.userData.ids as number[])[h.instanceId]
      if (id === undefined || exclude?.has(id)) continue
      if (!getAsset(this.objects.get(id)!.type).ready) continue
      return { id, point: h.point.clone(), distance: h.distance }
    }
    return null
  }

  /**
   * Whether a drawn building (WMO) meets the ray within its `far`: a sight-line test, cheap since a
   * map has few buildings beside its many doodads.
   */
  wmoBlocks(raycaster: THREE.Raycaster): boolean {
    for (const h of this.intersect(raycaster, true)) if (h.instanceId !== undefined) return true
    return false
  }

  /** Returns the id of the object under the ray, or null. */
  pick(raycaster: THREE.Raycaster): number | null {
    return this.pickHit(raycaster)?.id ?? null
  }

  /** The object under the ray and how far along the ray it was hit, or null. */
  pickHit(raycaster: THREE.Raycaster): { id: number; distance: number } | null {
    for (const h of this.intersect(raycaster)) {
      if (h.instanceId === undefined) continue
      const id = (h.object.userData.ids as number[])[h.instanceId]
      return id === undefined ? null : { id, distance: h.distance }
    }
    return null
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
