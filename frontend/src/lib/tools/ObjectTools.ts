import * as THREE from 'three'
import { editor, setStatus } from '../state/editor.svelte'
import { getAsset, type ModelAsset } from '../models/assets'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import type { Command } from '../state/history'
import type { Tool, ToolContext } from './Tool'

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
    Object.assign(o, s)
    objects.touch(s.id)
    if (editor.selected?.id === s.id) editor.selected = { ...s }
  }
  return { label: 'Transform', undo: () => apply(b), redo: () => apply(a) }
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

  private reroll() {
    this.rot = editor.placeRandomRot ? Math.random() * Math.PI * 2 : this.rot
    this.scale = editor.placeRandomScale ? 0.8 + Math.random() * 0.45 : 1
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
    this.ghost.visible = !!hit && !editor.placeScatter && !!editor.prefab
    if (hit) {
      this.ghost.position.set(hit.x, ctx.terrain.heightAt(hit.x, hit.z), hit.z)
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
    const o = ctx.objects.add({ type: editor.prefab, x: hit.x, z: hit.z, yOff: 0, rotY: this.rot, scale: this.scale })
    ctx.history.push(addCommand(ctx.objects, [o], 'Place'))
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
  private dragging: { before: WorldObject; dx: number; dz: number; moved: boolean } | null = null

  private selected(ctx: ToolContext) {
    return editor.selected ? ctx.objects.objects.get(editor.selected.id) : undefined
  }

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null) {
    const id = ctx.objects.pick(ctx.raycaster)
    const o = id !== null ? ctx.objects.objects.get(id) : undefined
    editor.selected = o ? { ...o } : null
    if (o && hit) this.dragging = { before: { ...o }, dx: o.x - hit.x, dz: o.z - hit.z, moved: false }
  }

  onMove(ctx: ToolContext, hit: THREE.Vector3 | null) {
    const o = this.selected(ctx)
    if (!this.dragging || !o || !hit) return
    o.x = hit.x + this.dragging.dx
    o.z = hit.z + this.dragging.dz
    this.dragging.moved = true
    ctx.objects.touch(o.id)
    editor.selected = { ...o }
  }

  onUp(ctx: ToolContext) {
    const o = this.selected(ctx)
    if (this.dragging?.moved && o) ctx.history.push(transformCommand(ctx.objects, this.dragging.before, o))
    this.dragging = null
  }
}
