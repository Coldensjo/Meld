import * as THREE from 'three'
import type { vmangos } from '../../../wailsjs/go/models'
import { getAsset, isWowType, onAssetLoaded, skinnedType } from '../models/assets'

export type SpawnKind = 'monster' | 'npc' | 'object'

/** Marker colours, by kind: red monsters, green NPCs, yellow objects. */
export const SPAWN_COLORS: Record<SpawnKind, number> = {
  monster: 0xe0533d,
  npc: 0x4cc56b,
  object: 0xe8c547,
}

const KINDS: SpawnKind[] = ['monster', 'npc', 'object']

/**
 * The editor's type for a spawn's client model: "wmo:" for buildings, "m2:" for everything else,
 * with the display's skins when it has any.
 */
export function spawnType(s: { model: string; skins?: string[] | null }): string {
  if (!s.model) return ''
  const type = s.model.toLowerCase().endsWith('.wmo') ? `wmo:${s.model}` : `m2:${s.model}`
  return skinnedType(type, s.skins)
}

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
  private meshes: THREE.InstancedMesh[] = []
  private readonly cone = new THREE.ConeGeometry(1.2, 4, 6).translate(0, 2, 0)
  private readonly coneMaterials = new Map<SpawnKind, THREE.MeshBasicMaterial>(
    KINDS.map((k) => [k, new THREE.MeshBasicMaterial({ color: SPAWN_COLORS[k] })]),
  )
  private readonly unsubscribe = onAssetLoaded((type) => {
    if (this.types.has(type)) this.rebuild()
  })
  private types = new Set<string>()
  private shown: Record<SpawnKind, boolean> = { monster: true, npc: true, object: true }

  /** Replaces the drawn spawns, and starts loading their models. */
  set(spawns: vmangos.WorldSpawn[]) {
    this.spawns = spawns
    this.types = new Set(spawns.map((s) => spawnType(s)).filter((t) => t !== ''))
    for (const t of this.types) getAsset(t)
    this.rebuild()
  }

  /** Shows the kinds that are `true` and hides the rest; the choice holds across rebuilds. */
  setKinds(shown: Record<SpawnKind, boolean>) {
    this.shown = { ...shown }
    this.applyKinds()
  }

  private applyKinds() {
    for (const mesh of this.meshes) mesh.visible = this.shown[mesh.userData.kind as SpawnKind]
  }

  /** The spawn under the ray, nearest first, among the kinds shown; null when none is. */
  pick(raycaster: THREE.Raycaster): vmangos.WorldSpawn | null {
    const shown = this.meshes.filter((m) => m.visible && m.count > 0)
    for (const h of raycaster.intersectObjects(shown, false)) {
      const items = h.object.userData.items as vmangos.WorldSpawn[] | undefined
      if (h.instanceId !== undefined && items?.[h.instanceId]) return items[h.instanceId]
    }
    return null
  }

  /** Counts of the spawns drawn, by kind. */
  counts(): Record<SpawnKind, number> {
    const out: Record<SpawnKind, number> = { monster: 0, npc: 0, object: 0 }
    for (const s of this.spawns) out[s.kind as SpawnKind]++
    return out
  }

  private rebuild() {
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
      const mesh = new THREE.InstancedMesh(geometry, material, b.items.length)
      mesh.userData.kind = b.kind
      mesh.userData.items = b.items
      mesh.frustumCulled = false
      mesh.castShadow = ready
      mesh.receiveShadow = ready
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const up = new THREE.Vector3(0, 1, 0)
      const scale = new THREE.Vector3(1, 1, 1)
      const pos = new THREE.Vector3()
      b.items.forEach((s, i) => {
        // Cones point up at the spawn point. Models turn to the spawn's facing and take its size.
        pos.set(s.x, s.y, s.z)
        q.setFromAxisAngle(up, ready ? spawnRotation(s.orientation) : 0)
        const k = ready && s.scale > 0 ? s.scale : 1
        scale.set(k, k, k)
        m.compose(pos, q, scale)
        mesh.setMatrixAt(i, m)
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      this.meshes.push(mesh)
      this.group.add(mesh)
    }
    this.applyKinds()
  }

  private clearMeshes() {
    for (const mesh of this.meshes) {
      this.group.remove(mesh)
      // Shared model geometry and materials belong to the asset loader; only the instances are freed.
      mesh.dispose()
    }
    this.meshes = []
  }

  dispose() {
    this.unsubscribe()
    this.clearMeshes()
    this.cone.dispose()
    for (const m of this.coneMaterials.values()) m.dispose()
  }
}
