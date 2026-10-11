import * as THREE from 'three'
import { fbm, ridged } from '../engine/noise'
import { createTerrainMaterial } from './TerrainMaterial'
import { LAYER_COUNT } from './layers'
import { PaletteArray } from './paletteArray'
import { CHUNK_CELLS, NO_TEXTURE, SLOTS, SPLAT_PER_CELL, chunksPerSide, packRoles } from './chunkPaint'

/** A 1.12 tile is 1600/3 yards across: 128 cells of this size, the grid the server's maps use. */
export const TILE_YARDS = 1600 / 3
/** Default cell size in yards: 128 cells make one tile. */
export const CELL_SIZE = TILE_YARDS / 128
/** Seabed height of an empty ("ocean") map; water sits at 0. */
export const OCEAN_FLOOR = -12
const CHUNK = 32 // render chunk side, in cells (independent of the 1.12 paint chunks)

export type GenerateKind = 'ocean' | 'flat' | 'hills' | 'mountains' | 'island'

/**
 * Heightmap terrain split into chunks. Heights live in a flat Float32Array of
 * (size+1)^2 vertices; edits mark a dirty rect and only touched chunks are
 * re-uploaded on the next `update()`.
 *
 * Paint follows the 1.12 chunk rules (see chunkPaint.ts): each paint chunk of CHUNK_CELLS cells
 * names up to SLOTS palette textures in `chunkSlots`, and each texel's weights for those are in
 * `weights`.
 */
export class Terrain {
  readonly size: number
  readonly verts: number
  readonly cellSize: number
  readonly worldSize: number
  readonly splatRes: number
  /** Paint chunks along one side of the map. */
  readonly paintChunksPerSide: number
  readonly heights: Float32Array
  /** SLOTS weights per splat texel, for the chunk's slots; each texel sums to 255. */
  readonly weights: Uint8Array
  /** SLOTS palette indices per paint chunk (NO_TEXTURE for an empty slot). */
  readonly chunkSlots: Uint8Array
  readonly weightTex: THREE.DataTexture
  readonly slotTex: THREE.DataTexture
  /** The map's texture palette, bound to the shader. */
  readonly palette: PaletteArray
  /** Paint mask (0-255 per splat texel); texture fills apply to it. Not saved. */
  readonly mask: Uint8Array
  readonly maskTex: THREE.DataTexture
  private maskDirty = false
  readonly material: THREE.ShaderMaterial
  readonly group = new THREE.Group()

  /** Incremented whenever heights reach the GPU (lets other views resync). */
  heightsVersion = 0
  private chunks: THREE.Mesh[] = []
  private chunksPerSide: number
  private dirty = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
  private splatDirty = false

  constructor(size: number, cellSize = CELL_SIZE) {
    if (size % CHUNK_CELLS !== 0) throw new Error(`map size ${size} is not a multiple of ${CHUNK_CELLS}`)
    this.size = size
    this.verts = size + 1
    this.cellSize = cellSize
    this.worldSize = size * cellSize
    this.splatRes = size * SPLAT_PER_CELL
    this.paintChunksPerSide = chunksPerSide(size)
    this.heights = new Float32Array(this.verts * this.verts)
    this.weights = new Uint8Array(this.splatRes * this.splatRes * SLOTS)
    this.chunkSlots = new Uint8Array(this.paintChunksPerSide * this.paintChunksPerSide * SLOTS).fill(NO_TEXTURE)
    // Every texel starts as palette entry 0, the first ground texture.
    for (let i = 0; i < this.weights.length; i += SLOTS) this.weights[i] = 255
    for (let c = 0; c < this.paintChunksPerSide * this.paintChunksPerSide; c++) this.chunkSlots[c * SLOTS] = 0

    this.weightTex = this.makeDataTexture(this.weights, this.splatRes, this.splatRes)
    this.slotTex = this.makeDataTexture(this.chunkSlots, this.paintChunksPerSide, this.paintChunksPerSide)
    this.palette = new PaletteArray((t) => (this.material.uniforms.palette.value = t))
    this.mask = new Uint8Array(this.splatRes * this.splatRes)
    this.maskTex = new THREE.DataTexture(this.mask, this.splatRes, this.splatRes, THREE.RedFormat, THREE.UnsignedByteType)
    this.maskTex.magFilter = this.maskTex.minFilter = THREE.LinearFilter
    this.maskTex.needsUpdate = true
    this.material = createTerrainMaterial(
      this.palette.texture,
      this.slotTex,
      this.weightTex,
      this.worldSize,
      this.cellSize,
      CHUNK_CELLS * this.cellSize,
      this.paintChunksPerSide,
    )
    this.material.uniforms.maskTex.value = this.maskTex
    this.chunksPerSide = Math.ceil(size / CHUNK)
    this.buildChunks()
    this.group.name = 'terrain'
  }

  /** Nearest-sampled RGBA texture over a byte array of four values per texel. */
  private makeDataTexture(data: Uint8Array, w: number, h: number) {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
    t.generateMipmaps = false
    t.needsUpdate = true
    return t
  }

  /** Draws a line at every tile edge, for a map of client tiles: `cells` is a tile's width in cells, 0 to hide them. */
  setTileBorders(cells: number) {
    this.material.uniforms.tileWorld.value = cells * this.cellSize
  }

  /** Sets the map's texture palette (see PaletteArray). */
  setPalette(paths: string[]) {
    this.palette.set(paths)
  }

  private buildChunks() {
    for (let cz = 0; cz < this.chunksPerSide; cz++) {
      for (let cx = 0; cx < this.chunksPerSide; cx++) {
        const cells = Math.min(CHUNK, this.size - cx * CHUNK)
        const cellsZ = Math.min(CHUNK, this.size - cz * CHUNK)
        const vx = cells + 1
        const vz = cellsZ + 1
        const pos = new Float32Array(vx * vz * 3)
        const nor = new Float32Array(vx * vz * 3)
        const idx = new Uint32Array(cells * cellsZ * 6)
        let k = 0
        for (let z = 0; z < cellsZ; z++) {
          for (let x = 0; x < cells; x++) {
            const a = z * vx + x
            const b = a + 1
            const c = a + vx
            const d = c + 1
            // Alternate diagonals for a less directional look.
            if ((x + z) & 1) {
              idx[k++] = a; idx[k++] = c; idx[k++] = b
              idx[k++] = b; idx[k++] = c; idx[k++] = d
            } else {
              idx[k++] = a; idx[k++] = c; idx[k++] = d
              idx[k++] = a; idx[k++] = d; idx[k++] = b
            }
          }
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
        geo.setIndex(new THREE.BufferAttribute(idx, 1))
        const mesh = new THREE.Mesh(geo, this.material)
        mesh.userData = { cx, cz, vx, vz, ox: cx * CHUNK, oz: cz * CHUNK }
        mesh.matrixAutoUpdate = false
        mesh.castShadow = true
        mesh.receiveShadow = true
        this.chunks.push(mesh)
        this.group.add(mesh)
        this.writeChunk(mesh)
      }
    }
  }

  private writeChunk(mesh: THREE.Mesh) {
    const { vx, vz, ox, oz } = mesh.userData as { vx: number; vz: number; ox: number; oz: number }
    const geo = mesh.geometry
    const pos = geo.attributes.position.array as Float32Array
    const nor = geo.attributes.normal.array as Float32Array
    const V = this.verts
    const h = this.heights
    const cs = this.cellSize
    for (let z = 0; z < vz; z++) {
      const gz = oz + z
      for (let x = 0; x < vx; x++) {
        const gx = ox + x
        const i = (z * vx + x) * 3
        const hc = h[gz * V + gx]
        pos[i] = gx * cs
        pos[i + 1] = hc
        pos[i + 2] = gz * cs
        const hl = h[gz * V + Math.max(gx - 1, 0)]
        const hr = h[gz * V + Math.min(gx + 1, V - 1)]
        const hd = h[Math.max(gz - 1, 0) * V + gx]
        const hu = h[Math.min(gz + 1, V - 1) * V + gx]
        let nx = hl - hr
        let ny = 2 * cs
        let nz = hd - hu
        const len = Math.hypot(nx, ny, nz)
        nx /= len; ny /= len; nz /= len
        nor[i] = nx
        nor[i + 1] = ny
        nor[i + 2] = nz
      }
    }
    geo.attributes.position.needsUpdate = true
    geo.attributes.normal.needsUpdate = true
    geo.computeBoundingSphere()
    geo.computeBoundingBox()
  }

  /** Mark a vertex-space rect (inclusive) as changed. */
  markDirty(x0: number, z0: number, x1: number, z1: number) {
    const d = this.dirty
    d.x0 = Math.min(d.x0, x0 - 1)
    d.z0 = Math.min(d.z0, z0 - 1)
    d.x1 = Math.max(d.x1, x1 + 1)
    d.z1 = Math.max(d.z1, z1 + 1)
  }

  markAllDirty() {
    this.markDirty(0, 0, this.size, this.size)
    this.splatDirty = true
  }

  markSplatDirty() {
    this.splatDirty = true
  }

  markMaskDirty() {
    this.maskDirty = true
  }

  /** Push pending edits to the GPU. Call once per frame. */
  update() {
    const d = this.dirty
    if (d.x1 >= d.x0) {
      const c0x = Math.max(0, Math.floor(d.x0 / CHUNK))
      const c0z = Math.max(0, Math.floor(d.z0 / CHUNK))
      const c1x = Math.min(this.chunksPerSide - 1, Math.floor(d.x1 / CHUNK))
      const c1z = Math.min(this.chunksPerSide - 1, Math.floor(d.z1 / CHUNK))
      for (let cz = c0z; cz <= c1z; cz++) {
        for (let cx = c0x; cx <= c1x; cx++) {
          this.writeChunk(this.chunks[cz * this.chunksPerSide + cx])
        }
      }
      d.x0 = d.z0 = Infinity
      d.x1 = d.z1 = -Infinity
      this.heightsVersion++
    }
    if (this.maskDirty) {
      this.maskTex.needsUpdate = true
      this.maskDirty = false
    }
    if (this.splatDirty) {
      this.weightTex.needsUpdate = true
      this.slotTex.needsUpdate = true
      this.splatDirty = false
    }
  }

  /** Bilinear height at world position. */
  heightAt(x: number, z: number): number {
    const fx = THREE.MathUtils.clamp(x / this.cellSize, 0, this.size)
    const fz = THREE.MathUtils.clamp(z / this.cellSize, 0, this.size)
    const x0 = Math.min(Math.floor(fx), this.size - 1)
    const z0 = Math.min(Math.floor(fz), this.size - 1)
    const tx = fx - x0
    const tz = fz - z0
    const V = this.verts
    const h = this.heights
    const a = h[z0 * V + x0]
    const b = h[z0 * V + x0 + 1]
    const c = h[(z0 + 1) * V + x0]
    const e = h[(z0 + 1) * V + x0 + 1]
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + e) * tx * tz
  }

  contains(x: number, z: number) {
    return x >= 0 && z >= 0 && x <= this.worldSize && z <= this.worldSize
  }

  /** Ray-march the heightmap. Much cheaper than triangle raycasts. */
  raycast(ray: THREE.Ray, out: THREE.Vector3, maxDist = 4000): boolean {
    const step = this.cellSize * 0.5
    const o = ray.origin
    const dir = ray.direction
    // Skip ahead to the terrain's bounding box.
    let t = 0
    const box = new THREE.Box3(
      new THREE.Vector3(0, -1000, 0),
      new THREE.Vector3(this.worldSize, 1000, this.worldSize),
    )
    const hit = new THREE.Vector3()
    if (!box.containsPoint(o)) {
      if (!ray.intersectBox(box, hit)) return false
      t = hit.distanceTo(o)
    }
    let prevT = t
    let prevAbove = true
    for (; t < maxDist; t += step) {
      const x = o.x + dir.x * t
      const y = o.y + dir.y * t
      const z = o.z + dir.z * t
      if (!this.contains(x, z)) {
        if (t > 0 && !prevAbove) break
        prevT = t
        continue
      }
      const above = y > this.heightAt(x, z)
      if (!above) {
        // Binary refine between prevT and t.
        let lo = prevT, hi = t
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) * 0.5
          const mx = o.x + dir.x * mid
          const mz = o.z + dir.z * mid
          if (o.y + dir.y * mid > this.heightAt(mx, mz)) lo = mid
          else hi = mid
        }
        out.copy(dir).multiplyScalar(hi).add(o)
        return true
      }
      prevAbove = above
      prevT = t
    }
    return false
  }

  /** Procedural starting terrain. */
  generate(kind: GenerateKind, seed: number) {
    const V = this.verts
    const h = this.heights
    const s = this.size
    for (let z = 0; z < V; z++) {
      for (let x = 0; x < V; x++) {
        const u = x / s
        const v = z / s
        let y = 0
        switch (kind) {
          case 'ocean':
            // Empty map: a flat seabed well below the water surface.
            y = OCEAN_FLOOR
            break
          case 'flat':
            y = 0
            break
          case 'hills':
            y = (fbm(u * 4, v * 4, 5, seed) - 0.5) * 24
            break
          case 'mountains': {
            const base = fbm(u * 3, v * 3, 5, seed)
            const r = ridged(u * 2.5, v * 2.5, 6, seed + 7)
            const mask = THREE.MathUtils.smoothstep(base, 0.4, 0.75)
            y = (base - 0.45) * 20 + r * r * 90 * mask
            break
          }
          case 'island': {
            const dx = u - 0.5
            const dz = v - 0.5
            const d = Math.sqrt(dx * dx + dz * dz) * 2
            const n = fbm(u * 5, v * 5, 5, seed)
            const r = ridged(u * 3, v * 3, 5, seed + 3)
            y = (1 - THREE.MathUtils.smoothstep(d, 0.35, 0.95)) * (8 + n * 14 + r * r * 40) - 6
            break
          }
        }
        h[z * V + x] = y
      }
    }
    this.markAllDirty()
  }

  /**
   * Paint sand/grass/rock/snow based on height and slope. Role r of the procedural layers is
   * palette entry roleTex[r]. Each paint chunk keeps the four roles that fit it best.
   */
  autoPaint(waterLevel: number, waterEnabled: boolean, roleTex: number[] = [0, 1, 2, 3, 4, 5, 6, 7]) {
    const R = this.splatRes
    const roles = LAYER_COUNT
    const w = new Float32Array(roles)
    let maxH = -Infinity
    for (let i = 0; i < this.heights.length; i++) maxH = Math.max(maxH, this.heights[i])
    const snowLine = Math.max(waterLevel + 30, maxH * 0.72)
    const packed = packRoles(this.paintChunksPerSide, R, roles, (i, j, out) => {
      const x = ((i + 0.5) / R) * this.worldSize
      const z = ((j + 0.5) / R) * this.worldSize
      const y = this.heightAt(x, z)
      const e = 0.6
      const slope =
        Math.hypot(this.heightAt(x + e, z) - this.heightAt(x - e, z), this.heightAt(x, z + e) - this.heightAt(x, z - e)) /
        (2 * e)
      w.fill(0)
      const n = fbm(x * 0.03, z * 0.03, 3, 99)
      w[n > 0.55 ? 1 : 0] = 1
      if (n > 0.62) w[2] = 0.4
      if (waterEnabled && y < waterLevel + 1.2) {
        const t = THREE.MathUtils.clamp((waterLevel + 1.2 - y) / 1.2, 0, 1)
        w[4] += t * 3
      }
      if (y > snowLine) w[5] += THREE.MathUtils.clamp((y - snowLine) / 6, 0, 1) * 4
      if (slope > 0.7) w[3] += THREE.MathUtils.clamp((slope - 0.7) * 3, 0, 4)
      for (let k = 0; k < roles; k++) out[k] = w[k] * 255
    })
    this.weights.set(packed.weights)
    for (let k = 0; k < packed.chunkSlots.length; k++) {
      const role = packed.chunkSlots[k]
      this.chunkSlots[k] = role === NO_TEXTURE ? NO_TEXTURE : roleTex[role] ?? 0
    }
    this.splatDirty = true
  }

  dispose() {
    for (const c of this.chunks) c.geometry.dispose()
    this.material.dispose()
    this.weightTex.dispose()
    this.slotTex.dispose()
    this.palette.dispose()
    this.maskTex.dispose()
  }
}
