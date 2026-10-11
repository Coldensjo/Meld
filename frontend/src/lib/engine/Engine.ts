import * as THREE from 'three'
import { Terrain, type GenerateKind } from '../terrain/Terrain'
import { Water } from '../water/Water'
import { ObjectLayer } from '../world/ObjectLayer'
import { History } from '../state/history'
import { editor, setStatus, stats, type ToolId } from '../state/editor.svelte'
import { CameraController } from './CameraController'
import { HORIZON, createSky } from './Sky'
import type { Tool, ToolContext } from '../tools/Tool'
import { PaintTool, RoadTool, SculptTool, WaterTool } from '../tools/TerrainTools'
import { PlaceTool, SelectTool, removeCommand, transformCommand } from '../tools/ObjectTools'
import type { WorldObject } from '../world/ObjectLayer'
import { getFallbackTextures } from '../terrain/textures'
import { loadTexture, setMaxAnisotropy } from '../wow/api'

export interface MapSnapshot {
  name: string
  size: number
  cellSize: number
  splatRes: number
  waterLevel: number
  waterEnabled: boolean
  objects: Array<Omit<WorldObject, 'id'>>
  layerTextures: string[]
  texScale: number
  heights: Uint8Array
  splatA: Uint8Array
  splatB: Uint8Array
}

const SUN_DIR = new THREE.Vector3(0.45, 0.8, 0.35).normalize()

/**
 * Owns the renderer, scene and render loop. Svelte components talk to it via
 * methods; per-frame state never round-trips through Svelte reactivity.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controller: CameraController
  readonly history = new History()
  readonly raycaster = new THREE.Raycaster()
  terrain: Terrain
  water: Water
  readonly objects: ObjectLayer

  private sky: THREE.Mesh
  private tools: Record<ToolId, Tool>
  private activeToolId: ToolId | null = null
  private activeTool: Tool | null = null
  private ctx: ToolContext
  private ndc = new THREE.Vector2()
  private pointerInside = false
  private leftDown = false
  private hitVec = new THREE.Vector3()
  private hit: THREE.Vector3 | null = null
  private clock = new THREE.Clock()
  private raf = 0
  private frames = 0
  private statTime = 0
  private resizeObs: ResizeObserver
  /** Layer texture paths currently bound to the terrain shader. */
  private boundLayers: string[] = []
  private abort = new AbortController()

  constructor(
    private canvas: HTMLCanvasElement,
    private container: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 5000)
    this.scene.background = HORIZON.clone()

    this.sky = createSky(SUN_DIR)
    this.scene.add(this.sky)

    // Lights for props (terrain/water shaders use matching uniforms).
    const hemi = new THREE.HemisphereLight(new THREE.Color(0.45, 0.5, 0.6), new THREE.Color(0.25, 0.22, 0.18), Math.PI)
    const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.95, 0.85), Math.PI * 0.95)
    sun.position.copy(SUN_DIR).multiplyScalar(100)
    this.scene.add(hemi, sun)

    const aniso = this.renderer.capabilities.getMaxAnisotropy()
    setMaxAnisotropy(aniso)
    this.terrain = new Terrain(256)
    this.water = new Water(this.terrain.worldSize)
    this.objects = new ObjectLayer(this.terrain)
    this.scene.add(this.terrain.group, this.water.mesh, this.objects.group)

    this.controller = new CameraController(this.camera, canvas, (x, z) => this.terrain.heightAt(x, z))

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    this.ctx = {
      get terrain() { return self.terrain },
      get objects() { return self.objects },
      get history() { return self.history },
      get scene() { return self.scene },
      get raycaster() { return self.raycaster },
    }

    this.tools = {
      select: new SelectTool(),
      sculpt: new SculptTool(),
      paint: new PaintTool(),
      road: new RoadTool(),
      water: new WaterTool(),
      place: new PlaceTool(),
    }

    this.bindPointer()
    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(container)
    this.resize()
    this.newMap(256, 'hills', 1337)
  }

  // ---------------------------------------------------------------- lifecycle

  start() {
    this.clock.start()
    const loop = () => {
      this.raf = requestAnimationFrame(loop)
      this.frame()
    }
    loop()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.abort.abort()
    this.resizeObs.disconnect()
    this.controller.dispose()
    this.terrain.dispose()
    this.water.dispose()
    this.objects.dispose()
    this.renderer.dispose()
  }

  private resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  // ---------------------------------------------------------------- input

  private updatePointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect()
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }

  private pick() {
    this.raycaster.setFromCamera(this.ndc, this.camera)
    this.hit = this.terrain.raycast(this.raycaster.ray, this.hitVec) ? this.hitVec : null
  }

  private bindPointer() {
    const sig = { signal: this.abort.signal }
    const c = this.canvas
    c.addEventListener('pointerenter', () => (this.pointerInside = true), sig)
    c.addEventListener('pointerleave', () => (this.pointerInside = false), sig)
    c.addEventListener(
      'pointerdown',
      (e) => {
        this.updatePointer(e)
        if (e.button !== 0) return
        c.setPointerCapture(e.pointerId)
        this.leftDown = true
        this.pick()
        this.activeTool?.onDown?.(this.ctx, this.hit, e)
      },
      sig,
    )
    c.addEventListener(
      'pointermove',
      (e) => {
        this.pointerInside = true
        this.updatePointer(e)
        if (this.leftDown) {
          this.pick()
          this.activeTool?.onMove?.(this.ctx, this.hit, e)
        }
      },
      sig,
    )
    c.addEventListener(
      'pointerup',
      (e) => {
        if (e.button !== 0 || !this.leftDown) return
        this.leftDown = false
        this.updatePointer(e)
        this.pick()
        this.activeTool?.onUp?.(this.ctx, this.hit, e)
      },
      sig,
    )
  }

  /** Forward a key to the active tool. Returns true if handled. */
  handleToolKey(e: KeyboardEvent): boolean {
    return this.activeTool?.onKey?.(this.ctx, e) ?? false
  }

  // ---------------------------------------------------------------- frame

  private syncTool() {
    if (this.activeToolId === editor.tool) return
    if (this.leftDown) {
      this.activeTool?.onUp?.(this.ctx, this.hit, new PointerEvent('pointerup'))
      this.leftDown = false
    }
    this.activeTool?.deactivate?.(this.ctx)
    this.activeToolId = editor.tool
    this.activeTool = this.tools[editor.tool]
    this.activeTool.activate?.(this.ctx)
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const time = this.clock.elapsedTime

    this.syncTool()
    this.controller.update(dt)
    this.sky.position.copy(this.camera.position)

    if (this.pointerInside && !this.controller.isDragging) this.pick()
    else if (!this.leftDown) this.hit = null

    const tool = this.activeTool!
    if (this.leftDown) tool.tick?.(this.ctx, dt, this.hit)
    tool.frame?.(this.ctx, this.hit)

    this.syncLayerTextures()
    const u = this.terrain.material.uniforms
    u.texScale.value = editor.texScale
    u.brushVisible.value = tool.usesBrush && this.hit ? 1 : 0
    if (this.hit) u.brushPos.value.set(this.hit.x, this.hit.z)
    u.brushRadius.value = editor.tool === 'road' ? Math.max(1.5, editor.brush.radius * 0.5) : editor.brush.radius
    u.gridVisible.value = editor.grid ? 1 : 0
    u.cliffAuto.value = editor.autoCliff ? 1 : 0
    u.waterLevel.value = editor.waterLevel
    u.waterEnabled.value = editor.waterEnabled ? 1 : 0
    this.water.level = editor.waterLevel
    this.water.visible = editor.waterEnabled

    this.terrain.update()
    this.objects.update()
    this.water.update(time)
    this.renderer.render(this.scene, this.camera)

    this.frames++
    if (time - this.statTime >= 0.5) {
      stats.fps = Math.round(this.frames / (time - this.statTime))
      stats.drawCalls = this.renderer.info.render.calls
      stats.triangles = this.renderer.info.render.triangles
      stats.objects = this.objects.objects.size
      stats.cursor = this.hit ? { x: this.hit.x, y: this.hit.y, z: this.hit.z } : null
      this.frames = 0
      this.statTime = time
    }
  }

  /** Bind each paint layer to its procedural or WoW tileset texture. */
  private syncLayerTextures() {
    const want = editor.layerTextures
    for (let i = 0; i < want.length; i++) {
      const path = want[i] ?? ''
      if (this.boundLayers[i] === path) continue
      this.boundLayers[i] = path
      const uniform = this.terrain.material.uniforms['tex' + i]
      const procedural = getFallbackTextures()[i]
      if (!path) {
        uniform.value = procedural
        continue
      }
      const material = this.terrain.material
      loadTexture(path)
        .then((t) => {
          // Ignore if the layer changed again or the terrain was replaced.
          if (this.boundLayers[i] === path && this.terrain.material === material) uniform.value = t
        })
        .catch((e) => {
          setStatus(`Texture failed: ${e}`, 6000)
          if (this.boundLayers[i] === path) uniform.value = procedural
        })
    }
  }

  // ---------------------------------------------------------------- map ops

  private replaceTerrain(size: number) {
    this.scene.remove(this.terrain.group, this.water.mesh)
    this.terrain.dispose()
    this.water.dispose()
    this.terrain = new Terrain(size)
    this.water = new Water(this.terrain.worldSize)
    this.scene.add(this.terrain.group, this.water.mesh)
    this.objects.setTerrain(this.terrain)
    this.objects.clear()
    this.controller.bounds = this.terrain.worldSize
    this.controller.maxDistance = this.terrain.worldSize * 1.6
    this.scene.fog = new THREE.Fog(HORIZON, this.terrain.worldSize * 0.5, this.terrain.worldSize * 2.2)
    this.history.clear()
    editor.selected = null
    this.boundLayers = []
  }

  newMap(size: number, kind: GenerateKind, seed: number) {
    this.replaceTerrain(size)
    this.terrain.generate(kind, seed)
    editor.waterLevel = kind === 'flat' ? -2 : kind === 'island' ? 0 : -1
    editor.waterEnabled = kind !== 'flat'
    this.terrain.autoPaint(editor.waterLevel, editor.waterEnabled)
    const c = this.terrain.worldSize / 2
    this.controller.focus(c, c, this.terrain.worldSize * 0.35)
    editor.dirty = false
  }

  snapshot(): MapSnapshot {
    const t = this.terrain
    return {
      name: editor.mapName,
      size: t.size,
      cellSize: t.cellSize,
      splatRes: t.splatRes,
      waterLevel: editor.waterLevel,
      waterEnabled: editor.waterEnabled,
      objects: this.objects.list().map(({ id: _id, ...o }) => o),
      layerTextures: [...editor.layerTextures],
      texScale: editor.texScale,
      heights: new Uint8Array(t.heights.buffer, t.heights.byteOffset, t.heights.byteLength),
      splatA: t.splatA,
      splatB: t.splatB,
    }
  }

  load(m: MapSnapshot) {
    const verts = (m.size + 1) * (m.size + 1)
    if (m.heights.byteLength !== verts * 4) throw new Error('height data size mismatch')
    this.replaceTerrain(m.size)
    const t = this.terrain
    if (m.splatRes !== t.splatRes) throw new Error('splat resolution mismatch')
    t.heights.set(new Float32Array(m.heights.slice().buffer))
    t.splatA.set(m.splatA)
    t.splatB.set(m.splatB)
    t.markAllDirty()
    for (const o of m.objects) this.objects.add(o)
    editor.mapName = m.name || 'Untitled'
    editor.waterLevel = m.waterLevel
    editor.waterEnabled = m.waterEnabled
    editor.layerTextures = Array.from({ length: 8 }, (_, i) => m.layerTextures[i] ?? '')
    editor.texScale = m.texScale || 8
    const c = t.worldSize / 2
    this.controller.focus(c, c, t.worldSize * 0.35)
    editor.dirty = false
  }

  // ---------------------------------------------------------------- editing API

  undo() {
    const c = this.history.undo()
    this.syncSelection()
    return c
  }

  redo() {
    const c = this.history.redo()
    this.syncSelection()
    return c
  }

  private syncSelection() {
    if (!editor.selected) return
    const o = this.objects.objects.get(editor.selected.id)
    editor.selected = o ? { ...o } : null
  }

  /** Live-edit the selected object from the properties panel. */
  editSelected(patch: Partial<Omit<WorldObject, 'id' | 'type'>>, commit: boolean, before?: WorldObject) {
    if (!editor.selected) return
    const o = this.objects.objects.get(editor.selected.id)
    if (!o) return
    Object.assign(o, patch)
    this.objects.touch(o.id)
    editor.selected = { ...o }
    if (commit && before) this.history.push(transformCommand(this.objects, before, o))
  }

  deleteSelected() {
    if (!editor.selected) return
    const o = this.objects.remove(editor.selected.id)
    if (o) this.history.push(removeCommand(this.objects, [o]))
    editor.selected = null
  }

  focusSelected() {
    if (editor.selected) this.controller.focus(editor.selected.x, editor.selected.z, 30)
  }

  /** Total splat weight per paint slot (sampled), used to find unused slots. */
  private slotUsage(): number[] {
    const t = this.terrain
    const usage = new Array(8).fill(0)
    const step = 4 * 7 // sample every 7th texel; plenty to detect usage
    for (let p = 0; p < t.splatA.length; p += step) {
      for (let k = 0; k < 4; k++) {
        usage[k] += t.splatA[p + k]
        usage[k + 4] += t.splatB[p + k]
      }
    }
    return usage
  }

  /**
   * Make `path` paintable: reuse its slot if bound, otherwise bind it to an
   * unused slot, or (if all 8 are in use) replace the active slot. Undoable.
   * Returns the slot index.
   */
  useTexture(path: string): number {
    const textures = editor.layerTextures
    let slot = textures.findIndex((p) => p.toLowerCase() === path.toLowerCase())
    if (slot >= 0) {
      editor.paintLayer = slot
      return slot
    }
    const usage = this.slotUsage()
    const total = usage.reduce((a, b) => a + b, 0) || 1
    const unused = (i: number) => usage[i] / total < 0.0005
    slot = textures.findIndex((p, i) => !p && unused(i))
    if (slot < 0) slot = textures.findIndex((_, i) => unused(i))
    let replaced = false
    if (slot < 0) {
      slot = editor.paintLayer
      replaced = true
    }
    const before = textures[slot]
    const i = slot
    textures[i] = path
    this.history.push({
      label: 'Assign texture',
      undo: () => (editor.layerTextures[i] = before),
      redo: () => (editor.layerTextures[i] = path),
    })
    editor.paintLayer = slot
    if (replaced) setStatus(`All 8 texture slots are in use; replaced slot ${slot + 1}. Undo with Ctrl+Z.`, 6000)
    return slot
  }

  regenerateAutoPaint() {
    const before = { a: this.terrain.splatA.slice(), b: this.terrain.splatB.slice() }
    this.terrain.autoPaint(editor.waterLevel, editor.waterEnabled)
    const after = { a: this.terrain.splatA.slice(), b: this.terrain.splatB.slice() }
    const t = this.terrain
    const apply = (s: typeof before) => {
      t.splatA.set(s.a)
      t.splatB.set(s.b)
      t.markSplatDirty()
    }
    this.history.push({ label: 'Auto paint', undo: () => apply(before), redo: () => apply(after) })
  }
}
