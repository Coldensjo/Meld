import type * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import { editor } from '../state/editor.svelte'
import type { Command } from '../state/history'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import { TerrainStroke, forEachTexel } from './brush'
import { SLOTS, resetTexel } from '../terrain/chunkPaint'

/**
 * Clear erases what the brush covers. In "models" mode it removes the placed models whose ground
 * point is in the brush, with anything attached to them. In "textures" mode it resets the paint to
 * each chunk's base texture (weight to slot 0). A stroke is one undo step.
 */
export class ClearTool implements Tool {
  readonly usesBrush = true
  private held = false
  private stroke: TerrainStroke | null = null
  private removed: WorldObject[] = []
  /** The object layer the stroke started on: undo must restore that map, not whichever tab is active then. */
  private objects: ObjectLayer | null = null

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null) {
    this.held = true
    this.removed = []
    this.objects = ctx.objects
    if (editor.clearMode === 'textures') this.stroke = new TerrainStroke(ctx.terrain, 'Clear textures', { splat: true })
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
    if (editor.clearMode === 'models') this.clearModels(ctx, hit)
    else this.clearTextures(ctx, hit)
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
