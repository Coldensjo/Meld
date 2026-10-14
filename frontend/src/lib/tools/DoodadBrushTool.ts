import * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import { editor, prefs, setStatus, setViewportHint } from '../state/editor.svelte'
import type { Command } from '../state/history'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import { getAsset } from '../models/assets'
import { hasSkeleton, modelMesh } from '../world/Animator'
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

/** Most models the preview shows (and the press puts down first): a quarter second of the brush, at least one. */
const MAX_PREVIEW = 32

/** One placement drawn ahead of time, relative to the brush centre. */
interface Planned {
  dx: number
  dz: number
  entry: number
  scale: number
  rotY: number
  /** The entry's random tilt (Follow ground rotation replaces it at placement). */
  tiltX: number
  tiltZ: number
  /** The footprint at this scale, for the spacing. */
  size: number
}

/**
 * The Doodad brush: while the button is held, the brush's models land at random points under it,
 * drawn by their weights, each sized, sunk and tilted as its entry says, and never closer to another
 * model than the brush's spacing allows. The falloff thins the placements toward the edge, and the
 * strength sets how fast they come. With Shift held the spacing is ignored, so models stack on top
 * of each other. Ctrl+drag erases the brush's models under it instead. A stroke is one undo step.
 *
 * While the brush hovers, the next placements are drawn ahead (`plan`) and shown as ghost models
 * under it; the press puts those down first, then goes on at random, and a new plan is drawn when
 * the stroke ends or the brush changes. Ctrl+scroll (or R) spins the planned cluster about the
 * brush centre. A model still loading (or one that failed) shows no ghost rather than a placeholder.
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
  /** The placements drawn ahead, shown as ghosts and put down first on the press. */
  private plan: Planned[] = []
  /** What the plan was drawn for; a change of brush or settings draws a new one. */
  private planKey = ''
  /** How far the plan has been spun (for the hint); a new plan starts afresh. */
  private spun = 0
  private ghosts: THREE.Mesh[] = []
  private ghostGroup = new THREE.Group()

  constructor() {
    this.ghostGroup.renderOrder = 20
  }

  activate(ctx: ToolContext) {
    ctx.scene.add(this.ghostGroup)
  }

  deactivate(ctx: ToolContext) {
    ctx.scene.remove(this.ghostGroup)
    this.plan = []
    this.planKey = ''
  }

  /** Turns the planned placements about the brush centre by `radians`, each model facing along. */
  spinPreview(radians: number) {
    this.spun += radians
    const c = Math.cos(radians)
    const s = Math.sin(radians)
    for (const p of this.plan) {
      const dx = p.dx * c - p.dz * s
      const dz = p.dx * s + p.dz * c
      p.dx = dx
      p.dz = dz
      p.rotY -= radians
    }
    const deg = Math.round(THREE.MathUtils.euclideanModulo(THREE.MathUtils.radToDeg(this.spun), 360))
    setViewportHint(`Spin ${deg % 360}°`)
  }

  onKey(_ctx: ToolContext, e: KeyboardEvent) {
    if (e.key === 'r' || e.key === 'R') {
      this.spinPreview((e.shiftKey ? -1 : 1) * (Math.PI / 4))
      return true
    }
    return false
  }

  /** Whether the preview shows a model of `type`, for the engine to animate it as the placed copies will. */
  previewing(type: string): boolean {
    if (this.placed || this.erased) return false
    const brush = activeDoodadBrush()
    if (!brush) return false
    for (const p of this.plan) if (brush.entries[p.entry]?.type === type) return true
    return false
  }

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
    // The previewed placements land first, so a click puts down what was shown.
    this.ensurePlan(brush)
    this.prepareNear(ctx, hit, brush)
    for (const p of this.plan) this.place(ctx, brush, hit, p)
    this.plan = []
    this.planKey = ''
    this.acc = 0
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

  /** Shows the planned placements as ghost models under the hovering brush. */
  frame(ctx: ToolContext, hit: THREE.Vector3 | null) {
    const brush = activeDoodadBrush()
    const hovering = !!hit && !this.placed && !this.erased && !!brush && brush.entries.length > 0
    if (!hovering) {
      for (const g of this.ghosts) g.visible = false
      return
    }
    this.ensurePlan(brush)
    while (this.ghosts.length < this.plan.length) {
      const m = new THREE.Mesh(new THREE.BufferGeometry())
      this.ghosts.push(m)
      this.ghostGroup.add(m)
    }
    const t = ctx.terrain
    const sea = editor.doodad.avoidWater && editor.waterEnabled ? editor.waterLevel : -Infinity
    for (let i = 0; i < this.ghosts.length; i++) {
      let g = this.ghosts[i]
      const p = this.plan[i]
      if (!p) {
        g.visible = false
        continue
      }
      const x = hit.x + p.dx
      const z = hit.z + p.dz
      const y = t.contains(x, z) ? t.heightAt(x, z) : -Infinity
      g.visible = y > -Infinity && y >= sea && !t.isHole(x, z)
      if (!g.visible) continue
      const e = brush.entries[p.entry]
      const asset = getAsset(e.type)
      // A model still loading shows nothing rather than the placeholder box.
      if (!asset.ready) {
        g.visible = false
        continue
      }
      if (g.geometry !== asset.geometry || !hasSkeleton(g, asset.skeleton)) {
        g = modelMesh(asset.geometry, asset.material, asset.skeleton)
        g.renderOrder = this.ghostGroup.renderOrder
        this.ghostGroup.remove(this.ghosts[i])
        this.ghostGroup.add(g)
        this.ghosts[i] = g
      }
      g.position.set(x, y + e.sink, z)
      if (editor.followGround) {
        groundNormal((px, pz) => t.heightAt(px, pz), x, z, t.cellSize, editor.followGroundSmooth, this.normal)
        tiltToNormal(this.normal.x, this.normal.y, this.normal.z, p.rotY, this.tilt)
        g.rotation.set(this.tilt.tiltX, p.rotY, this.tilt.tiltZ, 'YXZ')
      } else {
        g.rotation.set(p.tiltX, p.rotY, p.tiltZ, 'YXZ')
      }
      g.scale.setScalar(p.scale)
    }
  }

  /** Draws the plan again when the brush or the settings it depends on changed. */
  private ensurePlan(brush: DoodadBrush) {
    const { radius, strength, falloff, curve } = editor.brush
    let key = `${brush.name}|${brush.spacing}|${radius}|${strength}|${falloff}|${curve}|${editor.doodad.randomRot ? 1 : 0}`
    for (const e of brush.entries) key += `|${e.type}|${e.weight}|${e.scaleMin}|${e.scaleMax}|${e.tilt}`
    if (key === this.planKey) return
    this.planKey = key
    this.plan = []
    this.spun = 0
    const want = Math.max(1, Math.min(MAX_PREVIEW, Math.round(attemptRate(radius, strength) / 4)))
    // The planned models keep the spacing among themselves (the press also checks the map).
    this.nearCount = 0
    let attempts = MAX_ATTEMPTS
    while (this.plan.length < want && attempts-- > 0) {
      const p = this.roll(brush, radius, falloff, curve)
      if (!p) continue
      if (!fits(p.dx, p.dz, p.size, brush.spacing, this.near, this.nearCount)) continue
      this.plan.push(p)
      this.pushNear(p.dx, p.dz, p.size)
    }
  }

  /** One placement drawn at random, relative to the brush centre; null when the falloff drops the point. */
  private roll(brush: DoodadBrush, radius: number, falloff: number, curve: typeof editor.brush.curve): Planned | null {
    if (!candidate(0, 0, radius, falloff, curve, Math.random, this.point)) return null
    const i = pickEntry(brush, Math.random())
    if (i < 0) return null
    const e = brush.entries[i]
    const scale = e.scaleMin + Math.random() * (e.scaleMax - e.scaleMin)
    const lim = (e.tilt * Math.PI) / 180
    return {
      dx: this.point[0],
      dz: this.point[1],
      entry: i,
      scale,
      rotY: editor.doodad.randomRot ? Math.random() * Math.PI * 2 : 0,
      tiltX: lim > 0 ? (Math.random() * 2 - 1) * lim : 0,
      tiltZ: lim > 0 ? (Math.random() * 2 - 1) * lim : 0,
      size: this.footprint(e.type, scale),
    }
  }

  /** The wider side of a model's footprint at `scale`, in yards. */
  private footprint(type: string, scale: number): number {
    const s = getAsset(type).bbox.getSize(this.size)
    return Math.max(MIN_FOOTPRINT, Math.max(s.x, s.z) * scale)
  }

  /** Fills `near` with what a placement under the brush must keep away from (nothing while stacking). */
  private prepareNear(ctx: ToolContext, hit: THREE.Vector3, brush: DoodadBrush) {
    // Models of a brush are at most a few yards wide; what stands a little beyond the brush still
    // keeps a placement at the edge away.
    if (this.stacking) this.nearCount = 0
    else this.gatherNear(ctx, hit, editor.brush.radius + 8 * Math.max(1, brush.spacing))
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

  /**
   * Puts a planned placement down at the brush at `hit`, unless it lands off the map, in a hole, under
   * the sea, or (unless stacking) too close to what `near` holds. Returns whether it was placed.
   */
  private place(ctx: ToolContext, brush: DoodadBrush, hit: THREE.Vector3, p: Planned): boolean {
    const t = ctx.terrain
    const x = hit.x + p.dx
    const z = hit.z + p.dz
    if (!t.contains(x, z) || t.isHole(x, z)) return false
    const sea = editor.doodad.avoidWater && editor.waterEnabled ? editor.waterLevel : -Infinity
    if (t.heightAt(x, z) < sea) return false
    if (!this.stacking && !fits(x, z, p.size, brush.spacing, this.near, this.nearCount)) return false
    const e = brush.entries[p.entry]
    let tilt: { tiltX?: number; tiltZ?: number } = {}
    if (editor.followGround) {
      groundNormal((px, pz) => t.heightAt(px, pz), x, z, t.cellSize, editor.followGroundSmooth, this.normal)
      tiltToNormal(this.normal.x, this.normal.y, this.normal.z, p.rotY, this.tilt)
      tilt = { ...this.tilt }
    } else if (p.tiltX !== 0 || p.tiltZ !== 0) {
      tilt = { tiltX: p.tiltX, tiltZ: p.tiltZ }
    }
    const o = ctx.objects.add({ type: e.type, x, z, yOff: e.sink, rotY: p.rotY, scale: p.scale, ...tilt })
    this.placed!.push(o)
    if (!this.stacking) this.pushNear(x, z, p.size)
    return true
  }

  private scatter(ctx: ToolContext, hit: THREE.Vector3, brush: DoodadBrush, dt: number) {
    const { radius, strength, falloff, curve } = editor.brush
    this.acc += attemptRate(radius, strength * ctx.pressure()) * dt
    let attempts = Math.min(MAX_ATTEMPTS, Math.floor(this.acc))
    if (attempts <= 0) return
    this.acc -= attempts
    this.prepareNear(ctx, hit, brush)
    while (attempts-- > 0) {
      const p = this.roll(brush, radius, falloff, curve)
      if (p) this.place(ctx, brush, hit, p)
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
