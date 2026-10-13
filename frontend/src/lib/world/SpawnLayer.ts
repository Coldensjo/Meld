import * as THREE from 'three'
import type { vmangos } from '../../../wailsjs/go/models'
import { getAsset, isWowType, onAssetLoaded } from '../models/assets'
import { spawnType } from './spawnInfo'
import { SkinnedInstancedMesh } from './Animator'
import { cullSpheres, instanceSphere, packMatrices, type CullView } from './instanceCull'

/** The spawns of one kind and model, and what's needed to draw the ones in view. */
interface SpawnBatch {
  mesh: THREE.InstancedMesh
  kind: SpawnKind
  all: vmangos.WorldSpawn[]
  matrices: Float32Array
  spheres: Float32Array
  /** Indices into `all` of the spawns drawn, by instance index, and scratch for the next cull. */
  packed: number[]
  scratch: number[]
}

export type SpawnKind = 'monster' | 'npc' | 'object'

/** Marker colours, by kind: red monsters, green NPCs, yellow objects. */
export const SPAWN_COLORS: Record<SpawnKind, number> = {
  monster: 0xe0533d,
  npc: 0x4cc56b,
  object: 0xe8c547,
}

const KINDS: SpawnKind[] = ['monster', 'npc', 'object']

/**
 * The three.js rotation about Y for a server facing. The server's orientation is measured from its
 * +X axis (north) towards +Y (west). Server +X is the editor's -Z and +Y is -X, and a model faces
 * +X in the editor at rest, so facing 0 needs a quarter turn: +X onto -Z.
 */
export function spawnRotation(orientation: number): number {
  return orientation + Math.PI / 2
}

/**
 * The creatures and game objects a region's world database places. Each spawn shows its client
 * model, one instanced mesh per model and kind, as objects are drawn. A spawn whose model is still
 * loading, or has none, shows a coloured cone at its spawn point instead, so nothing draws as the
 * loader's placeholder box.
 */
export class SpawnLayer {
  readonly group = new THREE.Group()
  /** The spawns drawn now, in the region's coordinates. */
  spawns: vmangos.WorldSpawn[] = []
  private batches: SpawnBatch[] = []
  private readonly cone = new THREE.ConeGeometry(1.2, 4, 6).translate(0, 2, 0)
  private readonly coneMaterials = new Map<SpawnKind, THREE.MeshBasicMaterial>(
    KINDS.map((k) => [k, new THREE.MeshBasicMaterial({ color: SPAWN_COLORS[k] })]),
  )
  private readonly unsubscribe = onAssetLoaded((type) => {
    if (this.types.has(type)) this.rebuild()
  })
  private types = new Set<string>()
  private shown: Record<SpawnKind, boolean> = { monster: true, npc: true, object: true }
  /** Bumped whenever what is drawn changes (spawns, their loaded models or the kinds shown). */
  version = 0

  /** Replaces the drawn spawns, and starts loading their models. */
  set(spawns: vmangos.WorldSpawn[]) {
    this.spawns = spawns
    this.types = new Set(spawns.map((s) => spawnType(s)).filter((t) => t !== ''))
    for (const t of this.types) getAsset(t)
    this.rebuild()
  }

  /** Whether any spawn uses the model `type`. */
  hasType(type: string): boolean {
    return this.types.has(type)
  }

  /** Shows the kinds that are `true` and hides the rest; the choice holds across rebuilds. */
  setKinds(shown: Record<SpawnKind, boolean>) {
    this.shown = { ...shown }
    this.applyKinds()
  }

  private applyKinds() {
    for (const b of this.batches) b.mesh.visible = this.shown[b.kind]
    this.version++
  }

  /** The spawn under the ray, nearest first, among the kinds shown; null when none is. */
  pick(raycaster: THREE.Raycaster): vmangos.WorldSpawn | null {
    const shown = this.batches.filter((b) => b.mesh.visible && b.mesh.count > 0)
    for (const h of raycaster.intersectObjects(shown.map((b) => b.mesh), false)) {
      const b = shown.find((x) => x.mesh === h.object)
      if (b && h.instanceId !== undefined && h.instanceId < b.packed.length) return b.all[b.packed[h.instanceId]]
    }
    return null
  }

  /** Draws only the spawns in `view`, packed to the front of each batch's instance buffer. Call once per frame. */
  cull(view: CullView) {
    for (const b of this.batches) {
      if (!cullSpheres(view, b.spheres, b.all.length, b.packed, b.scratch)) continue
      packMatrices(b.matrices, b.packed, b.mesh.instanceMatrix.array as Float32Array)
      b.mesh.count = b.packed.length
      b.mesh.instanceMatrix.needsUpdate = true
      b.mesh.computeBoundingSphere()
    }
  }

  /** Counts of the spawns drawn, by kind. */
  counts(): Record<SpawnKind, number> {
    const out: Record<SpawnKind, number> = { monster: 0, npc: 0, object: 0 }
    for (const s of this.spawns) out[s.kind as SpawnKind]++
    return out
  }

  private rebuild() {
    this.version++
    this.clearMeshes()
    // Group the spawns by kind and model; a spawn with a ready model joins that model's batch.
    const batches = new Map<string, { kind: SpawnKind; items: vmangos.WorldSpawn[] }>()
    for (const s of this.spawns) {
      const type = spawnType(s)
      const asset = type && isWowType(type) ? getAsset(type) : null
      const ready = asset?.ready === true
      const key = ready ? `${s.kind}|${type}` : `${s.kind}|cone`
      let b = batches.get(key)
      if (!b) {
        b = { kind: s.kind as SpawnKind, items: [] }
        batches.set(key, b)
      }
      b.items.push(s)
    }
    for (const [key, b] of batches) {
      const type = key.slice(key.indexOf('|') + 1)
      const asset = type !== 'cone' ? getAsset(type) : null
      const ready = asset?.ready === true
      const geometry = ready ? asset.geometry : this.cone
      const material = ready ? asset.material : this.coneMaterials.get(b.kind)!
      const mesh =
        ready && asset.skeleton ? new SkinnedInstancedMesh(geometry, material, b.items.length, asset.skeleton) : new THREE.InstancedMesh(geometry, material, b.items.length)
      mesh.frustumCulled = false
      mesh.castShadow = ready
      mesh.receiveShadow = ready
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const up = new THREE.Vector3(0, 1, 0)
      const scale = new THREE.Vector3(1, 1, 1)
      const pos = new THREE.Vector3()
      const matrices = new Float32Array(b.items.length * 16)
      const spheres = new Float32Array(b.items.length * 4)
      b.items.forEach((s, i) => {
        // Cones point up at the spawn point. Models turn to the spawn's facing and take its size.
        pos.set(s.x, s.y, s.z)
        q.setFromAxisAngle(up, ready ? spawnRotation(s.orientation) : 0)
        const k = ready && s.scale > 0 ? s.scale : 1
        scale.set(k, k, k)
        m.compose(pos, q, scale)
        m.toArray(matrices, i * 16)
        instanceSphere(geometry, m, spheres, i * 4)
      })
      // Nothing is drawn until the first cull packs the spawns in view.
      mesh.count = 0
      this.batches.push({ mesh, kind: b.kind, all: b.items, matrices, spheres, packed: [-1], scratch: [] })
      this.group.add(mesh)
    }
    this.applyKinds()
  }

  private clearMeshes() {
    for (const b of this.batches) {
      this.group.remove(b.mesh)
      // Shared model geometry and materials belong to the asset loader; only the instances are freed.
      b.mesh.dispose()
    }
    this.batches = []
  }

  dispose() {
    this.unsubscribe()
    this.clearMeshes()
    this.cone.dispose()
    for (const m of this.coneMaterials.values()) m.dispose()
  }
}
