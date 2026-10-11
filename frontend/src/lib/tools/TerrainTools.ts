import * as THREE from 'three'
import { editor } from '../state/editor.svelte'
import { fbm, ridged } from '../engine/noise'
import type { Tool, ToolContext } from './Tool'
import { TerrainStroke, brushCenter, brushShape, forEachTexel, forEachVertex, paintPixel, type Rect } from './brush'

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

export class SculptTool extends BrushTool {
  protected label = 'Sculpt'
  protected records = { heights: true }
  private flattenTarget = 0
  private scratch = new Float32Array(0)

  protected begin(ctx: ToolContext, hit: THREE.Vector3) {
    this.flattenTarget = ctx.terrain.heightAt(hit.x, hit.z)
    this.label = 'Sculpt: ' + editor.sculptMode
  }

  protected apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
    const t = ctx.terrain
    const h = t.heights
    const { radius, strength, falloff } = editor.brush
    const rate = strength * dt
    const mode = editor.sculptMode
    let rect: Rect | null = null

    switch (mode) {
      case 'raise':
      case 'lower': {
        const s = (mode === 'raise' ? 1 : -1) * RAISE_RATE * rate
        rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w) => (h[i] += s * w))
        break
      }
      case 'flatten': {
        const k = Math.min(1, rate * 8)
        const target = this.flattenTarget
        rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w) => (h[i] += (target - h[i]) * w * k))
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
          h[i] += (fbm(x * cs * 0.08, z * cs * 0.08, 4, 5) - 0.5) * 2 * s * w
        })
        break
      }
      case 'mountain': {
        const s = RAISE_RATE * rate * 1.6
        const cs = t.cellSize
        rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w, x, z) => {
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

  protected get records() {
    return editor.paintMode === 'mask' ? { mask: true } : { splat: true }
  }

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent) {
    this.label = editor.paintMode === 'mask' ? 'Mask' : 'Paint'
    this.erasing = editor.maskErase || !!e?.altKey
    super.onDown(ctx, hit)
  }

  protected apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
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
    const layer = editor.paintLayer
    const amt = Math.min(1, strength * dt * 5)
    const rect = forEachTexel(ctx.terrain, hit.x, hit.z, radius, falloff, (p, w) =>
      paintPixel(ctx.terrain, p, layer, amt * w),
    )
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
    const sr = forEachTexel(t, hit.x, hit.z, width, 0.25, (p, w) => paintPixel(t, p, editor.paintLayer, amt * w))
    this.splatChanged(ctx, sr)

    if (editor.roadFlatten) {
      const target = t.heightAt(hit.x, hit.z)
      const k = Math.min(1, strength * dt * 6)
      const h = t.heights
      const hr = forEachVertex(t, hit.x, hit.z, width * 1.4, 0.5, (i, w) => (h[i] += (target - h[i]) * w * k))
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
    let rect: Rect | null
    if (editor.waterMode === 'dig') {
      const floor = lvl - 4
      rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w) => {
        if (h[i] > floor) h[i] += (floor - h[i]) * w * k
      })
    } else {
      const shore = lvl + 0.6
      rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w) => {
        if (h[i] < shore) h[i] += (shore - h[i]) * w * k
      })
    }
    this.heightsChanged(ctx, rect)
  }
}
