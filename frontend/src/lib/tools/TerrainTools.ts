import * as THREE from 'three'
import { holeTriangle, withTriangle } from '../terrain/holes'
import { HoleWalls } from './HoleWalls'
import { editor, setStatus, ui, type SculptMode } from '../state/editor.svelte'
import type { Command } from '../state/history'
import { VertexSelection, flattenVertices, moveVertices, orientVertices, type VertexRect } from './vertexEdit'
import { fbm, ridged } from '../engine/noise'
import type { Tool, ToolContext } from './Tool'
import { TerrainStroke, brushCenter, brushDist, brushShape, forEachTexel, forEachVertex, paintPixel, type Rect } from './brush'
import { angledHeight, creviceDig, creviceRidge, mountainHeight, ridgeScale } from './sculptShapes'
import { dominantTexel, swapTexel } from '../terrain/chunkPaint'
import type { Terrain } from '../terrain/Terrain'
import type { SculptLimit } from '../state/editor.svelte'
import { MAX_DABS, sprayAmount, sprayDabRadius, sprayDabs } from './spray'
import { OCEAN_OPACITY, RIVER_OPACITY, autoOpacity, paintLiquid } from '../water/liquids'
import { LiquidStroke } from '../water/liquidStroke'

/** Shown when a stroke reaches a paint chunk that already has four textures. */
const CHUNK_FULL = 'Not painted: that chunk already has four textures (the 1.12 limit). Replace one in the Layers panel, use Swap mode, or paint with one of its four.'

/** Splat texel under world point (x, z), clamped to the map. */
/** The palette index of the texture with the most weight under world point (x, z), or -1 if none. */
export function layerAt(t: Terrain, x: number, z: number): number {
  return dominantTexel(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, texelAt(t, x, z))
}

function texelAt(t: Terrain, x: number, z: number): number {
  const R = t.splatRes
  const ts = t.worldSize / R
  const tx = Math.min(R - 1, Math.max(0, Math.floor(x / ts)))
  const tz = Math.min(R - 1, Math.max(0, Math.floor(z / ts)))
  return tz * R + tx
}

/** Shared stroke lifecycle for brush tools that modify the terrain. */
abstract class BrushTool implements Tool {
  get usesBrush() {
    return true
  }
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
    ctx.terrain.markSplatDirty(r)
    this.stroke?.touchSplat(r)
  }

  private resnap(ctx: ToolContext, r: Rect) {
    const cs = ctx.terrain.cellSize
    ctx.objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
  }
}

const RAISE_RATE = 18 // world units per second at strength 1
/** Mountain builds much faster than Raise, since a peak is a few hundred units tall. */
const MOUNTAIN_RATE = RAISE_RATE * 4
/** Crevice digs at this rate (the ridges rise with what was dug); faster than Raise since a dragged brush passes each spot briefly. */
const CREVICE_RATE = RAISE_RATE * 2

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

/** Sets heightmap vertices `ids` to `before` on undo and back to their current heights on redo. */
function vertexCommand(ctx: ToolContext, label: string, ids: number[], before: Float32Array, r: VertexRect): Command {
  const t = ctx.terrain
  const objects = ctx.objects
  const after = Float32Array.from(ids, (i) => t.heights[i])
  const apply = (v: Float32Array) => {
    ids.forEach((i, k) => (t.heights[i] = v[k]))
    t.markDirty(r.x0, r.z0, r.x1, r.z1)
    const cs = t.cellSize
    objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
  }
  return { label, undo: () => apply(before), redo: () => apply(after) }
}

/** Most selected vertices drawn as markers. */
const MAX_VERTEX_MARKERS = 65536

/** The sculpt modes that shape the ground under the brush, and so paint it too with Paint texture on. */
const SHAPING_MODES = new Set<SculptMode>(['raise', 'lower', 'smooth', 'flatten', 'noise', 'mountain', 'crevice'])

export class SculptTool extends BrushTool {
  protected label = 'Sculpt'
  /** With Paint texture on, a shaping stroke records the splat too, so the paint undoes with the heights. */
  protected get records() {
    return { heights: true, splat: editor.sculptPaint && SHAPING_MODES.has(editor.sculptMode) }
  }
  /** Hole mode works on the triangle under the cursor, not a brush footprint. */
  get usesBrush() {
    return editor.sculptMode !== 'hole'
  }
  /** Hole mode: whether this stroke restores ground (else it cuts), and the cell rect it touched. */
  private holeFilling = false
  private holeCell = { x0: 0, z0: 0, x1: 0, z1: 0 }
  /** Hole mode's wall handles: drag an edge, + and − for single cells. */
  private walls = new HoleWalls()
  private wallsShown = false
  private flattenTarget = 0
  private scratch = new Float32Array(0)

  // Vertex mode: the selected vertices of `vselTerrain`, whether this stroke moves them (Shift) or
  // deselects (Ctrl or Alt), the last cursor point, and the slope last applied.
  private vsel: VertexSelection | null = null
  private vselTerrain: Terrain | null = null
  private moving = false
  private deselecting = false
  private cursor = new THREE.Vector3()
  private hasCursor = false
  private applied = { angle: 0, dir: 0, ref: 'center' }
  /** The open slope edit, merged into one undo step while it stays on top of the history. */
  private orientSession: { cmd: Command | null; ids: number[]; before: Float32Array } | null = null
  private vcenter = { x: 0, y: 0, z: 0 }
  private markers: THREE.Points | null = null

  /** The vertex selection for the active map; a new map starts with none. */
  private selection(t: Terrain): VertexSelection {
    if (!this.vsel || this.vselTerrain !== t) {
      this.vsel = new VertexSelection(t.verts)
      this.vselTerrain = t
      this.selectionChanged()
    }
    return this.vsel
  }

  /** Resets the slope to level for a new selection, as noggit3 does, and publishes the count. */
  private selectionChanged() {
    editor.vertexAngle = 0
    editor.vertexDir = 0
    this.applied = { angle: 0, dir: 0, ref: editor.vertexRef }
    this.orientSession = null
    ui.vertexCount = this.vsel?.size ?? 0
  }

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent) {
    if (editor.sculptMode === 'hole') {
      if (this.walls.onDown(ctx)) return
      if (!hit) return
      this.holeFilling = editor.holeFill !== !!e?.shiftKey
      this.stroke = new TerrainStroke(ctx.terrain, this.holeFilling ? 'Fill hole' : 'Cut hole', { holes: true })
      this.paintHole(ctx, hit)
      return
    }
    const vertex = editor.sculptMode === 'vertex'
    this.moving = vertex && !!e?.shiftKey
    this.deselecting = vertex && !!(e?.ctrlKey || e?.altKey)
    super.onDown(ctx, hit)
  }

  tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
    if (editor.sculptMode === 'hole') {
      if (this.walls.active) this.walls.onMove(ctx)
      else if (this.stroke && hit) this.paintHole(ctx, hit)
      return
    }
    super.tick(ctx, dt, hit)
  }

  /** Cuts or restores the triangle of the ground under `hit`, as part of the stroke's hole edit. */
  private paintHole(ctx: ToolContext, hit: THREE.Vector3) {
    const t = ctx.terrain
    const gx = hit.x / t.cellSize
    const gz = hit.z / t.cellSize
    const cx = Math.floor(gx)
    const cz = Math.floor(gz)
    if (cx < 0 || cz < 0 || cx >= t.size || cz >= t.size) return
    const i = cz * t.size + cx
    const next = withTriangle(t.holes[i], holeTriangle(cx, cz, gx - cx, gz - cz), !this.holeFilling)
    if (next === t.holes[i]) return
    const r = this.holeCell
    r.x0 = r.x1 = cx
    r.z0 = r.z1 = cz
    this.stroke?.reserveHoles(r)
    t.holes[i] = next
    t.markDirty(cx, cz, cx + 1, cz + 1)
    this.stroke?.touchHoles(r)
  }

  onMove(ctx: ToolContext, _hit: THREE.Vector3 | null, e: PointerEvent) {
    if (!this.moving || !this.stroke) return
    const sel = this.selection(ctx.terrain)
    const r = sel.rect()
    if (!r || !e.movementY) return
    // Shift-drag moves the selection up and down with the mouse, faster at higher strength.
    this.stroke.reserveHeights(r)
    moveVertices(ctx.terrain.heights, sel, -e.movementY * 0.2 * editor.brush.strength * ctx.pressure())
    this.heightsChanged(ctx, r)
  }

  onUp(ctx: ToolContext) {
    this.walls.onUp(ctx)
    super.onUp(ctx)
    if (editor.sculptMode === 'vertex' && !this.moving) {
      const sel = this.selection(ctx.terrain)
      if (sel.size !== ui.vertexCount) this.selectionChanged()
    }
    this.moving = false
  }

  frame(ctx: ToolContext, hit: THREE.Vector3 | null) {
    // The hole walls show in Hole mode only.
    const hole = editor.sculptMode === 'hole'
    if (hole !== this.wallsShown) {
      this.wallsShown = hole
      if (hole) this.walls.attach(ctx.scene)
      else this.walls.detach(ctx.scene)
    }
    if (hole) this.walls.frame(ctx)
    if (hit) {
      this.cursor.copy(hit)
      this.hasCursor = true
    }
    const sel = editor.sculptMode === 'vertex' ? this.selection(ctx.terrain) : null
    const a = this.applied
    if (sel && sel.size && (editor.vertexAngle !== a.angle || editor.vertexDir !== a.dir || editor.vertexRef !== a.ref)) this.orient(ctx, sel)
    this.drawMarkers(ctx, sel)
  }

  deactivate(ctx: ToolContext) {
    this.drawMarkers(ctx, null)
    this.walls.detach(ctx.scene)
    this.wallsShown = false
  }

  onKey(ctx: ToolContext, e: KeyboardEvent) {
    if (editor.sculptMode !== 'vertex' || e.key !== ' ') return false
    // Space turns the slope to rise from the cursor toward the selection centre.
    const sel = this.selection(ctx.terrain)
    if (!sel.size || !this.hasCursor) return true
    const c = sel.center(ctx.terrain.heights, ctx.terrain.cellSize, this.vcenter)
    const deg = (Math.atan2(c.z - this.cursor.z, c.x - this.cursor.x) * 180) / Math.PI
    editor.vertexDir = Math.round((deg + 360) % 360)
    return true
  }

  /** Vertex mode actions from the options bar: flatten the selection to its mean height, or clear it. */
  vertexAction(ctx: ToolContext, action: 'flatten' | 'clear') {
    const sel = this.selection(ctx.terrain)
    if (action === 'clear') {
      sel.clear()
      this.selectionChanged()
      return
    }
    const r = sel.rect()
    if (!r) return
    const h = ctx.terrain.heights
    const ids = sel.ids.slice()
    const before = Float32Array.from(ids, (i) => h[i])
    flattenVertices(h, sel, sel.center(h, ctx.terrain.cellSize, this.vcenter).y)
    this.heightsChanged(ctx, r)
    ctx.history.push(vertexCommand(ctx, 'Vertex flatten', ids, before, r))
    this.selectionChanged()
  }

  /** Lays the selection onto the slope plane, as one undo step per run of slope changes. */
  private orient(ctx: ToolContext, sel: VertexSelection) {
    const t = ctx.terrain
    const r = sel.rect()
    if (!r) return
    let s = this.orientSession
    if (!s || !s.cmd || ctx.history.peek() !== s.cmd) {
      const ids = sel.ids.slice()
      s = { cmd: null, ids, before: Float32Array.from(ids, (i) => t.heights[i]) }
    }
    const ref = editor.vertexRef === 'cursor' && this.hasCursor ? this.cursor : sel.center(t.heights, t.cellSize, this.vcenter)
    orientVertices(t.heights, sel, t.cellSize, ref, editor.vertexAngle, editor.vertexDir)
    this.heightsChanged(ctx, r)
    const cmd = vertexCommand(ctx, 'Vertex slope', s.ids, s.before, r)
    if (s.cmd) ctx.history.replaceTop(cmd)
    else ctx.history.push(cmd)
    s.cmd = cmd
    this.orientSession = s
    this.applied = { angle: editor.vertexAngle, dir: editor.vertexDir, ref: editor.vertexRef }
  }

  /** Draws a dot on each selected vertex. Hidden when `sel` is null or empty. */
  private drawMarkers(ctx: ToolContext, sel: VertexSelection | null) {
    const n = sel ? Math.min(sel.size, MAX_VERTEX_MARKERS) : 0
    if (!n || !sel) {
      if (this.markers) this.markers.visible = false
      return
    }
    let m = this.markers
    const cap = m ? m.geometry.attributes.position.count : 0
    if (!m || cap < n) {
      if (m) {
        ctx.scene.remove(m)
        m.geometry.dispose()
      }
      let size = Math.max(256, cap)
      while (size < n) size *= 2
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(size * 3), 3).setUsage(THREE.DynamicDrawUsage))
      const mat = m ? (m.material as THREE.PointsMaterial) : new THREE.PointsMaterial({ color: 0xffb020, size: 5, sizeAttenuation: false, depthTest: false })
      m = new THREE.Points(geo, mat)
      m.frustumCulled = false
      m.renderOrder = 10
      this.markers = m
    }
    if (m.parent !== ctx.scene) ctx.scene.add(m)
    const t = ctx.terrain
    const V = t.verts
    const cs = t.cellSize
    const pos = m.geometry.attributes.position as THREE.BufferAttribute
    const a = pos.array as Float32Array
    for (let k = 0; k < n; k++) {
      const i = sel.ids[k]
      const x = i % V
      a[k * 3] = x * cs
      a[k * 3 + 1] = t.heights[i] + 0.1
      a[k * 3 + 2] = ((i - x) / V) * cs
    }
    pos.needsUpdate = true
    m.geometry.setDrawRange(0, n)
    m.visible = true
  }

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
    const { radius, falloff } = editor.brush
    const rate = editor.brush.strength * ctx.pressure() * dt
    const mode = editor.sculptMode
    // The edit limit compares each vertex with the height under the cursor.
    const limit = editor.sculptLimit
    const cursorY = hit.y
    let rect: Rect | null = null

    if (mode === 'vertex') {
      // The brush selects vertices (Ctrl or Alt deselects); a Shift stroke moves them in onMove instead.
      if (this.moving) return
      const sel = this.selection(t)
      const off = this.deselecting
      forEachVertex(t, hit.x, hit.z, radius, 0, (i) => (off ? sel.remove(i) : sel.add(i)))
      return
    }

    switch (mode) {
      case 'raise':
      case 'lower': {
        const s = (mode === 'raise' ? 1 : -1) * RAISE_RATE * rate
        rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w) => {
          if (keeps(h[i], limit, cursorY)) h[i] += s * w
        }, this.stroke)
        break
      }
      case 'flatten': {
        const k = Math.min(1, rate * 8)
        const target = this.flattenTarget
        const dir = editor.flattenDir
        // Angled: the target is a plane through the stroke's start, pivoting there like noggit's.
        const ang = editor.flattenAngled
        const angled = ang.on && ang.angle !== 0
        const ox = this.strokeStart.x
        const oz = this.strokeStart.z
        const cs = t.cellSize
        rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w, x, z) => {
          const d = (angled ? angledHeight(x * cs, z * cs, ox, target, oz, ang.angle, ang.orientation) : target) - h[i]
          // Raise-only and lower-only leave ground on the far side of the target alone.
          if ((dir === 'raise' && d <= 0) || (dir === 'lower' && d >= 0)) return
          if (keeps(h[i], limit, cursorY)) h[i] += d * w * k
        }, this.stroke)
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
        }, this.stroke)
        break
      }
      case 'noise': {
        const s = RAISE_RATE * rate * 0.6
        const cs = t.cellSize
        rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w, x, z) => {
          if (keeps(h[i], limit, cursorY)) h[i] += (fbm(x * cs * 0.08, z * cs * 0.08, 4, 5) - 0.5) * 2 * s * w
        }, this.stroke)
        break
      }
      case 'mountain': {
        // A peak the size of the brush: the ridge noise is sampled in world space, so holding the
        // brush in place keeps piling the same ridges higher, and its features scale with the brush.
        const s = MOUNTAIN_RATE * rate
        const cs = t.cellSize
        const f = 1.2 / radius
        const ridges = editor.mountain.ridges
        rect = forEachVertex(t, hit.x, hit.z, radius, 1, (i, _w, x, z) => {
          if (!keeps(h[i], limit, cursorY)) return
          const wx = x * cs
          const wz = z * cs
          const n = ridged(wx * f, wz * f, 5, 13)
          h[i] += mountainHeight(brushDist(wx - hit.x, wz - hit.z, radius), n * n, ridges) * s
        }, this.stroke)
        break
      }
      case 'crevice': {
        // Dig the solid centre and pile the dug ground onto the falloff band, so dragging the brush
        // ploughs a path with ridges along both sides. Pass one sums the two profiles over the brush
        // so the ridge can hold exactly what the trench loses.
        const s = CREVICE_RATE * rate
        const cs = t.cellSize
        let dig = 0
        let ridge = 0
        forEachVertex(t, hit.x, hit.z, radius, 0, (i, _w, x, z) => {
          if (!keeps(h[i], limit, cursorY)) return
          const d = brushDist(x * cs - hit.x, z * cs - hit.z, radius)
          dig += creviceDig(d, falloff)
          ridge += creviceRidge(d, falloff)
        })
        const k = ridgeScale(dig, ridge) * editor.crevice.ridge
        rect = forEachVertex(t, hit.x, hit.z, radius, 0, (i, _w, x, z) => {
          if (!keeps(h[i], limit, cursorY)) return
          const d = brushDist(x * cs - hit.x, z * cs - hit.z, radius)
          h[i] += (creviceRidge(d, falloff) * k - creviceDig(d, falloff)) * s
        }, this.stroke)
        break
      }
    }
    this.heightsChanged(ctx, rect)

    // Paint texture: the shaped ground takes the chosen texture, as much of the brush as the mode shapes.
    if (rect && editor.sculptPaint && SHAPING_MODES.has(mode)) {
      const pf = mode === 'mountain' ? 1 : mode === 'crevice' ? 0 : falloff
      const amt = Math.min(1, editor.brush.strength * ctx.pressure() * dt * 5)
      let refused = 0
      const sr = forEachTexel(t, hit.x, hit.z, radius, pf, (p, w) => {
        if (!paintPixel(t, p, editor.sculptPaintLayer, amt * w)) refused++
      }, this.stroke)
      if (refused) setStatus(CHUNK_FULL, 3000)
      this.splatChanged(ctx, sr)
    }
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
      }, this.stroke)
      if (rect) {
        ctx.terrain.markMaskDirty(rect)
        this.stroke?.touchMask(rect)
      }
      return
    }
    const { radius, falloff } = editor.brush
    const strength = editor.brush.strength * ctx.pressure()
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
    }, this.stroke)
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
    const { radius, falloff } = editor.brush
    const strength = editor.brush.strength * ctx.pressure()
    const amt = Math.min(1, strength * dt * 5)
    let refused = 0
    const t = ctx.terrain
    const rect = forEachTexel(t, hit.x, hit.z, radius, falloff, (p, w) => {
      if (!swapTexel(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, p, from, to, amt * w)) refused++
    }, this.stroke)
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
    }, this.stroke)
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
      }, this.stroke)
      this.heightsChanged(ctx, hr)
    }
  }
}

/** The depth factor the water brush's opacity setting picks for liquid `id`. */
export function waterOpacityFactor(id: number): number {
  const w = editor.water
  switch (w.opacity) {
    case 'river':
      return RIVER_OPACITY
    case 'ocean':
      return OCEAN_OPACITY
    case 'custom':
      return w.customOpacity
    default:
      return autoOpacity(id)
  }
}

/**
 * The Water tool. In Paint mode it is noggit's water brush: LMB adds the chosen liquid under the brush,
 * Ctrl+LMB removes liquid (see paintLiquid). Dig lake and Raise shore shape the ground relative to the
 * sea level instead.
 */
export class WaterTool extends BrushTool {
  protected label = 'Water'
  protected records = { heights: true }
  private liquidStroke: LiquidStroke | null = null
  private removing = false

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent) {
    if (editor.waterMode !== 'paint') return super.onDown(ctx, hit)
    if (!hit) return
    this.removing = !!e?.ctrlKey
    this.liquidStroke = new LiquidStroke(ctx.liquids, this.removing ? 'Remove water' : 'Paint water')
  }

  onUp(ctx: ToolContext) {
    if (!this.liquidStroke) return super.onUp(ctx)
    const cmd = this.liquidStroke.finish()
    this.liquidStroke = null
    if (cmd) ctx.history.push(cmd)
  }

  tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
    if (!this.liquidStroke) return super.tick(ctx, dt, hit)
    if (!hit) return
    const w = editor.water
    const deg = THREE.MathUtils.degToRad
    paintLiquid(
      ctx.liquids,
      ctx.terrain,
      {
        x: hit.x,
        y: hit.y,
        z: hit.z,
        radius: editor.brush.radius,
        id: w.liquid,
        add: !this.removing,
        angle: w.angled ? deg(w.angle) : 0,
        orientation: w.angled ? deg(w.orientation) : 0,
        lock: w.lock,
        origin: w.lockPos,
        overrideHeight: w.overrideHeight,
        overrideId: w.overrideId,
        opacity: waterOpacityFactor(w.liquid),
      },
      this.liquidStroke.reserve,
    )
  }

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
      }, this.stroke)
    } else {
      const shore = lvl + 0.6
      rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w) => {
        if (h[i] < shore && keeps(h[i], limit, cursorY)) h[i] += (shore - h[i]) * w * k
      }, this.stroke)
    }
    this.heightsChanged(ctx, rect)
  }
}
