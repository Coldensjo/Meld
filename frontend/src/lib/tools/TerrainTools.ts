import * as THREE from 'three'
import { editor, setStatus } from '../state/editor.svelte'
import { fbm, ridged } from '../engine/noise'
import type { Tool, ToolContext } from './Tool'
import { TerrainStroke, brushCenter, brushShape, forEachTexel, forEachVertex, paintPixel, type Rect } from './brush'
import { dominantTexel, swapTexel } from '../terrain/chunkPaint'
import type { Terrain } from '../terrain/Terrain'
import type { SculptLimit } from '../state/editor.svelte'
import { MAX_DABS, sprayAmount, sprayDabRadius, sprayDabs } from './spray'

/** Shown when a stroke reaches a paint chunk that already has four textures. */
const CHUNK_FULL = 'That chunk already has four textures (the 1.12 limit). Paint with one of them, or erase another.'

/** Splat texel under world point (x, z), clamped to the map. */
function texelAt(t: Terrain, x: number, z: number): number {
  const R = t.splatRes
  const ts = t.worldSize / R
  const tx = Math.min(R - 1, Math.max(0, Math.floor(x / ts)))
  const tz = Math.min(R - 1, Math.max(0, Math.floor(z / ts)))
  return tz * R + tx
}

/** Shared stroke lifecycle for brush tools that modify the terrain. */
abstract class BrushTool implements Tool {
  readonly usesBrush = true
  protected stroke: TerrainStroke | null = null
  protected abstract label: string
  protected abstract records: { heights?: boolean; splat?: boolean; mask?: boolean }
  protected strokeStart = new THREE.Vector3()

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null) {
    if (!hit) return
    this.strokeStart.copy(hit)
    this.stroke = new TerrainStroke(ctx.terrain, this.label, this.records, (r) => this.resnap(ctx, r))
    this.begin(ctx, hit)
  }

  onUp(ctx: ToolContext) {
    if (!this.stroke) return
    const cmd = this.stroke.finish()
    this.stroke = null
    if (cmd) ctx.history.push(cmd)
  }

  private center = new THREE.Vector3()

  /** Radius of the brush footprint (roads use a narrower one). */
  radius(): number {
    return editor.brush.radius
  }

  tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
    if (!this.stroke || !hit) return
    brushShape.square = editor.brush.shape === 'square'
    brushShape.curve = editor.brush.curve
    const [x, z] = brushCenter(hit.x, hit.z, this.radius(), ctx.terrain.cellSize, brushShape.square && editor.brush.snap)
    this.apply(ctx, dt, this.center.set(x, hit.y, z))
  }

  protected begin(_ctx: ToolContext, _hit: THREE.Vector3) {}
  protected abstract apply(ctx: ToolContext, dt: number, hit: THREE.Vector3): void

  protected heightsChanged(ctx: ToolContext, r: Rect | null) {
    if (!r) return
    ctx.terrain.markDirty(r.x0, r.z0, r.x1, r.z1)
    this.stroke?.touchHeights(r)
    this.resnap(ctx, r)
  }

  protected splatChanged(ctx: ToolContext, r: Rect | null) {
    if (!r) return
    ctx.terrain.markSplatDirty()
    this.stroke?.touchSplat(r)
  }

  private resnap(ctx: ToolContext, r: Rect) {
    const cs = ctx.terrain.cellSize
    ctx.objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
  }
}

const RAISE_RATE = 18 // world units per second at strength 1

/** Weighted mean height under the brush: the flatten target when it averages. */
function averageHeight(t: Terrain, x: number, z: number, radius: number, falloff: number): number {
  const h = t.heights
  let sum = 0
  let weight = 0
  forEachVertex(t, x, z, radius, falloff, (i, w) => {
    sum += h[i] * w
    weight += w
  })
  return weight > 0 ? sum / weight : t.heightAt(x, z)
}

/** Whether ground at height `v` may change under the sculpt limit, given the cursor's height. */
function keeps(v: number, limit: SculptLimit, cursorY: number): boolean {
  return limit === 'none' || (limit === 'above' ? v > cursorY : v < cursorY)
}

export class SculptTool extends BrushTool {
  protected label = 'Sculpt'
  protected records = { heights: true }
  private flattenTarget = 0
  private scratch = new Float32Array(0)

  protected begin(ctx: ToolContext, hit: THREE.Vector3) {
    const { radius, falloff } = editor.brush
    this.flattenTarget =
      editor.flattenTarget === 'average'
        ? averageHeight(ctx.terrain, hit.x, hit.z, radius, falloff)
        : ctx.terrain.heightAt(hit.x, hit.z)
    this.label = 'Sculpt: ' + editor.sculptMode
  }

  protected apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
    const t = ctx.terrain
    const h = t.heights
    const { radius, strength, falloff } = editor.brush
    const rate = strength * dt
    const mode = editor.sculptMode
    // The edit limit compares each vertex with the height under the cursor.
    const limit = editor.sculptLimit
    const cursorY = hit.y
    let rect: Rect | null = null

    switch (mode) {
      case 'raise':
      case 'lower': {
        const s = (mode === 'raise' ? 1 : -1) * RAISE_RATE * rate
        rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w) => {
          if (keeps(h[i], limit, cursorY)) h[i] += s * w
        })
        break
      }
      case 'flatten': {
        const k = Math.min(1, rate * 8)
        const target = this.flattenTarget
        const dir = editor.flattenDir
        rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w) => {
          const d = target - h[i]
          // Raise-only and lower-only leave ground on the far side of the target alone.
          if ((dir === 'raise' && d <= 0) || (dir === 'lower' && d >= 0)) return
          if (keeps(h[i], limit, cursorY)) h[i] += d * w * k
        })
        break
      }
      case 'smooth': {
        // Box-blur from a snapshot so the result is order independent.
        const V = t.verts
        if (this.scratch.length !== h.length) this.scratch = new Float32Array(h.length)
        this.scratch.set(h)
        const src = this.scratch
        const k = Math.min(1, rate * 10)
        rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w, x, z) => {
          if (!keeps(h[i], limit, cursorY)) return
          let sum = 0, n = 0
          for (let dz = -1; dz <= 1; dz++) {
            const zz = z + dz
            if (zz < 0 || zz >= V) continue
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx
              if (xx < 0 || xx >= V) continue
              sum += src[zz * V + xx]
              n++
            }
          }
          h[i] += (sum / n - h[i]) * w * k
        })
        break
      }
      case 'noise': {
        const s = RAISE_RATE * rate * 0.6
        const cs = t.cellSize
        rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w, x, z) => {
          if (keeps(h[i], limit, cursorY)) h[i] += (fbm(x * cs * 0.08, z * cs * 0.08, 4, 5) - 0.5) * 2 * s * w
        })
        break
      }
      case 'mountain': {
        const s = RAISE_RATE * rate * 1.6
        const cs = t.cellSize
        rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w, x, z) => {
          if (!keeps(h[i], limit, cursorY)) return
          const r = ridged(x * cs * 0.025, z * cs * 0.025, 5, 13)
          h[i] += r * r * s * w * w
        })
        break
      }
    }
    this.heightsChanged(ctx, rect)
  }
}

export class PaintTool extends BrushTool {
  protected label = 'Paint'
  private erasing = false
  /** Swap mode: the palette texture under the stroke's start, which the stroke replaces. */
  private swapFrom = -1

  protected get records() {
    return editor.paintMode === 'mask' ? { mask: true } : { splat: true }
  }

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent) {
    this.label = editor.paintMode === 'mask' ? 'Mask' : editor.paintMode === 'swap' ? 'Swap' : 'Paint'
    this.erasing = editor.maskErase || !!e?.altKey
    const t = ctx.terrain
    this.swapFrom =
      hit && editor.paintMode === 'swap' ? dominantTexel(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, texelAt(t, hit.x, hit.z)) : -1
    if (this.swapFrom >= 0 && this.swapFrom === editor.paintLayer) setStatus('That spot already uses the active texture.', 3000)
    super.onDown(ctx, hit)
  }

  protected apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
    if (editor.paintMode === 'swap') {
      this.swap(ctx, dt, hit)
      return
    }
    if (editor.paintMode === 'mask') {
      // Mask brush: hard-edged by falloff, full strength; Alt (or Erase) removes.
      const { radius, falloff } = editor.brush
      const m = ctx.terrain.mask
      const erase = this.erasing
      const rect = forEachTexel(ctx.terrain, hit.x, hit.z, radius, falloff, (p, w) => {
        const v = Math.round(w * 255)
        m[p] = erase ? Math.min(m[p], 255 - v) : Math.max(m[p], v)
      })
      if (rect) {
        ctx.terrain.markMaskDirty()
        this.stroke?.touchMask(rect)
      }
      return
    }
    const { radius, strength, falloff } = editor.brush
    if (!editor.paintSpray) {
      if (this.paintAt(ctx, hit.x, hit.z, radius, falloff, Math.min(1, strength * dt * 5))) setStatus(CHUNK_FULL, 3000)
      return
    }
    // Spray: random dabs over the brush, plus the brush's solid centre when Inner radius is on.
    const t = ctx.terrain
    const { size, pressure, inner } = editor.spray
    const dab = sprayDabRadius(size, t.worldSize / t.splatRes)
    const amt = sprayAmount(strength)
    const n = sprayDabs(hit.x, hit.z, radius, dab, pressure, dt, Math.random, this.dabs)
    let refused = false
    for (let i = 0; i < n; i++) refused = this.paintAt(ctx, this.dabs[i * 2], this.dabs[i * 2 + 1], dab, falloff, amt) || refused
    if (inner && falloff < 1) refused = this.paintAt(ctx, hit.x, hit.z, radius * (1 - falloff), falloff, Math.min(1, strength * dt * 5)) || refused
    if (refused) setStatus(CHUNK_FULL, 3000)
  }

  /** Spray dab centres for one frame, as x, z pairs. */
  private dabs = new Float32Array(MAX_DABS * 2)

  /** Paints the active layer in a circle. Returns true when a chunk refused it for having four textures. */
  private paintAt(ctx: ToolContext, x: number, z: number, radius: number, falloff: number, amt: number): boolean {
    const tex = editor.paintLayer
    let refused = false
    const rect = forEachTexel(ctx.terrain, x, z, radius, falloff, (p, w) => {
      if (!paintPixel(ctx.terrain, p, tex, amt * w)) refused = true
    })
    this.splatChanged(ctx, rect)
    return refused
  }

  onKey(_ctx: ToolContext, e: KeyboardEvent) {
    if (e.key !== 't' && e.key !== 'T') return false
    editor.paintSpray = !editor.paintSpray
    if (editor.paintSpray) editor.paintMode = 'texture'
    setStatus(editor.paintSpray ? 'Spray on' : 'Spray off', 1500)
    return true
  }

  /** Moves the stroke's starting texture onto the active layer under the brush. */
  private swap(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
    const from = this.swapFrom
    const to = editor.paintLayer
    if (from < 0 || from === to) return
    const { radius, strength, falloff } = editor.brush
    const amt = Math.min(1, strength * dt * 5)
    let refused = 0
    const t = ctx.terrain
    const rect = forEachTexel(t, hit.x, hit.z, radius, falloff, (p, w) => {
      if (!swapTexel(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, p, from, to, amt * w)) refused++
    })
    if (refused) setStatus(CHUNK_FULL, 3000)
    this.splatChanged(ctx, rect)
  }
}

/** Paints the selected texture with a hard edge and levels the ground across it. */
export class RoadTool extends BrushTool {
  protected label = 'Road'
  protected records = { heights: true, splat: true }

  radius() {
    return Math.max(1.5, editor.brush.radius * 0.5)
  }

  protected apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
    const t = ctx.terrain
    const { radius, strength } = editor.brush
    const width = this.radius()
    const amt = Math.min(1, strength * dt * 8)
    let refused = 0
    const sr = forEachTexel(t, hit.x, hit.z, width, 0.25, (p, w) => {
      if (!paintPixel(t, p, editor.paintLayer, amt * w)) refused++
    })
    if (refused) setStatus(CHUNK_FULL, 3000)
    this.splatChanged(ctx, sr)

    if (editor.roadFlatten) {
      const target = t.heightAt(hit.x, hit.z)
      const k = Math.min(1, strength * dt * 6)
      const h = t.heights
      const limit = editor.sculptLimit
      const cursorY = hit.y
      const hr = forEachVertex(t, hit.x, hit.z, width * 1.4, 0.5, (i, w) => {
        if (keeps(h[i], limit, cursorY)) h[i] += (target - h[i]) * w * k
      })
      this.heightsChanged(ctx, hr)
    }
  }
}

/** Shapes the ground relative to the water level: dig lakes or raise shores. */
export class WaterTool extends BrushTool {
  protected label = 'Water'
  protected records = { heights: true }

  protected apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
    const t = ctx.terrain
    const h = t.heights
    const { radius, strength, falloff } = editor.brush
    const k = Math.min(1, strength * dt * 4)
    const lvl = editor.waterLevel
    const limit = editor.sculptLimit
    const cursorY = hit.y
    let rect: Rect | null
    if (editor.waterMode === 'dig') {
      const floor = lvl - 4
      rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w) => {
        if (h[i] > floor && keeps(h[i], limit, cursorY)) h[i] += (floor - h[i]) * w * k
      })
    } else {
      const shore = lvl + 0.6
      rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w) => {
        if (h[i] < shore && keeps(h[i], limit, cursorY)) h[i] += (shore - h[i]) * w * k
      })
    }
    this.heightsChanged(ctx, rect)
  }
}
