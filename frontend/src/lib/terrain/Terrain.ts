import * as THREE from 'three'
import { fbm } from '../engine/noise'
import { presetHeight, type PresetId } from './presets'
import { createTerrainMaterial } from './TerrainMaterial'
import { LAYER_COUNT } from './layers'
import { PaletteArray } from './paletteArray'
import { CHUNK_CELLS, NO_TEXTURE, SLOTS, SPLAT_PER_CELL, chunksPerSide, packRoles } from './chunkPaint'
import { holeTriangle, triangleIsHole, writeCellIndex } from './holes'
import { DirtyRegion, uploadRect, type DirtyRect } from './dirtyRect'
import { CHUNK_IMPASSABLE, areaColor } from './chunkFlags'
import { SHADOW_PER_CELL, unpackShadowBits } from './bakedShadows'

export type { DirtyRect } from './dirtyRect'

/** A 1.12 tile is 1600/3 yards across: 128 cells of this size, the grid the server's maps use. */
export const TILE_YARDS = 1600 / 3
/** Default cell size in yards: 128 cells make one tile. */
export const CELL_SIZE = TILE_YARDS / 128
export { OCEAN_FLOOR } from './presets'
const CHUNK = 32 // render chunk side, in cells (independent of the 1.12 paint chunks)

/** A starting shape (see presets.ts). */
export type GenerateKind = PresetId

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
  /** One byte per cell: non-zero where the ground is cut out (see holes.ts). A hole draws nothing and isn't picked. */
  readonly holes: Uint8Array
  /** Counts the edits of `holes`, so a view of them (the hole walls) knows when to rebuild. */
  holesVersion = 0
  /**
   * One byte per cell: non-zero where the client's tile grows no ground effect doodads (its
   * noEffectDoodad bits, under roads and buildings). Read from a region, painted with the Map data
   * tool, and kept in the map file.
   */
  readonly noEffect: Uint8Array
  /** One AreaTable.dbc ID per paint chunk (an MCNK), 0 for none, which the chunk's header names. */
  readonly areaIds: Uint32Array
  /** One byte of flags per paint chunk: CHUNK_IMPASSABLE (chunkFlags.ts) where players can't walk it. */
  readonly chunkFlags: Uint8Array
  /** Counts the edits of `noEffect`, `areaIds` and `chunkFlags`, so their overlay knows when to redraw. */
  chunkDataVersion = 0
  /**
   * The Map data tool's overlay, made on first use: a texel per chunk (its zone's colour, and the
   * impassable flag in alpha) and a texel per cell (the no-effect cells). Uploaded whole by `update`
   * after an edit; both are small next to the paint.
   */
  private chunkDataTex: THREE.DataTexture | null = null
  private noEffectTex: THREE.DataTexture | null = null
  private chunkDataDirty = false
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
  /** The baked shadows' texture, over `shadow`'s bytes; null without. */
  private bakedTex: THREE.DataTexture | null = null
  /**
   * The baked shadows (MCSH), a byte per texel (255 in shadow), `shadowSide` texels a side; null while
   * the map has none of its own (a region then keeps the client's). Read from a region or the map
   * file, baked or painted (B-057), saved in the map file and sent on export. Write it through
   * `ensureShadow` and report the rows with `touchShadow`.
   */
  shadow: Uint8Array | null = null
  readonly shadowSide: number
  /** Whether the Engine has asked the client for this terrain's baked shadows (once per terrain). */
  bakedRequested = false
  /**
   * How far each cell's middle (its MCVT inner height) lies above its four corners' mean in the
   * client's tile, a float a cell, `size` a row; null for a map of its own or until read. The grid
   * keeps only the corners, so this is the walkable-ground view's alone (#284): the server's ground
   * has four triangles a cell about that middle, which the export keeps while the cell's corners keep
   * the client's heights (`innerBase`) and puts at the corners' mean once one has moved (#380). Read
   * from the client once per terrain (`Engine.updateInnerLift`), never saved.
   */
  innerLift: Float32Array | null = null
  /** The client's corner heights `innerLift` is over (`heights`' layout), to tell a sculpted cell. */
  innerBase: Float32Array | null = null
  /** Whether the Engine has asked the client for `innerLift`, and whether the answer is still on its way. */
  innerRequested = false
  innerPending = false
  /** Bumped whenever the mask is marked dirty, so a scan of it can be skipped when nothing changed. */
  maskVersion = 0
  private maskDirty = new DirtyRegion()
  /**
   * CPU-side views of the weights and the mask, never bound to a material. A sub-rect upload reads
   * the changed texels straight from the arrays through them (see uploadRect).
   */
  private weightSrc: THREE.DataTexture
  private maskSrc: THREE.DataTexture
  /**
   * The heights as a float texture, one texel a vertex, made on first use (the sea reads the ground's
   * depth from it), and what changed in it since its last upload. `heightSrc` is its CPU-side view.
   */
  private heightTex: THREE.DataTexture | null = null
  private heightSrc: THREE.DataTexture | null = null
  private heightTexDirty = new DirtyRegion()
  readonly material: THREE.ShaderMaterial
  readonly group = new THREE.Group()

  /** Incremented whenever heights reach the GPU (lets other views resync). */
  heightsVersion = 0
  private chunks: THREE.Mesh[] = []
  private chunksPerSide: number
  private dirty = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
  private splatDirty = new DirtyRegion()
  /** Scratch for uploadRegion. */
  private uploadBox = new THREE.Box2()
  private uploadPos = new THREE.Vector2()

  constructor(size: number, cellSize = CELL_SIZE) {
    if (size % CHUNK_CELLS !== 0) throw new Error(`map size ${size} is not a multiple of ${CHUNK_CELLS}`)
    this.size = size
    this.verts = size + 1
    this.cellSize = cellSize
    this.worldSize = size * cellSize
    this.splatRes = size * SPLAT_PER_CELL
    this.paintChunksPerSide = chunksPerSide(size)
    this.heights = new Float32Array(this.verts * this.verts)
    this.holes = new Uint8Array(size * size)
    this.noEffect = new Uint8Array(size * size)
    this.shadowSide = size * SHADOW_PER_CELL
    this.areaIds = new Uint32Array(this.paintChunksPerSide * this.paintChunksPerSide)
    this.chunkFlags = new Uint8Array(this.paintChunksPerSide * this.paintChunksPerSide)
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
    // Linear filtering never reads mipmaps; without this a partial upload would rebuild them.
    this.maskTex.generateMipmaps = false
    this.maskTex.needsUpdate = true
    this.weightSrc = new THREE.DataTexture(this.weights, this.splatRes, this.splatRes, THREE.RGBAFormat)
    this.maskSrc = new THREE.DataTexture(this.mask, this.splatRes, this.splatRes, THREE.RedFormat, THREE.UnsignedByteType)
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
        // The index has room for every cell; hole cells are left out when the chunk is written.
        const idx = new Uint32Array(cells * cellsZ * 6)
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
        geo.setIndex(new THREE.BufferAttribute(idx, 1))
        const mesh = new THREE.Mesh(geo, this.material)
        mesh.userData = { cx, cz, vx, vz, cells, cellsZ, ox: cx * CHUNK, oz: cz * CHUNK }
        mesh.matrixAutoUpdate = false
        mesh.castShadow = true
        mesh.receiveShadow = true
        this.chunks.push(mesh)
        this.group.add(mesh)
        this.writeChunk(mesh)
      }
    }
  }

  /**
   * Shows only the chunks that meet one of `frustums` (the doorways of the WMO room the camera is
   * in), or every chunk for null.
   */
  gate(frustums: THREE.Frustum[] | null) {
    for (const c of this.chunks) {
      if (!frustums) {
        c.visible = true
        continue
      }
      const g = c.geometry
      if (!g.boundingBox) g.computeBoundingBox()
      let seen = false
      for (let k = 0; !seen && k < frustums.length; k++) seen = frustums[k].intersectsBox(g.boundingBox!)
      c.visible = seen
    }
  }

  private writeChunk(mesh: THREE.Mesh) {
    const { vx, vz, cells, cellsZ, ox, oz } = mesh.userData as { vx: number; vz: number; cells: number; cellsZ: number; ox: number; oz: number }
    const geo = mesh.geometry
    const pos = geo.attributes.position.array as Float32Array
    const nor = geo.attributes.normal.array as Float32Array
    const idx = geo.index!
    const count = writeCellIndex(idx.array as Uint32Array, cells, cellsZ, vx, ox, oz, this.holes, this.size)
    geo.setDrawRange(0, count)
    idx.needsUpdate = true
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
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
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
  /** Says `holes` changed (every writer of it calls this, TerrainStroke for the undoable ones). */
  touchHoles() {
    this.holesVersion++
  }

  /** Bumped whenever heights or paint change, for layers that rebuild from them (the ground effects). */
  heightVersion = 0
  paintVersion = 0

  markDirty(x0: number, z0: number, x1: number, z1: number) {
    this.heightVersion++
    const d = this.dirty
    d.x0 = Math.min(d.x0, x0 - 1)
    d.z0 = Math.min(d.z0, z0 - 1)
    d.x1 = Math.max(d.x1, x1 + 1)
    d.z1 = Math.max(d.z1, z1 + 1)
  }

  markAllDirty() {
    this.markDirty(0, 0, this.size, this.size)
    this.markSplatDirty()
  }

  /**
   * The weights (and chunk slots) changed. With `rect`, an inclusive texel rect, only those texels are
   * uploaded on the next update; without one the whole weights texture is.
   */
  markSplatDirty(rect?: DirtyRect | null) {
    this.paintVersion++
    this.splatDirty.mark(rect)
  }

  /** The mask changed, in the inclusive texel `rect` or (without one) anywhere. */
  markMaskDirty(rect?: DirtyRect | null) {
    this.maskVersion++
    this.maskDirty.mark(rect)
  }

  /**
   * Uploads what `region` says changed in `dst`: its rect from `src`, a never-bound view of the same
   * array, when the renderer is there and the rect is small enough, else the whole texture. `res` is
   * the texture's side.
   */
  private uploadRegion(
    renderer: THREE.WebGLRenderer | undefined,
    region: DirtyRegion,
    src: THREE.DataTexture,
    dst: THREE.DataTexture,
    res = this.splatRes,
  ) {
    const r = renderer && region.rect ? uploadRect(region.rect, res) : 'whole'
    if (r === null) return
    if (r === 'whole') {
      dst.needsUpdate = true
      return
    }
    this.uploadBox.min.set(r.x0, r.z0)
    this.uploadBox.max.set(r.x1 + 1, r.z1 + 1)
    this.uploadPos.set(r.x0, r.z0)
    try {
      renderer!.copyTextureToTexture(src, dst, this.uploadBox, this.uploadPos)
    } catch (err) {
      // A context that can't take a sub-rect upload still gets the whole texture.
      console.warn('partial texture upload failed; uploading the whole texture', err)
      dst.needsUpdate = true
    }
  }

  /**
   * Push pending edits to the GPU. Call once per frame. With the renderer, paint and mask edits upload
   * only the texels that changed; without it the whole textures are re-uploaded.
   */
  update(renderer?: THREE.WebGLRenderer) {
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
      if (this.heightTex) this.heightTexDirty.mark({ x0: d.x0, z0: d.z0, x1: d.x1, z1: d.z1 })
      d.x0 = d.z0 = Infinity
      d.x1 = d.z1 = -Infinity
      this.heightsVersion++
    }
    if (this.heightTexDirty.dirty) {
      this.uploadRegion(renderer, this.heightTexDirty, this.heightSrc!, this.heightTex!, this.verts)
      this.heightTexDirty.clear()
    }
    if (this.maskDirty.dirty) {
      this.uploadRegion(renderer, this.maskDirty, this.maskSrc, this.maskTex)
      this.maskDirty.clear()
    }
    if (this.chunkDataDirty && this.chunkDataTex && this.noEffectTex) {
      const px = this.chunkDataTex.image.data as Uint8Array
      for (let c = 0; c < this.areaIds.length; c++) {
        areaColor(this.areaIds[c], px, c * 4)
        px[c * 4 + 3] = this.chunkFlags[c] & CHUNK_IMPASSABLE ? 255 : 0
      }
      this.chunkDataTex.needsUpdate = true
      this.noEffectTex.needsUpdate = true
      this.chunkDataDirty = false
    }
    if (this.splatDirty.dirty) {
      this.uploadRegion(renderer, this.splatDirty, this.weightSrc, this.weightTex)
      // The slot table is small, and painting can rename a slot anywhere in a touched chunk.
      this.slotTex.needsUpdate = true
      this.splatDirty.clear()
    }
  }

  /** Marks the area IDs, chunk flags or no-effect cells as edited, for their overlay and the tufts. */
  touchChunkData() {
    this.chunkDataVersion++
    this.chunkDataDirty = true
  }

  /**
   * Shows the Map data overlay: 0 off, 1 the chunks' zones, 2 the impassable chunks, 3 the cells that
   * grow no tufts. Its textures are made the first time it is shown. Cheap to call every frame.
   */
  setMapDataOverlay(mode: number) {
    const u = this.material.uniforms
    if (u.mapDataMode.value === mode) return
    u.mapDataMode.value = mode
    if (!mode || this.chunkDataTex) return
    const side = this.paintChunksPerSide
    this.chunkDataTex = new THREE.DataTexture(new Uint8Array(side * side * 4), side, side, THREE.RGBAFormat)
    this.noEffectTex = new THREE.DataTexture(this.noEffect, this.size, this.size, THREE.RedFormat, THREE.UnsignedByteType)
    for (const t of [this.chunkDataTex, this.noEffectTex]) {
      t.magFilter = t.minFilter = THREE.NearestFilter
      t.generateMipmaps = false
    }
    u.chunkDataTex.value = this.chunkDataTex
    u.noEffectTex.value = this.noEffectTex
    this.chunkDataDirty = true
  }

  /** The heights as a float texture, one texel a vertex, kept up to date by `update`. */
  heightTexture(): THREE.DataTexture {
    if (!this.heightTex) {
      const make = () => {
        const t = new THREE.DataTexture(this.heights, this.verts, this.verts, THREE.RedFormat, THREE.FloatType)
        t.minFilter = t.magFilter = THREE.NearestFilter
        t.generateMipmaps = false
        return t
      }
      this.heightTex = make()
      this.heightTex.needsUpdate = true
      this.heightSrc = make()
    }
    return this.heightTex
  }

  /** Whether the ground under world position (x, z) is a hole: its cell's triangle there is cut. Outside the map counts as solid. */
  isHole(x: number, z: number): boolean {
    const gx = x / this.cellSize
    const gz = z / this.cellSize
    const cx = Math.floor(gx)
    const cz = Math.floor(gz)
    if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return false
    const v = this.holes[cz * this.size + cx]
    return v !== 0 && triangleIsHole(v, holeTriangle(cx, cz, gx - cx, gz - cz))
  }

  /** Whether any cell of the map is a hole. */
  hasHoles(): boolean {
    return this.holes.some((v) => v !== 0)
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
  /**
   * Where `ray` meets the ground, in `out`. The ray passes through holes, so what is below a cave
   * mouth can be picked, unless `solid` is set, which the Hole mode's Fill needs to aim at a hole.
   */
  raycast(ray: THREE.Ray, out: THREE.Vector3, maxDist = 4000, solid = false): boolean {
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
      // The ray passes through holes, so what's below a cave mouth can be picked.
      const above = y > this.heightAt(x, z) || (!solid && this.isHole(x, z))
      if (!above) {
        // Binary refine between prevT and t.
        let lo = prevT, hi = t
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) * 0.5
          const mx = o.x + dir.x * mid
          const mz = o.z + dir.z * mid
          if (o.y + dir.y * mid > this.heightAt(mx, mz) || (!solid && this.isHole(mx, mz))) lo = mid
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

  /** Procedural starting terrain from a preset (see presets.ts). */
  generate(kind: GenerateKind, seed: number) {
    const V = this.verts
    const h = this.heights
    const s = this.size
    for (let z = 0; z < V; z++) {
      for (let x = 0; x < V; x++) h[z * V + x] = presetHeight(kind, x / s, z / s, seed)
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
    this.markSplatDirty()
  }

  /**
   * Sets the baked shadows from their bits (`side` texels a side, see terrain/bakedShadows.ts), which
   * must be this terrain's `shadowSide`; null drops them (the map then has none of its own).
   */
  setBakedShadows(bits: Uint8Array | null, side: number) {
    if (bits && side !== this.shadowSide) throw new Error(`baked shadows are ${side} texels a side, want ${this.shadowSide}`)
    this.setShadow(bits ? unpackShadowBits(bits, side) : null)
  }

  /** Sets the baked shadows to `bytes` (a byte per texel, kept), or none. */
  setShadow(bytes: Uint8Array | null) {
    this.bakedTex?.dispose()
    this.bakedTex = null
    this.shadow = bytes
    if (bytes) {
      const side = this.shadowSide
      const t = new THREE.DataTexture(bytes, side, side, THREE.RedFormat, THREE.UnsignedByteType)
      t.magFilter = t.minFilter = THREE.LinearFilter
      t.generateMipmaps = false
      t.needsUpdate = true
      // Until three has uploaded it whole, a row update must not narrow that first upload.
      this.shadowUploaded = false
      t.onUpdate = () => (this.shadowUploaded = true)
      this.bakedTex = t
    }
    this.material.uniforms.bakedShadowTex.value = this.bakedTex
    this.shadowVersion++
  }

  /** The baked shadows to write into, made all lit first when the map has none. */
  ensureShadow(): Uint8Array {
    if (!this.shadow) this.setShadow(new Uint8Array(this.shadowSide * this.shadowSide))
    return this.shadow!
  }

  /** Bumped by every change of the baked shadows. */
  shadowVersion = 0
  private shadowUploaded = false

  /**
   * After the WebGL context came back (#209): three uploads every texture again by itself, so a row
   * update made while it was gone must not narrow that upload to the row.
   */
  contextRestored() {
    this.bakedTex?.clearUpdateRanges()
    this.shadowUploaded = false
  }

  /** Uploads the shadow texel rows z0 to z1 (inclusive) after they were written. */
  touchShadow(z0: number, z1: number) {
    const t = this.bakedTex
    if (!t) return
    const side = this.shadowSide
    if (this.shadowUploaded) t.addUpdateRange(z0 * side, (z1 - z0 + 1) * side)
    t.needsUpdate = true
    this.shadowVersion++
  }

  /**
   * Drapes the reference image (terrain/referenceImage.ts) over the ground: `tex` at `opacity` (0 or
   * no texture hides it) over `place`, with corner handles `edit` world units across while it is
   * being placed (0 for none). Cheap to call every frame; the texture is the document's, not disposed here.
   */
  setReference(tex: THREE.Texture | null, opacity: number, place: { x: number; z: number; w: number; h: number; turn: number } | null, edit: number) {
    const u = this.material.uniforms
    u.refTex.value = tex
    u.refOpacity.value = tex && place ? opacity : 0
    u.refEdit.value = place ? edit : 0
    if (!place) return
    u.refCentre.value.set(place.x, place.z)
    u.refHalf.value.set(place.w / 2, place.h / 2)
    u.refRot.value.set(Math.cos(place.turn), Math.sin(place.turn))
  }

  /** Draws the baked shadows (when the terrain has any) or not. */
  showBakedShadows(on: boolean) {
    this.material.uniforms.bakedShadowOn.value = on && this.bakedTex ? 1 : 0
  }

  dispose() {
    for (const c of this.chunks) c.geometry.dispose()
    this.bakedTex?.dispose()
    this.material.dispose()
    this.weightTex.dispose()
    this.slotTex.dispose()
    this.palette.dispose()
    this.maskTex.dispose()
    this.weightSrc.dispose()
    this.maskSrc.dispose()
    this.heightTex?.dispose()
    this.heightSrc?.dispose()
    this.chunkDataTex?.dispose()
    this.noEffectTex?.dispose()
  }
}

