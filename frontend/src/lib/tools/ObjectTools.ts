import * as THREE from 'three'
import { editor, setStatus } from '../state/editor.svelte'
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
  const b = { ...before }
  const a = { ...after }
  const apply = (s: WorldObject) => {
    const o = objects.objects.get(s.id)
    if (!o) return
    // Snapshots without a parent mean "on the ground", and without tilts mean upright.
    delete o.parent
    delete o.tiltX
    delete o.tiltZ
    Object.assign(o, s)
    objects.touch(s.id)
    if (editor.selected?.id === s.id) editor.selected = { ...s }
  }
  return { label: 'Transform', undo: () => apply(b), redo: () => apply(a) }
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

  constructor() {
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry())
    this.ghost.renderOrder = 20
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
    if (surf) {
      this.ghost.position.copy(surf.point).y += editor.placeHeight
      this.ghost.rotation.y = this.rot
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
    const o = ctx.objects.add({ type: editor.prefab, x: hit.x, z: hit.z, yOff: 0, rotY: this.rot, scale: this.scale, ...this.tilt })
    ctx.objects.place(o, surf.parent, {
      pos: surf.point.clone().setY(surf.point.y + editor.placeHeight),
      rot: this.rot,
      scale: this.scale,
    })
    ctx.history.push(addCommand(ctx.objects, [o], surf.parent !== null ? 'Place (attached)' : 'Place'))
    // The new object stays selected so it can be nudged/spun with the keys.
    editor.selected = { ...o }
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
      const o = ctx.objects.add({
        type: editor.prefab,
        x,
        z,
        yOff: 0,
        rotY: Math.random() * Math.PI * 2,
        scale: editor.placeRandomScale ? 0.75 + Math.random() * 0.5 : 1,
        ...randomTilt(),
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

export class SelectTool implements Tool {
  readonly usesBrush = false
  private normal = { x: 0, y: 1, z: 0 }
  private dragging: { before: WorldObject; dx: number; dz: number; lift: number; exclude: Set<number>; moved: boolean } | null = null

  private selected(ctx: ToolContext) {
    return editor.selected ? ctx.objects.objects.get(editor.selected.id) : undefined
  }

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null) {
    const id = ctx.objects.pick(ctx.raycaster)
    const o = id !== null ? ctx.objects.objects.get(id) : undefined
    editor.selected = o ? { ...o } : null
    if (!o) {
      // No model under the cursor: a creature or object of the region there is selected instead.
      editor.selectedSpawn = ctx.spawns.pick(ctx.raycaster)
      return
    }
    editor.selectedSpawn = null
    // Drag along whatever surface is under the cursor (never the object itself
    // or things attached to it); the object re-attaches to what it lands on.
    const exclude = ctx.objects.descendantIds(o.id)
    const surf = ctx.surface(exclude)
    const w = ctx.objects.worldPlacement(o)
    const at = surf?.point ?? hit
    if (!at) return
    this.dragging = { before: { ...o }, dx: w.pos.x - at.x, dz: w.pos.z - at.z, lift: Math.max(0, w.pos.y - at.y), exclude, moved: false }
  }

  onMove(ctx: ToolContext) {
    const o = this.selected(ctx)
    const d = this.dragging
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
    d.moved = true
    editor.selected = { ...o }
  }

  onUp(ctx: ToolContext) {
    const o = this.selected(ctx)
    if (this.dragging?.moved && o) ctx.history.push(transformCommand(ctx.objects, this.dragging.before, o))
    this.dragging = null
  }
}
