import * as THREE from 'three'
import { editor } from '../state/editor.svelte'
import { PREFAB_BY_ID } from '../models/prefabs'
import { prefabGeometry, type ObjectLayer, type WorldObject } from '../world/ObjectLayer'
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
  private rot = 0
  private scale = 1
  private scattering: WorldObject[] | null = null
  private scatterAcc = 0

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false })
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), mat)
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
      this.ghost.geometry = prefabGeometry(editor.prefab)
      this.reroll()
    }
    this.ghost.visible = !!hit && !editor.placeScatter
    if (hit) {
      this.ghost.position.set(hit.x, ctx.terrain.heightAt(hit.x, hit.z), hit.z)
      this.ghost.rotation.y = this.rot
      this.ghost.scale.setScalar(this.scale)
    }
  }

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
    if (!hit) return
    if (editor.placeScatter || e.shiftKey) {
      this.scattering = []
      this.scatterAcc = 1
      return
    }
    const o = ctx.objects.add({ type: editor.prefab, x: hit.x, z: hit.z, yOff: 0, rotY: this.rot, scale: this.scale })
    ctx.history.push(addCommand(ctx.objects, [o], 'Place'))
    this.reroll()
  }

  tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
    if (!this.scattering || !hit) return
    const { radius, strength } = editor.brush
    const p = PREFAB_BY_ID.get(editor.prefab)
    const spacing = (p?.radius ?? 1) * 1.6
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
    if (e.key === 'r' || e.key === 'R') {
      this.rot += (e.shiftKey ? -1 : 1) * (Math.PI / 4)
      return true
    }
    return false
  }
}

export class SelectTool implements Tool {
  readonly usesBrush = false
  private helper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(1, 0.85, 0.2))
  private dragging: { before: WorldObject; dx: number; dz: number; moved: boolean } | null = null
  private tmpBox = new THREE.Box3()
  private tmpM = new THREE.Matrix4()

  activate(ctx: ToolContext) {
    ctx.scene.add(this.helper)
  }

  deactivate(ctx: ToolContext) {
    ctx.scene.remove(this.helper)
    editor.selected = null
  }

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

  onKey(ctx: ToolContext, e: KeyboardEvent) {
    const o = this.selected(ctx)
    if (!o) return false
    if (e.key === 'Delete' || e.key === 'Backspace') {
      ctx.objects.remove(o.id)
      ctx.history.push(removeCommand(ctx.objects, [o]))
      editor.selected = null
      return true
    }
    if (e.key === 'Escape') {
      editor.selected = null
      return true
    }
    if (e.key === 'r' || e.key === 'R') {
      const before = { ...o }
      o.rotY += (e.shiftKey ? -1 : 1) * (Math.PI / 12)
      ctx.objects.touch(o.id)
      ctx.history.push(transformCommand(ctx.objects, before, o))
      editor.selected = { ...o }
      return true
    }
    return false
  }

  frame(ctx: ToolContext) {
    const o = this.selected(ctx)
    this.helper.visible = !!o
    if (!o) return
    const g = prefabGeometry(o.type)
    this.tmpBox.copy(g.boundingBox!).applyMatrix4(ctx.objects.matrixOf(o, this.tmpM))
    this.helper.box.copy(this.tmpBox)
  }
}
