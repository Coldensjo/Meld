import * as THREE from 'three'
import type { vmangos } from '../../../wailsjs/go/models'

export type SpawnKind = 'monster' | 'npc' | 'object'

/** Marker colours, by kind: red monsters, green NPCs, yellow objects. */
export const SPAWN_COLORS: Record<SpawnKind, number> = {
  monster: 0xe0533d,
  npc: 0x4cc56b,
  object: 0xe8c547,
}

const KINDS: SpawnKind[] = ['monster', 'npc', 'object']

/**
 * The creatures and game objects a region's world database places, drawn as coloured cones over
 * their spawn points. One instanced mesh per kind, so the draw calls don't grow with the spawns.
 */
export class SpawnLayer {
  readonly group = new THREE.Group()
  private readonly geometry = new THREE.ConeGeometry(1.2, 4, 6).translate(0, 2, 0)
  private readonly materials = new Map<SpawnKind, THREE.MeshBasicMaterial>(
    KINDS.map((k) => [k, new THREE.MeshBasicMaterial({ color: SPAWN_COLORS[k] })]),
  )
  private meshes = new Map<SpawnKind, THREE.InstancedMesh>()
  /** The spawns drawn now, in the region's coordinates. */
  spawns: vmangos.WorldSpawn[] = []

  /** Replaces the drawn spawns. Each cone sits on its spawn point, one yard above it. */
  set(spawns: vmangos.WorldSpawn[]) {
    this.clear()
    this.spawns = spawns
    const counts = new Map<SpawnKind, number>(KINDS.map((k) => [k, 0]))
    for (const s of spawns) counts.set(s.kind as SpawnKind, (counts.get(s.kind as SpawnKind) ?? 0) + 1)
    const next = new Map<SpawnKind, number>(KINDS.map((k) => [k, 0]))
    const m = new THREE.Matrix4()
    for (const k of KINDS) {
      const n = counts.get(k) ?? 0
      if (n === 0) continue
      const mesh = new THREE.InstancedMesh(this.geometry, this.materials.get(k)!, n)
      this.meshes.set(k, mesh)
      this.group.add(mesh)
    }
    for (const s of spawns) {
      const kind = s.kind as SpawnKind
      const mesh = this.meshes.get(kind)
      if (!mesh) continue
      const i = next.get(kind)!
      next.set(kind, i + 1)
      m.makeTranslation(s.x, s.y + 1, s.z)
      mesh.setMatrixAt(i, m)
    }
    for (const mesh of this.meshes.values()) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }

  /** Shows the kinds that are `true` and hides the rest. */
  setKinds(shown: Record<SpawnKind, boolean>) {
    for (const k of KINDS) {
      const mesh = this.meshes.get(k)
      if (mesh) mesh.visible = shown[k]
    }
  }

  /** Counts of the spawns drawn, by kind. */
  counts(): Record<SpawnKind, number> {
    const out: Record<SpawnKind, number> = { monster: 0, npc: 0, object: 0 }
    for (const s of this.spawns) out[s.kind as SpawnKind]++
    return out
  }

  private clear() {
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh)
      mesh.dispose()
    }
    this.meshes.clear()
    this.spawns = []
  }

  dispose() {
    this.clear()
    this.geometry.dispose()
    for (const m of this.materials.values()) m.dispose()
  }
}
