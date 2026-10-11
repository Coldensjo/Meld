import * as THREE from 'three'
import type { GenerateKind } from '../terrain/Terrain'
import type { Command } from '../state/history'
import { docs, editor, setStatus, stats, type Prefs, type ToolId } from '../state/editor.svelte'
import { MapDocument } from './MapDocument'
import { CameraController } from './CameraController'
import { HORIZON, createSky } from './Sky'
import type { Tool, ToolContext } from '../tools/Tool'
import { PaintTool, RoadTool, SculptTool, WaterTool } from '../tools/TerrainTools'
import { brushCenter } from '../tools/brush'
import { PlaceTool, SelectTool, removeCommand, transformCommand } from '../tools/ObjectTools'
import type { WorldObject } from '../world/ObjectLayer'
import { getFallbackTextures } from '../terrain/textures'
import { loadTexture, setMaxAnisotropy } from '../wow/api'
import { getAsset } from '../models/assets'

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
  readonly raycaster = new THREE.Raycaster()
  /** All open maps (document tabs); `doc` is the one being edited. */
  readonly documents: MapDocument[] = []
  private doc!: MapDocument

  get terrain() {
    return this.doc.terrain
  }
  get water() {
    return this.doc.water
  }
  get objects() {
    return this.doc.objects
  }
  get history() {
    return this.doc.history
  }

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
  private selectionHelper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(1, 0.85, 0.2))
  private tmpBox = new THREE.Box3()
  private tmpM = new THREE.Matrix4()
  /** Merges a burst of key nudges on one object into a single undo step. */
  private nudgeSession: { id: number; before: WorldObject; cmd: Command; time: number } | null = null
  private viewDistance = 1
  private fogEnabled = true
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
    // The camera rides on the water surface where the ground is submerged.
    this.controller = new CameraController(this.camera, canvas, (x, z) => {
      const h = this.terrain.heightAt(x, z)
      return editor.waterEnabled ? Math.max(h, editor.waterLevel) : h
    })

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

    this.controller.arrowsBlocked = () => this.canNudge()
    this.selectionHelper.visible = false
    this.scene.add(this.selectionHelper)

    this.bindPointer()
    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(container)
    this.resize()
    this.newDocument(256, 'ocean', 0)
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
    for (const d of this.documents) d.dispose()
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
    if (editor.tool !== 'select' && editor.tool !== 'place') editor.selected = null
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
    const radius = editor.tool === 'road' ? Math.max(1.5, editor.brush.radius * 0.5) : editor.brush.radius
    const square = editor.brush.shape === 'square'
    if (this.hit) {
      const [bx, bz] = brushCenter(this.hit.x, this.hit.z, radius, this.terrain.cellSize, square && editor.brush.snap)
      u.brushPos.value.set(bx, bz)
    }
    u.brushRadius.value = radius
    u.brushSquare.value = square ? 1 : 0
    u.gridVisible.value = editor.grid ? 1 : 0
    u.cliffAuto.value = editor.autoCliff ? 1 : 0
    u.waterLevel.value = editor.waterLevel
    u.waterEnabled.value = editor.waterEnabled ? 1 : 0
    this.water.level = editor.waterLevel
    this.water.visible = editor.waterEnabled

    this.updateSelectionHelper()
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

  private applyViewDistance() {
    const w = this.terrain.worldSize
    const d = this.viewDistance
    this.scene.fog = this.fogEnabled ? new THREE.Fog(HORIZON, w * 0.5 * d, w * 2.2 * d) : null
    this.camera.far = Math.max(2000, w * 4 * d)
    this.camera.updateProjectionMatrix()
  }

  /** Apply user preferences (graphics + camera). Cheap; safe to call often. */
  applyPrefs(p: Prefs) {
    const ratio = Math.min(window.devicePixelRatio * p.renderScale, 3)
    if (this.renderer.getPixelRatio() !== ratio) {
      this.renderer.setPixelRatio(ratio)
      this.resize()
    }
    if (this.viewDistance !== p.viewDistance || this.fogEnabled !== p.fog) {
      this.viewDistance = p.viewDistance
      this.fogEnabled = p.fog
      this.applyViewDistance()
    }
    this.controller.speed = p.cameraSpeed
    this.controller.sensitivity = p.mouseSensitivity
    this.controller.invertY = p.invertY
  }

  /** Bind each paint layer to its procedural or WoW tileset texture. */
  private syncLayerTextures() {
    const want = editor.layerTextures
    for (let i = 0; i < want.length; i++) {
      const path = want[i] ?? ''
      const bound = this.doc.boundLayers
      if (bound[i] === path) continue
      bound[i] = path
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
          if (bound[i] === path && material.uniforms['tex' + i] === uniform) uniform.value = t
        })
        .catch((e) => {
          setStatus(`Texture failed: ${e}`, 6000)
          if (bound[i] === path) uniform.value = procedural
        })
    }
  }

  // ---------------------------------------------------------------- documents

  /** Copy the live editor state into the active document. */
  private stashActive() {
    const d = this.doc
    if (!d) return
    d.meta = {
      mapName: editor.mapName,
      filePath: editor.filePath,
      dirty: editor.dirty,
      layerTextures: [...editor.layerTextures],
      texScale: editor.texScale,
      waterLevel: editor.waterLevel,
      waterEnabled: editor.waterEnabled,
      paintLayer: editor.paintLayer,
    }
    const c = this.controller
    d.camera = { target: c.target.clone(), yaw: c.yaw, pitch: c.pitch, distance: c.distance }
  }

  private syncTabs() {
    docs.tabs = this.documents.map((d) =>
      d === this.doc
        ? { id: d.id, name: editor.mapName, dirty: editor.dirty, size: d.terrain.size }
        : { id: d.id, name: d.meta.mapName, dirty: d.meta.dirty, size: d.terrain.size },
    )
    docs.active = this.doc.id
  }

  /** Make `d` the edited/rendered document. `stash` saves the current one first. */
  private activate(d: MapDocument, stash = true) {
    if (this.leftDown) {
      this.activeTool?.onUp?.(this.ctx, this.hit, new PointerEvent('pointerup'))
      this.leftDown = false
    }
    if (stash && this.doc && this.doc !== d) {
      this.stashActive()
      this.scene.remove(this.doc.terrain.group, this.doc.water.mesh, this.doc.objects.group)
    }
    this.doc = d
    this.scene.add(d.terrain.group, d.water.mesh, d.objects.group)
    const m = d.meta
    editor.mapName = m.mapName
    editor.filePath = m.filePath
    editor.layerTextures = [...m.layerTextures]
    editor.texScale = m.texScale
    editor.waterLevel = m.waterLevel
    editor.waterEnabled = m.waterEnabled
    editor.paintLayer = m.paintLayer
    editor.mapSize = d.terrain.size
    editor.selected = null
    this.nudgeSession = null
    this.controller.bounds = d.terrain.worldSize
    this.controller.maxDistance = d.terrain.worldSize * 1.6
    if (d.camera) {
      this.controller.target.copy(d.camera.target)
      this.controller.yaw = d.camera.yaw
      this.controller.pitch = d.camera.pitch
      this.controller.distance = d.camera.distance
    } else {
      const c = d.terrain.worldSize / 2
      this.controller.focus(c, c, d.terrain.worldSize * 0.35)
    }
    this.applyViewDistance()
    d.history.refresh()
    editor.dirty = m.dirty
    this.syncTabs()
  }

  private addDocument(d: MapDocument) {
    // Opening a file into an untouched empty tab replaces it, like most editors.
    const replace = this.doc?.pristine ? this.doc : null
    this.documents.push(d)
    this.activate(d)
    if (replace) this.closeDocument(replace.id)
  }

  /** Create a new map in its own tab. */
  newDocument(size: number, kind: GenerateKind, seed: number, name = 'Untitled') {
    const d = new MapDocument(size, this.uniqueName(name))
    d.terrain.generate(kind, seed)
    d.meta.waterLevel = kind === 'ocean' || kind === 'island' ? 0 : kind === 'flat' ? -2 : -1
    d.meta.waterEnabled = kind !== 'flat'
    d.terrain.autoPaint(d.meta.waterLevel, d.meta.waterEnabled)
    this.documents.push(d)
    this.activate(d)
    return d
  }

  private uniqueName(base: string) {
    const names = new Set(this.documents.map((d) => (d === this.doc ? editor.mapName : d.meta.mapName)))
    if (!names.has(base)) return base
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`
  }

  switchDocument(id: number) {
    const d = this.documents.find((x) => x.id === id)
    if (d && d !== this.doc) this.activate(d)
  }

  /** Cycle tabs (Ctrl+Tab / Ctrl+Shift+Tab). */
  cycleDocument(dir: 1 | -1) {
    const i = this.documents.indexOf(this.doc)
    const n = this.documents.length
    this.activate(this.documents[(i + dir + n) % n])
  }

  /** Switch to the tab already showing `path`, if any. */
  focusPath(path: string): boolean {
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
    const d = this.documents.find((x) => norm(x === this.doc ? editor.filePath : x.meta.filePath) === norm(path))
    if (d) this.activate(d)
    return !!d
  }

  isDirty(id: number) {
    const d = this.documents.find((x) => x.id === id)
    return !!d && (d === this.doc ? editor.dirty : d.meta.dirty)
  }

  anyDirty() {
    return this.documents.some((d) => this.isDirty(d.id))
  }

  /** Close a tab without asking (the UI confirms unsaved changes first). */
  closeDocument(id: number) {
    const i = this.documents.findIndex((x) => x.id === id)
    if (i < 0) return
    const d = this.documents[i]
    this.documents.splice(i, 1)
    if (d === this.doc) {
      this.scene.remove(d.terrain.group, d.water.mesh, d.objects.group)
      const next = this.documents[Math.min(i, this.documents.length - 1)]
      // Keep at least one map open. The closed doc isn't stashed.
      if (next) {
        this.activate(next, false)
      } else {
        const fresh = new MapDocument(256, 'Untitled')
        fresh.terrain.generate('ocean', 0)
        fresh.terrain.autoPaint(0, true)
        this.documents.push(fresh)
        this.activate(fresh, false)
      }
    }
    d.dispose()
    this.syncTabs()
  }

  /** Keep the active tab's title/dirty marker current (called from the UI). */
  refreshTabs() {
    if (this.doc) this.syncTabs()
  }

  activeDocumentId() {
    return this.doc.id
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

  /** Open a loaded map in a new tab (replacing an untouched empty tab). */
  openDocument(m: MapSnapshot, filePath: string) {
    const verts = (m.size + 1) * (m.size + 1)
    if (m.heights.byteLength !== verts * 4) throw new Error('height data size mismatch')
    const d = new MapDocument(m.size, m.name || 'Untitled')
    const t = d.terrain
    if (m.splatRes !== t.splatRes) {
      d.dispose()
      throw new Error('splat resolution mismatch')
    }
    t.heights.set(new Float32Array(m.heights.slice().buffer))
    t.splatA.set(m.splatA)
    t.splatB.set(m.splatB)
    t.markAllDirty()
    for (const o of m.objects) d.objects.add(o)
    d.meta = {
      mapName: m.name || 'Untitled',
      filePath,
      dirty: false,
      layerTextures: Array.from({ length: 8 }, (_, i) => m.layerTextures[i] ?? ''),
      texScale: m.texScale || 8,
      waterLevel: m.waterLevel,
      waterEnabled: m.waterEnabled,
      paintLayer: 0,
    }
    this.addDocument(d)
  }

  // ---------------------------------------------------------------- editing API

  private updateSelectionHelper() {
    const o = editor.selected ? this.objects.objects.get(editor.selected.id) : undefined
    this.selectionHelper.visible = !!o
    if (!o) return
    this.tmpBox.copy(getAsset(o.type).bbox).applyMatrix4(this.objects.matrixOf(o, this.tmpM))
    this.selectionHelper.box.copy(this.tmpBox)
  }

  /** Keyboard editing of the selected object applies in the Select and Place tools. */
  canNudge() {
    return !!editor.selected && (editor.tool === 'select' || editor.tool === 'place')
  }

  /**
   * Move/raise/spin the selected object. dx/dz are camera-relative (right,
   * forward); dy raises; dRot is radians. Rapid repeats merge into one undo.
   */
  nudgeSelected(right: number, forward: number, dy: number, dRot: number) {
    if (!editor.selected) return
    const o = this.objects.objects.get(editor.selected.id)
    if (!o) return
    const now = performance.now()
    const s = this.nudgeSession
    const continuing = s && s.id === o.id && this.history.peek() === s.cmd && now - s.time < 1500
    const before = continuing ? s!.before : { ...o }
    const yaw = this.controller.yaw
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    o.x = THREE.MathUtils.clamp(o.x + fx * forward - fz * right, 0, this.terrain.worldSize)
    o.z = THREE.MathUtils.clamp(o.z + fz * forward + fx * right, 0, this.terrain.worldSize)
    o.yOff += dy
    o.rotY += dRot
    this.objects.touch(o.id)
    editor.selected = { ...o }
    const cmd = transformCommand(this.objects, before, o)
    if (continuing) this.history.replaceTop(cmd)
    else this.history.push(cmd)
    this.nudgeSession = { id: o.id, before, cmd, time: now }
  }

  /** Keys for the selected object. Returns true if handled. */
  handleSelectionKey(e: KeyboardEvent): boolean {
    if (!this.canNudge()) return false
    const big = e.shiftKey
    const step = big ? 4 : 0.5
    const lift = big ? 2 : 0.25
    const spin = THREE.MathUtils.degToRad(e.altKey ? 5 : 15)
    switch (e.key) {
      case 'ArrowLeft':
        if (e.altKey) this.nudgeSelected(0, 0, 0, spin)
        else this.nudgeSelected(-step, 0, 0, 0)
        return true
      case 'ArrowRight':
        if (e.altKey) this.nudgeSelected(0, 0, 0, -spin)
        else this.nudgeSelected(step, 0, 0, 0)
        return true
      case 'ArrowUp':
        if (e.altKey) this.nudgeSelected(0, 0, lift, 0)
        else this.nudgeSelected(0, step, 0, 0)
        return true
      case 'ArrowDown':
        if (e.altKey) this.nudgeSelected(0, 0, -lift, 0)
        else this.nudgeSelected(0, -step, 0, 0)
        return true
      case 'PageUp':
        this.nudgeSelected(0, 0, lift, 0)
        return true
      case 'PageDown':
        this.nudgeSelected(0, 0, -lift, 0)
        return true
      case 'r':
      case 'R':
        this.nudgeSelected(0, 0, 0, e.shiftKey ? -spin : spin)
        return true
      case 'Delete':
      case 'Backspace':
        this.deleteSelected()
        return true
      case 'Escape':
        editor.selected = null
        return true
    }
    return false
  }

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

  /** Fraction of the map covered by each paint slot (sampled, 0..1). */
  layerCoverage(): number[] {
    const u = this.slotUsage()
    const total = u.reduce((a, b) => a + b, 0) || 1
    return u.map((v) => v / total)
  }

  /** Unassign a slot's texture (undoable). */
  clearLayerTexture(i: number) {
    const before = editor.layerTextures[i]
    if (!before) return
    editor.layerTextures[i] = ''
    this.history.push({
      label: 'Clear layer texture',
      undo: () => (editor.layerTextures[i] = before),
      redo: () => (editor.layerTextures[i] = ''),
    })
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
