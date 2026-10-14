import * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import { editor, prefs, setStatus } from '../state/editor.svelte'
import type { Command } from '../state/history'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import { getAsset } from '../models/assets'
import { groundNormal, tiltToNormal } from '../world/groundTilt'
import { MAX_ATTEMPTS, attemptRate, candidate, fits, newBrush, pickEntry, uniqueName, type DoodadBrush } from './doodadBrush'

/** The brush the Doodad tool paints with: the preference's pick, else the first one; null with none made. */
export function activeDoodadBrush(): DoodadBrush | null {
  const list = prefs.doodadBrushes
  return list.find((b) => b.name === prefs.doodadBrush) ?? list[0] ?? null
}

/** Adds a new, empty brush under a free name and makes it the one painted with. Returns the stored (reactive) brush. */
export function addDoodadBrush(name = 'New brush'): DoodadBrush {
  const b = newBrush(uniqueName(name, prefs.doodadBrushes.map((x) => x.name)))
  prefs.doodadBrushes = [...prefs.doodadBrushes, b]
  prefs.doodadBrush = b.name
  return prefs.doodadBrushes[prefs.doodadBrushes.length - 1]
}

/** Models with a footprint under this are spaced as if this wide, so tufts of grass don't pile onto one spot. */
const MIN_FOOTPRINT = 0.8

/**
 * The Doodad brush: while the button is held, the brush's models land at random points under it,
 * drawn by their weights, each sized, sunk and tilted as its entry says, and never closer to another
 * model than the brush's spacing allows. The falloff thins the placements toward the edge, and the
 * strength sets how fast they come. With Shift held the spacing is ignored, so models stack on top
 * of each other. Ctrl+drag erases the brush's models under it instead. A stroke is one undo step.
 */
export class DoodadBrushTool implements Tool {
  readonly usesBrush = true
  private placed: WorldObject[] | null = null
  private erased: WorldObject[] | null = null
  /** The object layer the stroke started on: undo must restore that map, not whichever tab is active then. */
  private objects: ObjectLayer | null = null
  private acc = 0
  /** Shift is held: placements ignore the spacing and pile up. Read on every pointer event. */
  private stacking = false
  private point = new Float32Array(2)
  /** The models already standing near the brush this tick: x, z and footprint each. */
  private near = new Float32Array(3 * 256)
  private nearCount = 0
  private normal = { x: 0, y: 1, z: 0 }
  private tilt = { tiltX: 0, tiltZ: 0 }
  private size = new THREE.Vector3()

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
    if (!hit) return
    const brush = activeDoodadBrush()
    if (!brush) {
      setStatus('Make a doodad brush first: Edit brush in the options bar, then pick models in the browser below.', 6000)
      return
    }
    this.objects = ctx.objects
    this.stacking = e.shiftKey
    if (e.ctrlKey) {
      this.erased = []
      this.erase(ctx, hit, brush)
      return
    }
    if (brush.entries.length === 0) {
      setStatus(`The brush "${brush.name}" has no models yet. Pick some in the browser below while editing it.`, 6000)
      return
    }
    this.placed = []
    // The first placements land at once, so a click puts something down.
    this.acc = 1
    this.scatter(ctx, hit, brush, 0)
  }

  onMove(_ctx: ToolContext, _hit: THREE.Vector3 | null, e: PointerEvent) {
    this.stacking = e.shiftKey
  }

  tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
    if (!hit) return
    const brush = activeDoodadBrush()
    if (!brush) return
    if (this.erased) this.erase(ctx, hit, brush)
    else if (this.placed) this.scatter(ctx, hit, brush, dt)
  }

  onUp(ctx: ToolContext) {
    const objects = this.objects
    if (objects && this.placed?.length) {
      const saved = this.placed.map((o) => ({ ...o }))
      const cmd: Command = {
        label: 'Doodad brush',
        undo: () => saved.forEach((o) => objects.remove(o.id)),
        redo: () => saved.forEach((o) => objects.add({ ...o })),
      }
      ctx.history.push(cmd)
    }
    if (objects && this.erased?.length) {
      const saved = this.erased.map((o) => ({ ...o }))
      const cmd: Command = {
        label: 'Erase doodads',
        undo: () => saved.forEach((o) => objects.add({ ...o })),
        redo: () => saved.forEach((o) => objects.remove(o.id)),
      }
      ctx.history.push(cmd)
    }
    this.placed = this.erased = this.objects = null
  }

  /** The wider side of a model's footprint at `scale`, in yards. */
  private footprint(type: string, scale: number): number {
    const s = getAsset(type).bbox.getSize(this.size)
    return Math.max(MIN_FOOTPRINT, Math.max(s.x, s.z) * scale)
  }

  /** Gathers the root models within `reach` of the brush into `near`. */
  private gatherNear(ctx: ToolContext, hit: THREE.Vector3, reach: number) {
    let n = 0
    const r2 = reach * reach
    for (const o of ctx.objects.objects.values()) {
      if (o.parent !== undefined) continue
      const dx = o.x - hit.x
      const dz = o.z - hit.z
      if (dx * dx + dz * dz > r2) continue
      if (n * 3 + 3 > this.near.length) {
        const grown = new Float32Array(this.near.length * 2)
        grown.set(this.near)
        this.near = grown
      }
      this.near[n * 3] = o.x
      this.near[n * 3 + 1] = o.z
      this.near[n * 3 + 2] = this.footprint(o.type, o.scale)
      n++
    }
    this.nearCount = n
  }

  private pushNear(x: number, z: number, size: number) {
    const n = this.nearCount
    if (n * 3 + 3 > this.near.length) {
      const grown = new Float32Array(this.near.length * 2)
      grown.set(this.near)
      this.near = grown
    }
    this.near[n * 3] = x
    this.near[n * 3 + 1] = z
    this.near[n * 3 + 2] = size
    this.nearCount = n + 1
  }

  private scatter(ctx: ToolContext, hit: THREE.Vector3, brush: DoodadBrush, dt: number) {
    const { radius, strength, falloff, curve } = editor.brush
    this.acc += attemptRate(radius, strength * ctx.pressure()) * dt
    let attempts = Math.min(MAX_ATTEMPTS, Math.floor(this.acc))
    if (attempts <= 0) return
    this.acc -= attempts
    // Models of a brush are at most a few yards wide; what stands a little beyond the brush still
    // keeps a placement at the edge away.
    if (this.stacking) this.nearCount = 0
    else this.gatherNear(ctx, hit, radius + 8 * Math.max(1, brush.spacing))
    const t = ctx.terrain
    const sea = editor.doodad.avoidWater && editor.waterEnabled ? editor.waterLevel : -Infinity
    while (attempts-- > 0) {
      if (!candidate(hit.x, hit.z, radius, falloff, curve, Math.random, this.point)) continue
      const x = this.point[0]
      const z = this.point[1]
      if (!t.contains(x, z) || t.isHole(x, z)) continue
      if (t.heightAt(x, z) < sea) continue
      const i = pickEntry(brush, Math.random())
      if (i < 0) return
      const e = brush.entries[i]
      const scale = e.scaleMin + Math.random() * (e.scaleMax - e.scaleMin)
      const size = this.footprint(e.type, scale)
      if (!this.stacking && !fits(x, z, size, brush.spacing, this.near, this.nearCount)) continue
      const rotY = editor.doodad.randomRot ? Math.random() * Math.PI * 2 : 0
      let tilt: { tiltX?: number; tiltZ?: number } = {}
      if (editor.followGround) {
        groundNormal((px, pz) => t.heightAt(px, pz), x, z, t.cellSize, editor.followGroundSmooth, this.normal)
        tiltToNormal(this.normal.x, this.normal.y, this.normal.z, rotY, this.tilt)
        tilt = { ...this.tilt }
      } else if (e.tilt > 0) {
        const lim = (e.tilt * Math.PI) / 180
        tilt = { tiltX: (Math.random() * 2 - 1) * lim, tiltZ: (Math.random() * 2 - 1) * lim }
      }
      const o = ctx.objects.add({ type: e.type, x, z, yOff: e.sink, rotY, scale, ...tilt })
      this.placed!.push(o)
      if (!this.stacking) this.pushNear(x, z, size)
    }
  }

  /** Removes the brush's models (with anything attached to them) whose ground point is under the brush. */
  private erase(ctx: ToolContext, hit: THREE.Vector3, brush: DoodadBrush) {
    const types = new Set(brush.entries.map((e) => e.type))
    const r2 = editor.brush.radius * editor.brush.radius
    const gone = new Set<number>()
    for (const o of ctx.objects.objects.values()) {
      if (o.parent !== undefined || !types.has(o.type)) continue
      const dx = o.x - hit.x
      const dz = o.z - hit.z
      if (dx * dx + dz * dz > r2) continue
      for (const id of ctx.objects.descendantIds(o.id)) gone.add(id)
    }
    for (const id of gone) {
      const o = ctx.objects.objects.get(id)
      if (!o) continue
      this.erased!.push({ ...o })
      ctx.objects.remove(id)
      if (editor.selected?.id === id) editor.selected = null
    }
  }
}
