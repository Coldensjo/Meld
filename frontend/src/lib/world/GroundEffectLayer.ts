import * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import { CHUNK_CELLS, NO_TEXTURE } from '../terrain/chunkPaint'
import { getAsset, onAssetLoaded } from '../models/assets'
import type { ObjectLayer } from './ObjectLayer'
import { cellTexture, cellTufts, coverCells, effectFor, tuftsPerCell, type CoverBox, type GroundEffectTables, type TextureEffects, type Tuft } from './groundEffects'

/** How high above the ground a building's bottom may float and still bare the cells under it. */
const COVER_LIFT = 4

/**
 * The footprints of the map's buildings (root WMOs standing on or in the ground), for the cells
 * they bare. A model still loading has the placeholder's box until it arrives.
 */
export function buildingBoxes(objects: ObjectLayer): CoverBox[] {
  const out: CoverBox[] = []
  for (const o of objects.objects.values()) {
    if (o.parent !== undefined || !o.type.startsWith('wmo:')) continue
    const bb = getAsset(o.type).bbox
    if (bb.isEmpty() || o.yOff + bb.min.y * o.scale > COVER_LIFT) continue
    out.push({ x: o.x, z: o.z, rotY: o.rotY, scale: o.scale, minX: bb.min.x, minZ: bb.min.z, maxX: bb.max.x, maxZ: bb.max.z })
  }
  return out
}

/**
 * The cells that grow no ground effects, one byte per cell in `out`: the client's own no-doodad
 * bits plus the cells under the map's buildings.
 */
export function blockedCells(terrain: Terrain, objects: ObjectLayer, out: Uint8Array): Uint8Array {
  out.set(terrain.noEffect)
  coverCells(buildingBoxes(objects), terrain.cellSize, terrain.size, out)
  return out
}

/** How far from the camera tufts are drawn, in yards (the game's ground effect distance is about this). */
export const TUFT_RANGE = 90
/** Most tufts drawn at once; past it the cells nearest the camera keep theirs. */
const MAX_TUFTS = 60000
/** The layer is rebuilt no more often than this while the camera moves or the ground changes. */
const REBUILD_MS = 250

interface Batch {
  mesh: THREE.InstancedMesh
  count: number
}

/**
 * Draws the ground effects of one map: the grass tufts, flowers and pebbles the game scatters on
 * each cell by the texture on top of it. Only the cells within TUFT_RANGE of the camera are built,
 * one InstancedMesh per detail model, and the build is redone when the camera has moved half a
 * chunk, the ground or its paint changed, or a model finished loading.
 */
export class GroundEffectLayer {
  readonly group = new THREE.Group()
  private batches = new Map<string, Batch>()
  private tufts: Tuft[] = []
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private p = new THREE.Vector3()
  private s = new THREE.Vector3()
  private up = new THREE.Vector3(0, 1, 0)
  private builtAt = new THREE.Vector2(Infinity, Infinity)
  private builtKey = ''
  private heightVersion = -1
  private paintVersion = -1
  private lastBuild = 0
  private assetsChanged = true
  private unsubscribe: () => void
  /** The cells that grow nothing (see blockedCells), rebuilt with the layer. */
  private blocked = new Uint8Array(0)

  constructor(private terrain: Terrain) {
    this.group.name = 'groundEffects'
    this.unsubscribe = onAssetLoaded(() => (this.assetsChanged = true))
  }

  setTerrain(t: Terrain) {
    this.terrain = t
    this.heightVersion = -1
  }

  /**
   * Keeps the tufts around `eye` current. `key` names everything else the build depends on (the
   * palette, the map's own effects and the tables), so a change of any redraws.
   */
  update(eye: THREE.Vector3, palette: readonly string[], own: TextureEffects, tables: GroundEffectTables | null, key: string, now: number, objects: ObjectLayer, factor: number) {
    if (!this.group.visible || !tables) return
    const t = this.terrain
    const half = (CHUNK_CELLS * t.cellSize) / 2
    const moved = Math.abs(eye.x - this.builtAt.x) > half || Math.abs(eye.z - this.builtAt.y) > half
    const changed = t.heightVersion !== this.heightVersion || t.paintVersion !== this.paintVersion || key !== this.builtKey || this.assetsChanged
    if (!moved && !changed) return
    if (now - this.lastBuild < REBUILD_MS) return
    this.lastBuild = now
    this.builtAt.set(eye.x, eye.z)
    this.builtKey = key
    this.heightVersion = t.heightVersion
    this.paintVersion = t.paintVersion
    this.assetsChanged = false
    this.build(eye, palette, own, tables, objects, factor)
  }

  private build(eye: THREE.Vector3, palette: readonly string[], own: TextureEffects, tables: GroundEffectTables, objects: ObjectLayer, factor: number) {
    const t = this.terrain
    const cs = t.cellSize
    const cells = t.size
    if (this.blocked.length !== cells * cells) this.blocked = new Uint8Array(cells * cells)
    const blocked = blockedCells(t, objects, this.blocked)
    const r = TUFT_RANGE
    const cx0 = Math.max(0, Math.floor((eye.x - r) / cs))
    const cx1 = Math.min(cells - 1, Math.ceil((eye.x + r) / cs))
    const cz0 = Math.max(0, Math.floor((eye.z - r) / cs))
    const cz1 = Math.min(cells - 1, Math.ceil((eye.z + r) / cs))
    for (const b of this.batches.values()) b.count = 0
    // The effect of each palette entry, looked up once per build.
    const effectOf = palette.map((p) => {
      const id = effectFor(p, own, tables)
      return id ? (tables.effects[id] ?? null) : null
    })
    const r2 = r * r
    let total = 0
    for (let cz = cz0; cz <= cz1; cz++) {
      const zc = (cz + 0.5) * cs
      for (let cx = cx0; cx <= cx1; cx++) {
        const xc = (cx + 0.5) * cs
        const dx = xc - eye.x
        const dz = zc - eye.z
        if (dx * dx + dz * dz > r2) continue
        if (blocked[cz * cells + cx] || t.isHole(xc, zc)) continue
        const tex = cellTexture(t.weights, t.chunkSlots, t.splatRes, t.paintChunksPerSide, cx, cz)
        if (tex === NO_TEXTURE) continue
        const effect = effectOf[tex]
        if (!effect || effect.doodads.length === 0) continue
        const n = tuftsPerCell(effect.density, factor)
        if (n === 0) continue
        if (total + n > MAX_TUFTS) continue
        cellTufts(cx, cz, n, effect.doodads.length, this.tufts)
        for (let i = 0; i < n; i++) {
          const tuft = this.tufts[i]
          const x = (cx + tuft.u) * cs
          const z = (cz + tuft.v) * cs
          const y = t.heightAt(x, z)
          this.place(effect.doodads[tuft.doodad], x, y, z, tuft.rotY, tuft.scale)
        }
        total += n
      }
    }
    for (const [type, b] of this.batches) {
      b.mesh.count = b.count
      b.mesh.instanceMatrix.needsUpdate = true
      if (b.count === 0 && b.mesh.instanceMatrix.count > 4096) {
        // A model no longer in range gives its buffer back.
        this.group.remove(b.mesh)
        b.mesh.dispose()
        this.batches.delete(type)
      }
    }
  }

  private place(path: string, x: number, y: number, z: number, rotY: number, scale: number) {
    const type = 'm2:' + path
    const asset = getAsset(type)
    // A model still loading has nothing to draw yet; it is built in when it arrives.
    if (!asset.ready) return
    let b = this.batches.get(type)
    if (!b || b.mesh.geometry !== asset.geometry) {
      if (b) {
        this.group.remove(b.mesh)
        b.mesh.dispose()
      }
      b = { mesh: this.makeMesh(asset.geometry, asset.material, 1024), count: 0 }
      this.batches.set(type, b)
    }
    if (b.count >= b.mesh.instanceMatrix.count) {
      const bigger = this.makeMesh(asset.geometry, asset.material, b.mesh.instanceMatrix.count * 2)
      bigger.instanceMatrix.array.set(b.mesh.instanceMatrix.array)
      this.group.remove(b.mesh)
      b.mesh.dispose()
      b.mesh = bigger
    }
    this.q.setFromAxisAngle(this.up, rotY)
    this.m.compose(this.p.set(x, y, z), this.q, this.s.setScalar(scale))
    b.mesh.setMatrixAt(b.count++, this.m)
  }

  private makeMesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], capacity: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geometry, material, capacity)
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // The instances spread over the whole range; three's per-mesh sphere would cull them wrongly.
    m.frustumCulled = false
    m.castShadow = false
    m.receiveShadow = true
    m.count = 0
    this.group.add(m)
    return m
  }

  /** How many tufts are drawn now. */
  get count(): number {
    let n = 0
    for (const b of this.batches.values()) n += b.count
    return n
  }

  dispose() {
    this.unsubscribe()
    for (const b of this.batches.values()) {
      this.group.remove(b.mesh)
      b.mesh.dispose()
    }
    this.batches.clear()
  }
}
