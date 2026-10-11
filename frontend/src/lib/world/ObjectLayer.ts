import * as THREE from 'three'
import { getAsset, onAssetLoaded } from '../models/assets'
import type { Terrain } from '../terrain/Terrain'

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
  ids: number[]
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
  private batches = new Map<string, Batch>()
  private nextId = 1
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
      this.group.remove(b.mesh)
      b.mesh.dispose()
      b.mesh = this.makeMesh(type, b.mesh.instanceMatrix.count)
      this.group.add(b.mesh)
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
    this.batch(o.type).dirty = true
    this.version++
    return o
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

  /** The object plus everything attached to it, recursively. */
  descendantIds(id: number): Set<number> {
    const out = new Set<number>([id])
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

  clear() {
    this.objects.clear()
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
    // Tilt is applied in the model's own frame, then the turn about the world up.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.tiltX ?? 0, o.rotY, o.tiltZ ?? 0, 'YXZ'))
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
      b = { mesh: this.makeMesh(type, 64), ids: [], dirty: true }
      this.batches.set(type, b)
      this.group.add(b.mesh)
    }
    return b
  }

  private makeMesh(type: string, capacity: number) {
    const a = getAsset(type)
    const m = new THREE.InstancedMesh(a.geometry, a.material, capacity)
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    m.count = 0
    m.userData.type = type
    m.frustumCulled = false
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  /** Rebuild instance buffers for dirty batches. Call once per frame. */
  update() {
    for (const [type, b] of this.batches) {
      if (!b.dirty) continue
      b.dirty = false
      b.ids.length = 0
      for (const o of this.objects.values()) if (o.type === type) b.ids.push(o.id)
      if (b.ids.length > b.mesh.instanceMatrix.count) {
        let cap = b.mesh.instanceMatrix.count
        while (cap < b.ids.length) cap *= 2
        this.group.remove(b.mesh)
        b.mesh.dispose()
        b.mesh = this.makeMesh(type, cap)
        this.group.add(b.mesh)
      }
      for (let i = 0; i < b.ids.length; i++) {
        b.mesh.setMatrixAt(i, this.matrixOf(this.objects.get(b.ids[i])!, this.tmpM))
      }
      b.mesh.count = b.ids.length
      b.mesh.instanceMatrix.needsUpdate = true
      b.mesh.computeBoundingSphere()
    }
  }

  /** Nearest object surface under the ray, skipping `exclude` ids. */
  raycastSurface(raycaster: THREE.Raycaster, exclude?: Set<number>): { id: number; point: THREE.Vector3; distance: number } | null {
    const hits = raycaster.intersectObjects(
      [...this.batches.values()].map((b) => b.mesh).filter((m) => m.count > 0),
      false,
    )
    for (const h of hits) {
      if (h.instanceId === undefined) continue
      const b = this.batches.get(h.object.userData.type as string)
      const id = b?.ids[h.instanceId]
      if (id === undefined || exclude?.has(id)) continue
      if (!getAsset(this.objects.get(id)!.type).ready) continue
      return { id, point: h.point.clone(), distance: h.distance }
    }
    return null
  }

  /** Returns the id of the object under the ray, or null. */
  pick(raycaster: THREE.Raycaster): number | null {
    const hits = raycaster.intersectObjects(
      [...this.batches.values()].map((b) => b.mesh).filter((m) => m.count > 0),
      false,
    )
    for (const h of hits) {
      if (h.instanceId === undefined) continue
      const b = this.batches.get(h.object.userData.type as string)
      if (b) return b.ids[h.instanceId] ?? null
    }
    return null
  }

  list(): WorldObject[] {
    return [...this.objects.values()]
  }

  dispose() {
    this.unsubscribe()
    for (const b of this.batches.values()) b.mesh.dispose()
    this.batches.clear()
    this.group.clear()
  }
}
