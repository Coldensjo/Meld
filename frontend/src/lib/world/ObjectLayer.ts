import * as THREE from 'three'
import { placementEuler } from './placement'
import type { MeshBVH } from 'three-mesh-bvh'
import { getAsset, onAssetLoaded } from '../models/assets'
import type { Terrain } from '../terrain/Terrain'
import { SkinnedInstancedMesh } from './Animator'
import { cullSpheres, instanceSphere, packMatrices, splitLod, type CullView } from './instanceCull'
import { cullForShadows } from './shadowReach'

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

interface Batch {
  mesh: THREE.InstancedMesh
  /** The ids of the instances drawn, by instance index: the ones in view, packed (see cull). */
  ids: number[]
  /** Draws the instances small on screen with the model's LOD, when it has one (see models/lod.ts). */
  lod: THREE.InstancedMesh | null
  lodIds: number[]
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
}

/**
 * All placed props. One InstancedMesh per model type keeps draw calls at
 * O(model types) no matter how many objects are placed. Root objects sit on
 * the terrain (y = ground + yOff) and get re-snapped after sculpting; attached
 * objects follow their parent.
 */
export class ObjectLayer {
  readonly group = new THREE.Group()
  readonly objects = new Map<number, WorldObject>()
  /** Bumped on any change to placed objects (or their loaded models). */
  version = 0
  /** Objects hidden for this session (H). Not saved in the map, and not undoable, like layer visibility. */
  readonly hidden = new Set<number>()
  /** Draw hidden objects anyway, so they can be picked and shown again. */
  private showHidden = false
  private batches = new Map<string, Batch>()
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
    this.objects.set(obj.id, obj)
    this.batch(obj.type).dirty = true
    this.version++
    return obj
  }

  remove(id: number): WorldObject | undefined {
    const o = this.objects.get(id)
    if (!o) return
    this.objects.delete(id)
    this.hidden.delete(id)
    this.batch(o.type).dirty = true
    this.version++
    return o
  }

  /**
   * Changes an object's model, keeping its id, placement and attachments: it leaves its old type's
   * instanced mesh for the new one's.
   */
  setType(id: number, type: string) {
    const o = this.objects.get(id)
    if (!o || o.type === type) return
    this.batch(o.type).dirty = true
    o.type = type
    this.markTree(o, 0)
    this.version++
  }

  /** Call after mutating an object's fields. Attached children follow. */
  touch(id: number) {
    const o = this.objects.get(id)
    if (o) this.markTree(o, 0)
    this.version++
  }

  /** Mark an object and everything attached to it (recursively) for rebuild. */
  private markTree(o: WorldObject, depth: number) {
    this.batch(o.type).dirty = true
    if (depth >= MAX_DEPTH) return
    for (const c of this.objects.values()) if (c.parent === o.id) this.markTree(c, depth + 1)
  }

  childrenOf(id: number): WorldObject[] {
    return [...this.objects.values()].filter((c) => c.parent === id)
  }

  /** A selection group number no object has yet. */
  newGroup(): number {
    return this.nextGroup++
  }

  /** The object plus everything attached to it, recursively. */
  descendantIds(id: number): Set<number> {
    return this.descendantsOf([id])
  }

  /** The objects plus everything attached to any of them, recursively, found in one walk. */
  descendantsOf(ids: Iterable<number>): Set<number> {
    const out = new Set<number>(ids)
    let grew = true
    while (grew) {
      grew = false
      for (const c of this.objects.values()) {
        if (c.parent !== undefined && out.has(c.parent) && !out.has(c.id)) {
          out.add(c.id)
          grew = true
        }
      }
    }
    return out
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
    this.markAllDirty()
  }

  markAllDirty() {
    for (const b of this.batches.values()) b.dirty = true
    this.version++
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
    const q = new THREE.Quaternion().setFromEuler(placementEuler(new THREE.Euler(), o.rotY, o.tiltX, o.tiltZ))
    const sc = new THREE.Vector3().setScalar(o.scale)
    const parent = this.parentOf(o, depth)
    if (!parent) {
      return out.compose(new THREE.Vector3(o.x, this.terrain.heightAt(o.x, o.z) + o.yOff, o.z), q, sc)
    }
    out.compose(new THREE.Vector3(o.x, o.yOff, o.z), q, sc)
    return out.premultiply(this.matrixAt(parent, new THREE.Matrix4(), depth + 1))
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
    if (parent && parent.id !== o.id && !this.descendantIds(o.id).has(parent.id)) {
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
      b = {
        mesh: this.makeMesh(type, a.geometry, 64, ids),
        ids,
        lod: a.lod ? this.makeMesh(type, a.lod, 64, lodIds) : null,
        lodIds,
        near: [],
        far: [],
        all: [],
        matrices: new Float32Array(0),
        spheres: new Float32Array(0),
        packed: [],
        scratch: [],
        scratchFar: [],
        dirty: true,
      }
      this.batches.set(type, b)
      this.group.add(b.mesh)
      if (b.lod) this.group.add(b.lod)
    }
    return b
  }

  /** Replaces a batch's meshes, for a model that loaded or more instances than they hold. */
  private setMeshes(b: Batch, type: string, capacity: number) {
    for (const m of [b.mesh, b.lod]) {
      if (!m) continue
      this.group.remove(m)
      m.dispose()
    }
    const a = getAsset(type)
    b.mesh = this.makeMesh(type, a.geometry, capacity, b.ids)
    b.lod = a.lod ? this.makeMesh(type, a.lod, capacity, b.lodIds) : null
    this.group.add(b.mesh)
    if (b.lod) this.group.add(b.lod)
  }

  /** `ids` names the object drawn by each instance, as `cull` packs them. */
  private makeMesh(type: string, geometry: THREE.BufferGeometry, capacity: number, ids: number[]) {
    const a = getAsset(type)
    const m = a.skeleton ? new SkinnedInstancedMesh(geometry, a.material, capacity, a.skeleton) : new THREE.InstancedMesh(geometry, a.material, capacity)
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    m.count = 0
    m.userData.type = type
    m.userData.ids = ids
    // Our own cull packs what is in view; three only culls it per point-light shadow face.
    cullForShadows(m)
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  /** Whether any object of `type` is drawn: not hidden, and in view as of the last cull. */
  hasVisible(type: string): boolean {
    const b = this.batches.get(type)
    return !!b && (b.mesh.count > 0 || (b.lod?.count ?? 0) > 0)
  }

  /**
   * Recomputes the matrices and bounds of the dirty batches' objects. Call once per frame, before
   * `cull`, which packs the ones in view into the instance buffers.
   */
  update() {
    for (const [type, b] of this.batches) {
      if (!b.dirty) continue
      b.dirty = false
      b.all.length = 0
      for (const o of this.objects.values()) if (o.type === type && !this.isHidden(o.id)) b.all.push(o.id)
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

  /**
   * Draws only the instances in `view`: they are packed to the front of each batch's instance buffer,
   * so a type with nothing in view costs no draw calls. Instances small on screen go to the LOD mesh.
   * Call once per frame, after `update`.
   */
  cull(view: CullView) {
    for (const b of this.batches.values()) {
      const exempt = view.gate && view.gateExempt !== undefined ? b.all.indexOf(view.gateExempt) : -1
      const changed = cullSpheres(view, b.spheres, b.all.length, b.packed, b.scratch, exempt)
      if (!b.lod) {
        if (changed) this.pack(b, b.mesh, b.ids, b.packed)
        continue
      }
      // The split changes as the camera moves, even when the instances in view don't.
      if (!splitLod(view, b.spheres, b.packed, b.near, b.far, b.scratch, b.scratchFar) && !changed) continue
      this.pack(b, b.mesh, b.ids, b.near)
      this.pack(b, b.lod, b.lodIds, b.far)
    }
  }

  /** Packs the instances `which` names (indices into `b.all`) to the front of `mesh`. */
  private pack(b: Batch, mesh: THREE.InstancedMesh, ids: number[], which: number[]) {
    packMatrices(b.matrices, which, mesh.instanceMatrix.array as Float32Array)
    ids.length = which.length
    for (let k = 0; k < which.length; k++) ids[k] = b.all[which[k]]
    mesh.count = which.length
    mesh.instanceMatrix.needsUpdate = true
    // Picking tests the mesh's sphere first, so it must cover the instances drawn.
    mesh.computeBoundingSphere()
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
    }
    this.batches.clear()
    this.group.clear()
  }
}
