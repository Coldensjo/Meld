import type { Terrain } from '../terrain/Terrain'
import { LAYER_COUNT } from '../terrain/layers'
import type { Command } from '../state/history'

export interface Rect {
  x0: number
  z0: number
  x1: number
  z1: number
}

/**
 * Brush footprint used by forEachVertex/forEachTexel. Brush tools set this
 * from the editor state at the start of each tick.
 */
export const brushShape = { square: false }

/** Normalised brush distance: circle (euclidean) or square (chebyshev). */
function brushDist(dx: number, dz: number, radius: number) {
  return (brushShape.square ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz)) / radius
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

/** Brush weight for normalised distance t in [0,1]. falloff 0 = hard edge. */
export function brushWeight(t: number, falloff: number): number {
  if (t >= 1) return 0
  const hard = 1 - falloff
  if (t <= hard) return 1
  const s = (t - hard) / (1 - hard)
  return 1 - s * s * (3 - 2 * s)
}

/** Iterate heightmap vertices under a circular brush. Returns touched rect. */
export function forEachVertex(
  terrain: Terrain,
  cx: number,
  cz: number,
  radius: number,
  falloff: number,
  fn: (index: number, w: number, x: number, z: number) => void,
): Rect | null {
  const cs = terrain.cellSize
  const x0 = Math.max(0, Math.floor((cx - radius) / cs))
  const z0 = Math.max(0, Math.floor((cz - radius) / cs))
  const x1 = Math.min(terrain.size, Math.ceil((cx + radius) / cs))
  const z1 = Math.min(terrain.size, Math.ceil((cz + radius) / cs))
  if (x1 < x0 || z1 < z0) return null
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

/** Iterate splat texels under a circular brush. Returns touched texel rect. */
export function forEachTexel(
  terrain: Terrain,
  cx: number,
  cz: number,
  radius: number,
  falloff: number,
  fn: (pixel: number, w: number) => void,
): Rect | null {
  const R = terrain.splatRes
  const ts = terrain.worldSize / R
  const x0 = Math.max(0, Math.floor((cx - radius) / ts))
  const z0 = Math.max(0, Math.floor((cz - radius) / ts))
  const x1 = Math.min(R - 1, Math.ceil((cx + radius) / ts))
  const z1 = Math.min(R - 1, Math.ceil((cz + radius) / ts))
  if (x1 < x0 || z1 < z0) return null
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const d = brushDist((x + 0.5) * ts - cx, (z + 0.5) * ts - cz, radius)
      const w = brushWeight(d, falloff)
      if (w > 0) fn(z * R + x, w)
    }
  }
  return { x0, z0, x1, z1 }
}

const weights = new Float32Array(LAYER_COUNT)

/** Add `amount` (0..1) of `layer` to a splat pixel, keeping the sum at 255. */
export function paintPixel(terrain: Terrain, pixel: number, layer: number, amount: number) {
  const A = terrain.splatA
  const B = terrain.splatB
  const p = pixel * 4
  for (let k = 0; k < 4; k++) {
    weights[k] = A[p + k]
    weights[k + 4] = B[p + k]
  }
  const cur = weights[layer]
  const next = Math.min(255, cur + amount * 255)
  let others = 0
  for (let k = 0; k < LAYER_COUNT; k++) if (k !== layer) others += weights[k]
  const scale = others > 0 ? (255 - next) / others : 0
  for (let k = 0; k < LAYER_COUNT; k++) weights[k] = k === layer ? next : weights[k] * scale
  if (others === 0) weights[layer] = 255
  for (let k = 0; k < 4; k++) {
    A[p + k] = Math.round(weights[k])
    B[p + k] = Math.round(weights[k + 4])
  }
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

/**
 * Records a brush stroke for undo. Snapshots the touched layers at stroke
 * start, tracks the dirty rect, and on finish stores only that sub-rect.
 */
export class TerrainStroke {
  private hBefore: Float32Array | null = null
  private aBefore: Uint8Array | null = null
  private bBefore: Uint8Array | null = null
  private hRect: Rect | null = null
  private sRect: Rect | null = null

  constructor(
    private terrain: Terrain,
    private label: string,
    opts: { heights?: boolean; splat?: boolean },
    private onHeightsChanged?: (r: Rect) => void,
  ) {
    if (opts.heights) this.hBefore = terrain.heights.slice()
    if (opts.splat) {
      this.aBefore = terrain.splatA.slice()
      this.bBefore = terrain.splatB.slice()
    }
  }

  touchHeights(r: Rect | null) {
    this.hRect = grow(this.hRect, r)
  }

  touchSplat(r: Rect | null) {
    this.sRect = grow(this.sRect, r)
  }

  finish(): Command | null {
    const t = this.terrain
    const parts: Array<{ apply: (before: boolean) => void }> = []
    if (this.hBefore && this.hRect) {
      const r = this.hRect
      const before = extract(this.hBefore, t.verts, 1, r)
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
    if (this.aBefore && this.bBefore && this.sRect) {
      const r = this.sRect
      const R = t.splatRes
      const aB = extract(this.aBefore, R, 4, r)
      const aA = extract(t.splatA, R, 4, r)
      const bB = extract(this.bBefore, R, 4, r)
      const bA = extract(t.splatB, R, 4, r)
      parts.push({
        apply: (b) => {
          inject(t.splatA, R, 4, r, b ? aB : aA)
          inject(t.splatB, R, 4, r, b ? bB : bA)
          t.markSplatDirty()
        },
      })
    }
    this.hBefore = this.aBefore = this.bBefore = null
    if (!parts.length) return null
    return {
      label: this.label,
      undo: () => parts.forEach((p) => p.apply(true)),
      redo: () => parts.forEach((p) => p.apply(false)),
    }
  }
}
