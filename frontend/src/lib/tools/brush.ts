import type { Terrain } from '../terrain/Terrain'
import { CHUNK_CELLS, SLOTS, SPLAT_PER_CELL, acquireSlotCompacting, addWeight, chunkOf, compactChunk } from '../terrain/chunkPaint'
import type { Command } from '../state/history'
import { BlockSnapshot } from './blockSnapshot'

export interface Rect {
  x0: number
  z0: number
  x1: number
  z1: number
}

export { brushShape, brushWeight, FALLOFF_CURVES, type FalloffCurve } from './falloff'
import { brushShape, brushWeight } from './falloff'

/** Normalised brush distance: circle (euclidean) or square (chebyshev). */
export function brushDist(dx: number, dz: number, radius: number) {
  return (brushShape.square ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.sqrt(dx * dx + dz * dz)) / radius
}

/**
 * Brush centre, optionally snapped so a square brush's edges sit on cell
 * lines (for tile-aligned square painting).
 */
export function brushCenter(x: number, z: number, radius: number, cellSize: number, snap: boolean): [number, number] {
  if (!snap) return [x, z]
  const s = (v: number) => Math.round((v - radius) / cellSize) * cellSize + radius
  return [s(x), s(z)]
}

/**
 * Iterate heightmap vertices under a circular brush. Returns touched rect. A `stroke` that records
 * heights saves the rect's blocks first, so what `fn` writes can be undone.
 */
export function forEachVertex(
  terrain: Terrain,
  cx: number,
  cz: number,
  radius: number,
  falloff: number,
  fn: (index: number, w: number, x: number, z: number) => void,
  stroke?: TerrainStroke | null,
): Rect | null {
  const cs = terrain.cellSize
  const x0 = Math.max(0, Math.floor((cx - radius) / cs))
  const z0 = Math.max(0, Math.floor((cz - radius) / cs))
  const x1 = Math.min(terrain.size, Math.ceil((cx + radius) / cs))
  const z1 = Math.min(terrain.size, Math.ceil((cz + radius) / cs))
  if (x1 < x0 || z1 < z0) return null
  stroke?.reserveHeights({ x0, z0, x1, z1 })
  const V = terrain.verts
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const d = brushDist(x * cs - cx, z * cs - cz, radius)
      const w = brushWeight(d, falloff)
      if (w > 0) fn(z * V + x, w, x, z)
    }
  }
  return { x0, z0, x1, z1 }
}

/**
 * Iterate splat texels under a circular brush. Returns touched texel rect. A `stroke` that records the
 * paint or the mask saves the rect's chunks first, so what `fn` writes can be undone.
 */
export function forEachTexel(
  terrain: Terrain,
  cx: number,
  cz: number,
  radius: number,
  falloff: number,
  fn: (pixel: number, w: number) => void,
  stroke?: TerrainStroke | null,
): Rect | null {
  const R = terrain.splatRes
  const ts = terrain.worldSize / R
  const x0 = Math.max(0, Math.floor((cx - radius) / ts))
  const z0 = Math.max(0, Math.floor((cz - radius) / ts))
  const x1 = Math.min(R - 1, Math.ceil((cx + radius) / ts))
  const z1 = Math.min(R - 1, Math.ceil((cz + radius) / ts))
  if (x1 < x0 || z1 < z0) return null
  stroke?.reserveTexels({ x0, z0, x1, z1 })
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const d = brushDist((x + 0.5) * ts - cx, (z + 0.5) * ts - cz, radius)
      const w = brushWeight(d, falloff)
      if (w > 0) fn(z * R + x, w)
    }
  }
  return { x0, z0, x1, z1 }
}

/** Splat texels along one side of a paint chunk. */
const TEXELS_PER_CHUNK = CHUNK_CELLS * SPLAT_PER_CELL

/**
 * Adds `amount` (0 to 1) of palette texture `tex` to a splat texel, in the paint chunk that holds
 * it. A chunk already holding SLOTS other textures (the 1.12 limit) refuses it (returns false), so
 * the stroke can tell the user; replacing one of them is the Layers panel's Replace or Swap mode.
 */
export function paintPixel(terrain: Terrain, pixel: number, tex: number, amount: number): boolean {
  const R = terrain.splatRes
  const x = pixel % R
  const z = Math.floor(pixel / R)
  const c = chunkOf(Math.floor(x / TEXELS_PER_CHUNK), Math.floor(z / TEXELS_PER_CHUNK), terrain.paintChunksPerSide)
  const k = acquireSlotCompacting(terrain.paintChunksPerSide, R, terrain.chunkSlots, terrain.weights, c, tex)
  if (k < 0) return false
  addWeight(terrain.weights, pixel * SLOTS, k, amount)
  return true
}

function grow(r: Rect | null, add: Rect | null): Rect | null {
  if (!add) return r
  if (!r) return { ...add }
  r.x0 = Math.min(r.x0, add.x0)
  r.z0 = Math.min(r.z0, add.z0)
  r.x1 = Math.max(r.x1, add.x1)
  r.z1 = Math.max(r.z1, add.z1)
  return r
}

function extract(src: Float32Array | Uint8Array, width: number, ch: number, r: Rect) {
  const w = r.x1 - r.x0 + 1
  const h = r.z1 - r.z0 + 1
  const out = new (src.constructor as Float32ArrayConstructor | Uint8ArrayConstructor)(w * h * ch)
  for (let z = 0; z < h; z++) {
    const s = ((r.z0 + z) * width + r.x0) * ch
    out.set(src.subarray(s, s + w * ch), z * w * ch)
  }
  return out
}

function inject(dst: Float32Array | Uint8Array, width: number, ch: number, r: Rect, data: Float32Array | Uint8Array) {
  const w = r.x1 - r.x0 + 1
  const h = r.z1 - r.z0 + 1
  for (let z = 0; z < h; z++) {
    const d = ((r.z0 + z) * width + r.x0) * ch
    dst.set(data.subarray(z * w * ch, (z + 1) * w * ch), d)
  }
}

/** Cells a side of the blocks a stroke saves: the splat's paint chunk, so a chunk's slots are saved whole. */
const SNAPSHOT_BLOCK = TEXELS_PER_CHUNK

/**
 * Records a brush stroke for undo. Before a layer is written, `reserve*` saves the blocks under the
 * rect about to change (the brush iterators do this for a stroke they are given); `touch*` grows the
 * stroke's dirty rect after the write; and `finish` stores that sub-rect, before and after.
 */
export class TerrainStroke {
  private hBefore: BlockSnapshot<Float32Array> | null = null
  private wBefore: BlockSnapshot<Uint8Array> | null = null
  private slotsBefore: Uint8Array | null = null
  private mBefore: BlockSnapshot<Uint8Array> | null = null
  private holesBefore: BlockSnapshot<Uint8Array> | null = null
  private hRect: Rect | null = null
  private sRect: Rect | null = null
  private mRect: Rect | null = null
  private holesRect: Rect | null = null

  constructor(
    private terrain: Terrain,
    private label: string,
    opts: { heights?: boolean; splat?: boolean; mask?: boolean; holes?: boolean },
    private onHeightsChanged?: (r: Rect) => void,
  ) {
    const R = terrain.splatRes
    if (opts.heights) this.hBefore = new BlockSnapshot(terrain.heights, terrain.verts, terrain.verts, 1, SNAPSHOT_BLOCK)
    if (opts.splat) {
      this.wBefore = new BlockSnapshot(terrain.weights, R, R, SLOTS, SNAPSHOT_BLOCK)
      this.slotsBefore = terrain.chunkSlots.slice()
    }
    if (opts.mask) this.mBefore = new BlockSnapshot(terrain.mask, R, R, 1, SNAPSHOT_BLOCK)
    if (opts.holes) this.holesBefore = new BlockSnapshot(terrain.holes, terrain.size, terrain.size, 1, SNAPSHOT_BLOCK)
  }

  /** Saves the heights (vertex rect, inclusive) about to be written. */
  reserveHeights(r: Rect | null) {
    if (r) this.hBefore?.reserve(r)
  }

  /** Saves the paint (texel rect, inclusive) about to be written. */
  reserveSplat(r: Rect | null) {
    if (r) this.wBefore?.reserve(r)
  }

  /** Saves the mask (texel rect, inclusive) about to be written. */
  reserveMask(r: Rect | null) {
    if (r) this.mBefore?.reserve(r)
  }

  /** Saves the holes (cell rect, inclusive) about to be written. */
  reserveHoles(r: Rect | null) {
    if (r) this.holesBefore?.reserve(r)
  }

  /** Saves whichever of the paint and the mask the stroke records, under a texel rect about to be written. */
  reserveTexels(r: Rect | null) {
    this.reserveSplat(r)
    this.reserveMask(r)
  }

  /**
   * A write that reached blocks that were not saved first can't be undone there. It's a bug in the
   * caller; the blocks are saved now (too late) so the rest of the stroke still records.
   */
  private late(snap: BlockSnapshot<Float32Array> | BlockSnapshot<Uint8Array> | null, r: Rect | null, what: string) {
    if (!snap || !r || snap.covers(r)) return
    console.warn(`TerrainStroke: ${what} written before they were reserved; undo will not restore them`)
    snap.reserve(r)
  }

  /** A cell rect (inclusive cells) whose holes changed. */
  touchHoles(r: Rect | null) {
    this.late(this.holesBefore, r, 'holes')
    this.holesRect = grow(this.holesRect, r)
  }

  touchMask(r: Rect | null) {
    this.late(this.mBefore, r, 'mask texels')
    this.mRect = grow(this.mRect, r)
  }

  touchHeights(r: Rect | null) {
    this.late(this.hBefore, r, 'heights')
    this.hRect = grow(this.hRect, r)
  }

  touchSplat(r: Rect | null) {
    this.late(this.wBefore, r, 'paint texels')
    this.sRect = grow(this.sRect, r)
  }

  /**
   * Frees the texture slots that the stroke's chunks no longer use, so a chunk whose texture was painted
   * away can take a new one. A chunk is reordered as a whole, so the splat rect grows to cover it and
   * undo restores all of it.
   */
  private settleSlots() {
    const t = this.terrain
    const r = this.sRect
    if (!r) return
    const side = t.paintChunksPerSide
    const per = t.splatRes / side
    let changed = false
    for (let cz = Math.floor(r.z0 / per); cz <= Math.floor(r.z1 / per); cz++) {
      for (let cx = Math.floor(r.x0 / per); cx <= Math.floor(r.x1 / per); cx++) {
        // Painting can free or reassign slots anywhere in a chunk, so undo covers each chunk whole.
        if (compactChunk(side, t.splatRes, t.chunkSlots, t.weights, cz * side + cx)) changed = true
        grow(r, { x0: cx * per, z0: cz * per, x1: cx * per + per - 1, z1: cz * per + per - 1 })
      }
    }
    if (changed) t.markSplatDirty(r)
  }

  finish(): Command | null {
    const t = this.terrain
    const parts: Array<{ apply: (before: boolean) => void }> = []
    if (this.hBefore && this.hRect) {
      const r = this.hRect
      const before = this.hBefore.extract(r)
      const after = extract(t.heights, t.verts, 1, r)
      const cb = this.onHeightsChanged
      parts.push({
        apply: (b) => {
          inject(t.heights, t.verts, 1, r, b ? before : after)
          t.markDirty(r.x0, r.z0, r.x1, r.z1)
          cb?.(r)
        },
      })
    }
    if (this.wBefore && this.slotsBefore) {
      this.settleSlots()
      const slotsAfter = t.chunkSlots.slice()
      const slotsChanged = slotsAfter.some((v, i) => v !== this.slotsBefore![i])
      const r = this.sRect
      const R = t.splatRes
      const wB = r ? this.wBefore.extract(r) : null
      const wA = r ? extract(t.weights, R, SLOTS, r) : null
      if (r || slotsChanged) {
        const slotsBefore = this.slotsBefore
        parts.push({
          apply: (b) => {
            if (r) inject(t.weights, R, SLOTS, r, b ? wB! : wA!)
            t.chunkSlots.set(b ? slotsBefore : slotsAfter)
            t.markSplatDirty(r)
          },
        })
      }
    }
    if (this.mBefore && this.mRect) {
      const r = this.mRect
      const R = t.splatRes
      const before = this.mBefore.extract(r)
      const after = extract(t.mask, R, 1, r)
      parts.push({
        apply: (b) => {
          inject(t.mask, R, 1, r, b ? before : after)
          t.markMaskDirty(r)
        },
      })
    }
    if (this.holesBefore && this.holesRect) {
      const r = this.holesRect
      const n = t.size
      const before = this.holesBefore.extract(r)
      const after = extract(t.holes, n, 1, r)
      parts.push({
        apply: (b) => {
          inject(t.holes, n, 1, r, b ? before : after)
          // The chunk rebuild runs off vertices; a cell's far corner is one past it.
          t.markDirty(r.x0, r.z0, r.x1 + 1, r.z1 + 1)
        },
      })
    }
    this.hBefore = this.wBefore = this.slotsBefore = this.mBefore = this.holesBefore = null
    if (!parts.length) return null
    return {
      label: this.label,
      undo: () => parts.forEach((p) => p.apply(true)),
      redo: () => parts.forEach((p) => p.apply(false)),
    }
  }
}
