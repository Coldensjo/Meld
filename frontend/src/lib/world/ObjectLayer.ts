import * as THREE from 'three'
import { getAsset, onAssetLoaded } from '../models/assets'
import type { Terrain } from '../terrain/Terrain'

export interface WorldObject {
  id: number
  type: string
  x: number
  z: number
  /** Height offset above the terrain surface. */
  yOff: number
  rotY: number
  scale: number
}

interface Batch {
  mesh: THREE.InstancedMesh
  ids: number[]
  dirty: boolean
}

/**
 * All placed props. One InstancedMesh per prefab type keeps draw calls at
 * O(prefab types) no matter how many objects are placed. Objects always sit on
 * the terrain (y = ground + yOff) and get re-snapped after sculpting.
 */
export class ObjectLayer {
  readonly group = new THREE.Group()
  readonly objects = new Map<number, WorldObject>()
  private batches = new Map<string, Batch>()
  private nextId = 1
  private tmpM = new THREE.Matrix4()
  private tmpQ = new THREE.Quaternion()
  private tmpS = new THREE.Vector3()
  private tmpP = new THREE.Vector3()
  private up = new THREE.Vector3(0, 1, 0)

  private unsubscribe: () => void

  constructor(private terrain: Terrain) {
    this.group.name = 'objects'
    // Swap placeholder meshes once an async (WoW) model finishes loading.
    this.unsubscribe = onAssetLoaded((type) => {
      const b = this.batches.get(type)
      if (!b) return
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
    const obj: WorldObject = { ...o, id: o.id ?? this.nextId++ }
    this.nextId = Math.max(this.nextId, obj.id + 1)
    this.objects.set(obj.id, obj)
    this.batch(obj.type).dirty = true
    return obj
  }

  remove(id: number): WorldObject | undefined {
    const o = this.objects.get(id)
    if (!o) return
    this.objects.delete(id)
    this.batch(o.type).dirty = true
    return o
  }

  /** Call after mutating an object's fields. */
  touch(id: number) {
    const o = this.objects.get(id)
    if (o) this.batch(o.type).dirty = true
  }

  clear() {
    this.objects.clear()
    this.markAllDirty()
  }

  markAllDirty() {
    for (const b of this.batches.values()) b.dirty = true
  }

  /** Re-snap objects within a world-space rect after terrain edits. */
  markRegionDirty(x0: number, z0: number, x1: number, z1: number) {
    for (const o of this.objects.values()) {
      if (o.x >= x0 && o.x <= x1 && o.z >= z0 && o.z <= z1) this.batch(o.type).dirty = true
    }
  }

  worldPosition(o: WorldObject, out: THREE.Vector3) {
    return out.set(o.x, this.terrain.heightAt(o.x, o.z) + o.yOff, o.z)
  }

  matrixOf(o: WorldObject, out: THREE.Matrix4) {
    this.tmpQ.setFromAxisAngle(this.up, o.rotY)
    this.tmpS.setScalar(o.scale)
    return out.compose(this.worldPosition(o, this.tmpP), this.tmpQ, this.tmpS)
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
