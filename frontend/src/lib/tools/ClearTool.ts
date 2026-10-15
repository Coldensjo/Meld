import type * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import { editor } from '../state/editor.svelte'
import type { Command } from '../state/history'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import { TerrainStroke, forEachTexel, forEachVertex, type Rect } from './brush'
import { SLOTS, resetTexel } from '../terrain/chunkPaint'
import { LiquidStroke } from '../water/liquidStroke'
import { RIVER_OPACITY, paintLiquid } from '../water/liquids'

/**
 * Clear erases what the brush covers, after noggit's clear tools. "models" removes the placed models
 * whose ground point is in the brush, with anything attached to them; "textures" resets the paint to
 * each chunk's base texture (weight to slot 0); "heights" brings the ground to zero (noggit's
 * clearHeight), weighted by the brush; "liquids" removes every painted liquid under the brush; and
 * "holes" fills the holes of the cells under it. A stroke is one undo step.
 */
export class ClearTool implements Tool {
  readonly usesBrush = true
  private held = false
  private stroke: TerrainStroke | null = null
  private liquidStroke: LiquidStroke | null = null
  private removed: WorldObject[] = []
  /** The object layer the stroke started on: undo must restore that map, not whichever tab is active then. */
  private objects: ObjectLayer | null = null
  private cellRect: Rect = { x0: 0, z0: 0, x1: 0, z1: 0 }

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null) {
    this.held = true
    this.removed = []
    this.objects = ctx.objects
    const mode = editor.clearMode
    if (mode === 'textures') this.stroke = new TerrainStroke(ctx.terrain, 'Clear textures', { splat: true })
    else if (mode === 'heights') this.stroke = new TerrainStroke(ctx.terrain, 'Clear height', { heights: true }, (r) => this.resnap(ctx, r))
    else if (mode === 'holes') this.stroke = new TerrainStroke(ctx.terrain, 'Fill holes', { holes: true })
    else if (mode === 'liquids') this.liquidStroke = new LiquidStroke(ctx.liquids, 'Clear liquids')
    this.clear(ctx, hit)
  }

  tick(ctx: ToolContext, _dt: number, hit: THREE.Vector3 | null) {
    if (this.held) this.clear(ctx, hit)
  }

  onUp(ctx: ToolContext) {
    this.held = false
    const cmd = this.stroke?.finish() ?? null
    this.stroke = null
    if (cmd) ctx.history.push(cmd)
    const lcmd = this.liquidStroke?.finish() ?? null
    this.liquidStroke = null
    if (lcmd) ctx.history.push(lcmd)
    const objects = this.objects
    const saved = this.removed
    this.removed = []
    this.objects = null
    if (objects && saved.length) {
      const cmd: Command = {
        label: 'Clear models',
        undo: () => saved.forEach((o) => objects.add({ ...o })),
        redo: () => saved.forEach((o) => objects.remove(o.id)),
      }
      ctx.history.push(cmd)
    }
  }

  private clear(ctx: ToolContext, hit: THREE.Vector3 | null) {
    if (!hit) return
    switch (editor.clearMode) {
      case 'models':
        return this.clearModels(ctx, hit)
      case 'textures':
        return this.clearTextures(ctx, hit)
      case 'heights':
        return this.clearHeights(ctx, hit)
      case 'liquids':
        return this.clearLiquids(ctx, hit)
      case 'holes':
        return this.fillHoles(ctx, hit)
    }
  }

  /** The ground under the brush goes to height zero, by the brush weight, so a soft edge blends into what stands around. */
  private clearHeights(ctx: ToolContext, hit: THREE.Vector3) {
    const t = ctx.terrain
    const h = t.heights
    const { radius, falloff } = editor.brush
    const rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w) => (h[i] *= 1 - w), this.stroke)
    if (rect) {
      t.markDirty(rect.x0, rect.z0, rect.x1, rect.z1)
      this.stroke?.touchHeights(rect)
      this.resnap(ctx, rect)
    }
  }

  private resnap(ctx: ToolContext, r: Rect) {
    const cs = ctx.terrain.cellSize
    ctx.objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
  }

  /** Every painted liquid layer loses the cells under the brush (noggit's liquid brush with "remove"). */
  private clearLiquids(ctx: ToolContext, hit: THREE.Vector3) {
    if (!this.liquidStroke) return
    paintLiquid(
      ctx.liquids,
      ctx.terrain,
      { x: hit.x, y: hit.y, z: hit.z, radius: editor.brush.radius, id: 1, add: false, angle: 0, orientation: 0, lock: false, origin: hit, overrideHeight: false, overrideId: false, opacity: RIVER_OPACITY },
      this.liquidStroke.reserve,
    )
  }

  /** The holes of the cells whose centre is under the brush are filled. */
  private fillHoles(ctx: ToolContext, hit: THREE.Vector3) {
    const t = ctx.terrain
    const cs = t.cellSize
    const r = editor.brush.radius
    const x0 = Math.max(0, Math.floor((hit.x - r) / cs))
    const z0 = Math.max(0, Math.floor((hit.z - r) / cs))
    const x1 = Math.min(t.size - 1, Math.floor((hit.x + r) / cs))
    const z1 = Math.min(t.size - 1, Math.floor((hit.z + r) / cs))
    if (x1 < x0 || z1 < z0) return
    const rect = this.cellRect
    rect.x0 = x0
    rect.z0 = z0
    rect.x1 = x1
    rect.z1 = z1
    let any = false
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cz * t.size + cx
        if (!t.holes[i]) continue
        const dx = (cx + 0.5) * cs - hit.x
        const dz = (cz + 0.5) * cs - hit.z
        if (dx * dx + dz * dz > r * r) continue
        if (!any) this.stroke?.reserveHoles(rect)
        any = true
        t.holes[i] = 0
      }
    }
    if (!any) return
    t.markDirty(x0, z0, x1 + 1, z1 + 1)
    this.stroke?.touchHoles(rect)
  }

  private clearModels(ctx: ToolContext, hit: THREE.Vector3) {
    const r2 = editor.brush.radius * editor.brush.radius
    const gone = new Set<number>()
    for (const o of ctx.objects.objects.values()) {
      if (o.parent !== undefined) continue
      const p = ctx.objects.worldPlacement(o).pos
      const dx = p.x - hit.x
      const dz = p.z - hit.z
      if (dx * dx + dz * dz > r2) continue
      gone.add(o.id)
      for (const kid of ctx.objects.descendantIds(o.id)) gone.add(kid)
    }
    for (const id of gone) {
      const o = ctx.objects.objects.get(id)
      if (!o) continue
      this.removed.push({ ...o })
      ctx.objects.remove(id)
      if (editor.selected?.id === id) editor.selected = null
    }
  }

  private clearTextures(ctx: ToolContext, hit: THREE.Vector3) {
    const t = ctx.terrain
    const { radius, falloff } = editor.brush
    const w = t.weights
    const rect = forEachTexel(t, hit.x, hit.z, radius, falloff, (p, weight) => resetTexel(w, p * SLOTS, weight), this.stroke)
    if (rect) {
      t.markSplatDirty(rect)
      this.stroke?.touchSplat(rect)
    }
  }
}
