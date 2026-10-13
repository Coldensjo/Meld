import * as THREE from 'three'
import { editor, setStatus, ui } from '../state/editor.svelte'
import { movableSelection, objectsInRect, selectObjects } from '../state/selection'
import { getAsset, type ModelAsset } from '../models/assets'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import type { Command } from '../state/history'
import type { Tool, ToolContext } from './Tool'
import { groundNormal, tiltToNormal } from '../world/groundTilt'

function addCommand(objects: ObjectLayer, added: WorldObject[], label: string): Command {
  const saved = added.map((o) => ({ ...o }))
  return {
    label,
    undo: () => saved.forEach((o) => objects.remove(o.id)),
    redo: () => saved.forEach((o) => objects.add({ ...o })),
  }
}

export function removeCommand(objects: ObjectLayer, removed: WorldObject[]): Command {
  const saved = removed.map((o) => ({ ...o }))
  return {
    label: 'Delete',
    undo: () => saved.forEach((o) => objects.add({ ...o })),
    redo: () => saved.forEach((o) => objects.remove(o.id)),
  }
}

export function transformCommand(objects: ObjectLayer, before: WorldObject, after: WorldObject): Command {
  return groupTransformCommand(objects, [before], [after], 'Transform')
}

/** One undo step for several objects' transforms: `before[i]` and `after[i]` are snapshots of the same object. */
export function groupTransformCommand(objects: ObjectLayer, before: WorldObject[], after: WorldObject[], label?: string): Command {
  const b = before.map((o) => ({ ...o }))
  const a = after.map((o) => ({ ...o }))
  const apply = (states: WorldObject[]) => {
    for (const s of states) {
      const o = objects.objects.get(s.id)
      if (!o) continue
      // Snapshots without a parent mean "on the ground", and without tilts mean upright.
      delete o.parent
      delete o.tiltX
      delete o.tiltZ
      Object.assign(o, s)
      objects.touch(s.id)
      if (editor.selected?.id === s.id) editor.selected = { ...s }
    }
  }
  return { label: label ?? (b.length > 1 ? `Move ${b.length} objects` : 'Transform'), undo: () => apply(b), redo: () => apply(a) }
}

const TILT_LIMIT = (8 * Math.PI) / 180

/** A random tilt each way, up to TILT_LIMIT, when random tilt is on; nothing otherwise. */
function randomTilt(): { tiltX?: number; tiltZ?: number } {
  if (!editor.placeRandomTilt) return {}
  return { tiltX: (Math.random() * 2 - 1) * TILT_LIMIT, tiltZ: (Math.random() * 2 - 1) * TILT_LIMIT }
}

export class PlaceTool implements Tool {
  get usesBrush() {
    return editor.placeScatter
  }

  private ghost: THREE.Mesh
  private ghostType = ''
  private ghostAsset: ModelAsset | null = null
  private rot = 0
  private scale = 1
  private tilt: { tiltX?: number; tiltZ?: number } = {}
  private scattering: WorldObject[] | null = null
  private scatterAcc = 0
  private normal = { x: 0, y: 1, z: 0 }
  private ghostTilt = { tiltX: 0, tiltZ: 0 }

  constructor() {
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry())
    this.ghost.renderOrder = 20
  }

  /**
   * The tilt a model turned `rotY` needs to stand on the ground at (x, z) with Follow ground rotation on,
   * the same as the Select tool's drag. Written into `out`.
   */
  private groundTilt(ctx: ToolContext, x: number, z: number, rotY: number, out: { tiltX: number; tiltZ: number }) {
    const t = ctx.terrain
    groundNormal((px, pz) => t.heightAt(px, pz), x, z, t.cellSize, editor.followGroundSmooth, this.normal)
    return tiltToNormal(this.normal.x, this.normal.y, this.normal.z, rotY, out)
  }

  activate(ctx: ToolContext) {
    ctx.scene.add(this.ghost)
  }

  deactivate(ctx: ToolContext) {
    ctx.scene.remove(this.ghost)
  }

  /** Rotate the placement preview (Ctrl+scroll). The next click uses this rotation. */
  rotatePreview(radians: number) {
    this.rot += radians
  }

  private reroll() {
    this.rot = editor.placeRandomRot ? Math.random() * Math.PI * 2 : this.rot
    this.scale = editor.placeRandomScale ? 0.8 + Math.random() * 0.45 : 1
    this.tilt = randomTilt()
  }

  frame(ctx: ToolContext, hit: THREE.Vector3 | null) {
    if (this.ghostType !== editor.prefab) {
      this.ghostType = editor.prefab
      this.reroll()
    }
    const asset = getAsset(editor.prefab)
    if (asset !== this.ghostAsset) {
      // Async models swap from placeholder to the real mesh when loaded.
      this.ghostAsset = asset
      this.ghost.geometry = asset.geometry
      this.ghost.material = asset.material
    }
    // The preview sits on whatever is under the cursor: terrain, a building, another prop.
    const surf = hit ? ctx.surface() : null
    this.ghost.visible = !!surf && !editor.placeScatter && !!editor.prefab
    if (surf && hit) {
      this.ghost.position.copy(surf.point).y += editor.placeHeight
      // On open ground with Follow ground rotation, the preview leans to the slope it will land on.
      if (editor.followGround && surf.parent === null) {
        this.groundTilt(ctx, hit.x, hit.z, this.rot, this.ghostTilt)
        this.ghost.rotation.set(this.ghostTilt.tiltX, this.rot, this.ghostTilt.tiltZ, 'YXZ')
      } else {
        this.ghost.rotation.set(0, this.rot, 0, 'YXZ')
      }
      this.ghost.scale.setScalar(this.scale)
    }
  }

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
    if (!hit) return
    if (!editor.prefab) {
      setStatus('Pick a model in the palette first.')
      return
    }
    if (editor.placeScatter || e.shiftKey) {
      this.scattering = []
      this.scatterAcc = 1
      return
    }
    // Attach to the building/prop under the cursor, or sit on the ground.
    const surf = ctx.surface() ?? { point: hit.clone(), parent: null }
    // On open ground, Follow ground rotation replaces Random tilt with the slope's tilt.
    const tilt = editor.followGround && surf.parent === null ? this.groundTilt(ctx, hit.x, hit.z, this.rot, { tiltX: 0, tiltZ: 0 }) : this.tilt
    const o = ctx.objects.add({ type: editor.prefab, x: hit.x, z: hit.z, yOff: 0, rotY: this.rot, scale: this.scale, ...tilt })
    ctx.objects.place(o, surf.parent, {
      pos: surf.point.clone().setY(surf.point.y + editor.placeHeight),
      rot: this.rot,
      scale: this.scale,
    })
    ctx.history.push(addCommand(ctx.objects, [o], surf.parent !== null ? 'Place (attached)' : 'Place'))
    // The new object stays selected so it can be nudged/spun with the keys.
    selectObjects(ctx.objects, [o.id])
    this.reroll()
  }

  tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
    if (!this.scattering || !hit) return
    const { radius, strength } = editor.brush
    const size = getAsset(editor.prefab).bbox.getSize(new THREE.Vector3())
    const spacing = Math.max(0.8, Math.max(size.x, size.z) * 0.8)
    this.scatterAcc += dt * (2 + strength * 20)
    while (this.scatterAcc >= 1) {
      this.scatterAcc -= 1
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * radius
      const x = hit.x + Math.cos(a) * r
      const z = hit.z + Math.sin(a) * r
      if (!ctx.terrain.contains(x, z)) continue
      // Keep a minimum spacing between same-type props in this stroke.
      if (this.scattering.some((o) => Math.hypot(o.x - x, o.z - z) < spacing)) continue
      const rotY = Math.random() * Math.PI * 2
      const o = ctx.objects.add({
        type: editor.prefab,
        x,
        z,
        yOff: 0,
        rotY,
        scale: editor.placeRandomScale ? 0.75 + Math.random() * 0.5 : 1,
        ...(editor.followGround ? this.groundTilt(ctx, x, z, rotY, { tiltX: 0, tiltZ: 0 }) : randomTilt()),
      })
      this.scattering.push(o)
    }
  }

  onUp(ctx: ToolContext) {
    if (this.scattering?.length) ctx.history.push(addCommand(ctx.objects, this.scattering, 'Scatter'))
    this.scattering = null
  }

  onKey(_ctx: ToolContext, e: KeyboardEvent) {
    // With an object selected, R spins it (handled by the engine instead).
    if (!editor.selected && (e.key === 'r' || e.key === 'R')) {
      this.rot += (e.shiftKey ? -1 : 1) * (Math.PI / 4)
      return true
    }
    return false
  }
}

/** An area drag's corner, in cells. */
interface Cell {
  x: number
  z: number
}

/**
 * The Select tool. A click on a model selects it (Shift adds or removes it) and a drag moves the
 * selection along whatever is under the cursor; the clicked model leads and the others keep their
 * offsets. A drag on the ground selects an area, and with it every model standing in it. While
 * pasting, the floating clip follows the cursor and a click drops it.
 */
export class SelectTool implements Tool {
  readonly usesBrush = false
  private normal = { x: 0, y: 1, z: 0 }
  /** Dragging the selection: `lead` is the clicked model; `others` keep their world offset from it. */
  private dragging: {
    lead: number
    dx: number
    dz: number
    lift: number
    exclude: Set<number>
    moved: boolean
    others: Array<{ id: number; ox: number; oz: number }>
    before: WorldObject[]
  } | null = null
  /** The cell an area drag started at. */
  private rectStart: Cell | null = null
  /** Where the floating paste would land (corner cell), updated every frame. */
  pasteAt: Cell | null = null

  constructor(
    private hooks: {
      clipSize: () => { w: number; h: number } | null
      commitPaste: () => void
      cancelPaste: () => void
    },
  ) {}

  private cell(ctx: ToolContext, hit: THREE.Vector3): Cell {
    const cs = ctx.terrain.cellSize
    const n = ctx.terrain.size
    return {
      x: Math.min(n, Math.max(0, Math.round(hit.x / cs))),
      z: Math.min(n, Math.max(0, Math.round(hit.z / cs))),
    }
  }

  deactivate() {
    this.rectStart = null
    this.dragging = null
    if (ui.pasting) this.hooks.cancelPaste()
  }

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
    if (ui.pasting) {
      this.hooks.commitPaste()
      return
    }
    const id = ctx.objects.pick(ctx.raycaster)
    if (id !== null) {
      this.pressObject(ctx, id, hit, e.shiftKey)
      return
    }
    // No model under the cursor: a creature or object of the region there is selected instead.
    editor.selectedSpawn = ctx.spawns.pick(ctx.raycaster)
    if (editor.selectedSpawn || !hit) return
    if (!e.shiftKey) selectObjects(ctx.objects, [])
    this.rectStart = this.cell(ctx, hit)
    editor.selection = { x0: this.rectStart.x, z0: this.rectStart.z, x1: this.rectStart.x, z1: this.rectStart.z }
  }

  /** A click on model `id`: selects it (Shift toggles it in the selection) and starts dragging the selection. */
  private pressObject(ctx: ToolContext, id: number, hit: THREE.Vector3 | null, shift: boolean) {
    const o = ctx.objects.objects.get(id)
    if (!o) return
    editor.selectedSpawn = null
    let ids = editor.selectedIds
    if (shift) {
      // Shift+click adds or removes without moving anything.
      ids = ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]
      selectObjects(ctx.objects, ids, ids.includes(id) ? id : undefined)
      return
    }
    if (!ids.includes(id)) ids = [id]
    selectObjects(ctx.objects, ids, id)
    // Drag along whatever surface is under the cursor (never the selection itself or things attached
    // to it); the lead re-attaches to what it lands on.
    const exclude = new Set<number>()
    for (const sid of ids) for (const d of ctx.objects.descendantIds(sid)) exclude.add(d)
    const surf = ctx.surface(exclude)
    const w = ctx.objects.worldPlacement(o)
    const at = surf?.point ?? hit
    if (!at) return
    const moving = movableSelection(ctx.objects)
    const others = moving
      .filter((s) => s.id !== id)
      .map((s) => {
        const sw = ctx.objects.worldPlacement(s)
        return { id: s.id, ox: sw.pos.x - w.pos.x, oz: sw.pos.z - w.pos.z }
      })
    const before = [o, ...others.map((s) => ctx.objects.objects.get(s.id)!)].map((s) => ({ ...s }))
    this.dragging = { lead: id, dx: w.pos.x - at.x, dz: w.pos.z - at.z, lift: Math.max(0, w.pos.y - at.y), exclude, moved: false, others, before }
  }

  onMove(ctx: ToolContext, hit: THREE.Vector3 | null) {
    if (this.rectStart) {
      if (!hit) return
      const c = this.cell(ctx, hit)
      editor.selection = {
        x0: Math.min(this.rectStart.x, c.x),
        z0: Math.min(this.rectStart.z, c.z),
        x1: Math.max(this.rectStart.x, c.x),
        z1: Math.max(this.rectStart.z, c.z),
      }
      return
    }
    const d = this.dragging
    const o = d ? ctx.objects.objects.get(d.lead) : undefined
    if (!d || !o) return
    const surf = ctx.surface(d.exclude)
    if (!surf) return
    const w = ctx.objects.worldPlacement(o)
    w.pos.set(surf.point.x + d.dx, surf.point.y + d.lift, surf.point.z + d.dz)
    ctx.objects.place(o, surf.parent, w)
    if (editor.followGround && surf.parent === null) {
      const t = ctx.terrain
      const n = groundNormal((x, z) => t.heightAt(x, z), o.x, o.z, t.cellSize, editor.followGroundSmooth, this.normal)
      Object.assign(o, tiltToNormal(n.x, n.y, n.z, o.rotY))
      ctx.objects.touch(o.id)
    }
    // The rest of the selection keeps its offset from the lead; a model on the ground keeps its height above it.
    for (const other of d.others) {
      const s = ctx.objects.objects.get(other.id)
      if (!s) continue
      const sw = ctx.objects.worldPlacement(s)
      const nx = w.pos.x + other.ox
      const nz = w.pos.z + other.oz
      if (!ctx.terrain.contains(nx, nz)) continue
      sw.pos.x = nx
      sw.pos.z = nz
      if (s.parent === undefined) sw.pos.y = ctx.terrain.heightAt(nx, nz) + s.yOff
      ctx.objects.place(s, s.parent ?? null, sw)
    }
    d.moved = true
    if (editor.selected?.id === o.id) editor.selected = { ...o }
  }

  onUp(ctx: ToolContext, _hit: THREE.Vector3 | null, e: PointerEvent) {
    if (this.rectStart) {
      this.rectStart = null
      const s = editor.selection
      if (!s) return
      if (s.x1 === s.x0 || s.z1 === s.z0) {
        // A plain click (no area) clears the area.
        editor.selection = null
        return
      }
      const inside = objectsInRect(ctx.objects, ctx.terrain.cellSize, s).map((o) => o.id)
      const ids = e.shiftKey ? [...editor.selectedIds, ...inside] : inside
      selectObjects(ctx.objects, ids)
      const n = editor.selectedIds.length
      setStatus(`Selected ${s.x1 - s.x0} × ${s.z1 - s.z0} cells with ${n} ${n === 1 ? 'object' : 'objects'}.`)
      return
    }
    const d = this.dragging
    this.dragging = null
    if (!d?.moved) return
    const after = d.before.map((b) => ctx.objects.objects.get(b.id)).filter((o): o is WorldObject => !!o)
    const before = d.before.filter((b) => after.some((a) => a.id === b.id))
    ctx.history.push(groupTransformCommand(ctx.objects, before, after))
  }

  frame(ctx: ToolContext, hit: THREE.Vector3 | null) {
    const size = ui.pasting ? this.hooks.clipSize() : null
    if (!size || !hit) return
    const cs = ctx.terrain.cellSize
    this.pasteAt = { x: Math.round(hit.x / cs - size.w / 2), z: Math.round(hit.z / cs - size.h / 2) }
  }

  onKey(ctx: ToolContext, e: KeyboardEvent) {
    if (ui.pasting) {
      if (e.key === 'Escape') this.hooks.cancelPaste()
      else if (e.key === 'Enter') this.hooks.commitPaste()
      else if (e.key === 'PageUp') editor.paste.heightOffset += e.shiftKey ? 5 : 1
      else if (e.key === 'PageDown') editor.paste.heightOffset -= e.shiftKey ? 5 : 1
      else return false
      return true
    }
    if (e.key === 'Escape' && (editor.selection || editor.selectedIds.length)) {
      editor.selection = null
      selectObjects(ctx.objects, [])
      return true
    }
    return false
  }
}
