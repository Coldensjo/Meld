import * as THREE from 'three'
import type { GenerateKind } from '../terrain/Terrain'
import type { Command } from '../state/history'
import { docs, editor, setStatus, stats, ui, type Prefs, type ToolId } from '../state/editor.svelte'
import { MapDocument } from './MapDocument'
import { CameraController } from './CameraController'
import { HORIZON, createSky } from './Sky'
import type { Tool, ToolContext } from '../tools/Tool'
import { PaintTool, RoadTool, SculptTool, WaterTool } from '../tools/TerrainTools'
import { brushCenter } from '../tools/brush'
import { PlaceTool, SelectTool, removeCommand, transformCommand } from '../tools/ObjectTools'
import { MarqueeTool } from '../tools/MarqueeTool'
import { copyRegion, pasteRegion, type MapClip } from '../world/clipboard'
import type { WorldObject } from '../world/ObjectLayer'
import { getFallbackTextures } from '../terrain/textures'
import { loadTexture, setMaxAnisotropy } from '../wow/api'
import { getAsset } from '../models/assets'
import { SelectionOutline } from './SelectionOutline'
import { TransformGizmo, type GizmoHandle } from './TransformGizmo'

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
  private outline = new SelectionOutline()
  private gizmo = new TransformGizmo()
  /** Active handle drag: which handle and the state when it started. */
  private gizmoDrag: {
    handle: GizmoHandle
    before: WorldObject
    startAngle: number
    startY: number
    planeNormal: THREE.Vector3
  } | null = null
  private dragPlane = new THREE.Plane()
  private dragPoint = new THREE.Vector3()
  private tmpBox = new THREE.Box3()
  private otherBox = new THREE.Box3()
  private tmpV = new THREE.Vector3()
  private tmpM = new THREE.Matrix4()
  /** Merges a burst of key nudges on one object into a single undo step. */
  private nudgeSession: { id: number; before: WorldObject; cmd: Command; time: number } | null = null
  private marquee: MarqueeTool
  private placeTool = new PlaceTool()
  /** Accumulated Ctrl+wheel delta, so smooth trackpads rotate in steps too. */
  private wheelAcc = 0
  /** Copied region; shared by all documents so it can be pasted into another map. */
  private clip: MapClip | null = null
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

    this.marquee = new MarqueeTool({
      clipSize: () => (this.clip ? { w: this.clip.w, h: this.clip.h } : null),
      commitPaste: () => this.commitPaste(),
      cancelPaste: () => this.cancelPaste(),
    })
    this.tools = {
      select: new SelectTool(),
      marquee: this.marquee,
      sculpt: new SculptTool(),
      paint: new PaintTool(),
      road: new RoadTool(),
      water: new WaterTool(),
      place: this.placeTool,
    }

    this.controller.arrowsBlocked = () => this.canNudge()
    this.controller.wheelBlocked = (e) => editor.tool === 'place' && e.ctrlKey
    this.scene.add(this.gizmo.group)

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
    this.outline.dispose()
    for (const d of this.documents) d.dispose()
    this.renderer.dispose()
  }

  private resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    this.outline.setSize(buf.x, buf.y)
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
    // Ctrl+scroll rotates the placement preview: 15° per wheel notch.
    c.addEventListener(
      'wheel',
      (e) => {
        if (editor.tool !== 'place' || !e.ctrlKey) return
        const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY // lines → pixels
        this.wheelAcc += delta
        const notch = 100
        while (Math.abs(this.wheelAcc) >= notch) {
          const dir = Math.sign(this.wheelAcc)
          this.wheelAcc -= dir * notch
          this.placeTool.rotatePreview(-dir * THREE.MathUtils.degToRad(15))
        }
      },
      { passive: true, signal: this.abort.signal },
    )
    c.addEventListener(
      'pointerdown',
      (e) => {
        this.updatePointer(e)
        if (e.button !== 0) return
        c.setPointerCapture(e.pointerId)
        if (this.startGizmoDrag()) return
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
        if (this.gizmoDrag) {
          this.updateGizmoDrag(e.shiftKey)
          return
        }
        if (this.gizmo.visible && !this.leftDown && !this.controller.isDragging) {
          this.raycaster.setFromCamera(this.ndc, this.camera)
          const h = this.gizmo.pick(this.raycaster)
          this.gizmo.setHover(h)
          c.style.cursor = h === 'ring' ? 'grab' : h === 'arrow' ? 'ns-resize' : ''
        }
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
        if (e.button === 0 && this.gizmoDrag) {
          this.endGizmoDrag()
          return
        }
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
    this.updateSelectionUniforms(time)
    u.cliffAuto.value = editor.autoCliff ? 1 : 0
    u.waterLevel.value = editor.waterLevel
    u.waterEnabled.value = editor.waterEnabled ? 1 : 0
    this.water.level = editor.waterLevel
    this.water.visible = editor.waterEnabled

    this.terrain.update()
    this.objects.update()
    this.updateSelectionVisuals()
    this.water.update(time)
    this.renderer.render(this.scene, this.camera)
    this.outline.render(this.renderer, this.camera)

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
    editor.selection = null
    ui.pasting = false
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

  // ---------------------------------------------------------------- marquee / clipboard

  private updateSelectionUniforms(time: number) {
    const u = this.terrain.material.uniforms
    const cs = this.terrain.cellSize
    u.selTime.value = time
    const at = this.marquee.pasteAt
    if (ui.pasting && this.clip && at) {
      u.selRect.value.set(at.x * cs, at.z * cs, (at.x + this.clip.w) * cs, (at.z + this.clip.h) * cs)
      u.selMode.value = 2
    } else if (editor.selection) {
      const s = editor.selection
      u.selRect.value.set(s.x0 * cs, s.z0 * cs, s.x1 * cs, s.z1 * cs)
      u.selMode.value = 1
    } else {
      u.selMode.value = 0
    }
  }

  selectAll() {
    const n = this.terrain.size
    editor.selection = { x0: 0, z0: 0, x1: n, z1: n }
  }

  deselect() {
    editor.selection = null
    if (ui.pasting) this.cancelPaste()
  }

  /** Copy the marquee selection (terrain, textures, objects) to the clipboard. */
  copySelection(): boolean {
    const s = editor.selection
    if (!s || s.x1 <= s.x0 || s.z1 <= s.z0) {
      setStatus('Nothing selected. Use the Marquee tool (M) to select part of the map first.')
      return false
    }
    this.clip = copyRegion(this.terrain, this.objects, s, editor.layerTextures)
    ui.hasClip = true
    setStatus(`Copied ${this.clip.w}×${this.clip.h} cells and ${this.clip.objects.length} objects. Paste with Ctrl+V (works in other map tabs too).`)
    return true
  }

  /** Start placing the clipboard: a floating rect follows the mouse until clicked. */
  startPaste() {
    if (!this.clip) {
      setStatus('The clipboard is empty. Select an area with the Marquee tool and press Ctrl+C.')
      return
    }
    editor.tool = 'marquee'
    editor.selected = null
    ui.pasting = true
    this.marquee.pasteAt = null
    setStatus('Click to place the paste · Enter places it · PgUp/PgDn raise/lower · Esc cancels', 0)
  }

  cancelPaste() {
    ui.pasting = false
    setStatus('Paste cancelled.')
  }

  commitPaste() {
    const at = this.marquee.pasteAt
    if (!this.clip || !at) return
    const cmd = pasteRegion(
      this.terrain,
      this.objects,
      editor.layerTextures,
      (t) => (editor.layerTextures = t),
      this.clip,
      at.x,
      at.z,
      { ...editor.paste },
      (r) => {
        const cs = this.terrain.cellSize
        this.objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
      },
    )
    if (cmd) this.history.push(cmd)
    const n = this.terrain.size
    editor.selection = {
      x0: Math.max(0, at.x),
      z0: Math.max(0, at.z),
      x1: Math.min(n, at.x + this.clip.w),
      z1: Math.min(n, at.z + this.clip.h),
    }
    ui.pasting = false
    setStatus('Pasted. Ctrl+Z to undo.')
  }

  // ---------------------------------------------------------------- editing API

  private selectedObject(): WorldObject | undefined {
    return editor.selected ? this.objects.objects.get(editor.selected.id) : undefined
  }

  /** Outline + handles for the selected object (Select and Place tools). */
  private updateSelectionVisuals() {
    const o = this.canNudge() ? this.selectedObject() : undefined
    if (!o) {
      this.outline.setTarget(null)
      this.gizmo.hide()
      if (this.canvas.style.cursor) this.canvas.style.cursor = ''
      return
    }
    const asset = getAsset(o.type)
    this.objects.matrixOf(o, this.tmpM)
    this.outline.setTarget(asset, this.tmpM)

    this.tmpBox.copy(asset.bbox).applyMatrix4(this.tmpM)
    const size = this.tmpBox.getSize(this.tmpV)
    const base = this.objects.worldPosition(o, this.dragPoint)
    const dist = this.camera.position.distanceTo(base)
    this.gizmo.update(base, Math.max(size.x, size.z) * 0.55, this.tmpBox.max.y, dist)

    // Last: overlappingBoxes reuses the scratch matrix/vectors used above.
    this.outline.setTerrain(this.terrain)
    this.outline.setWarnBoxes(this.overlappingBoxes(o))
  }

  private warnBoxes: THREE.Box3[] = Array.from({ length: 8 }, () => new THREE.Box3())

  /**
   * World boxes of other props that overlap `o` (shrunk, since bounds are
   * loose). The outline marks the parts of `o` inside them; parts under the
   * terrain are marked by the outline shader itself.
   */
  private overlappingBoxes(o: WorldObject): THREE.Box3[] {
    const asset = getAsset(o.type)
    if (!asset.ready) return []
    const box = this.tmpBox.copy(asset.bbox).applyMatrix4(this.objects.matrixOf(o, this.tmpM))
    box.expandByVector(box.getSize(this.tmpV).multiplyScalar(-0.05))
    let n = 0
    for (const other of this.objects.objects.values()) {
      if (n >= this.warnBoxes.length) break
      if (other.id === o.id) continue
      if (Math.abs(other.x - o.x) > 200 || Math.abs(other.z - o.z) > 200) continue
      const a = getAsset(other.type)
      if (!a.ready) continue
      const ob = this.otherBox.copy(a.bbox).applyMatrix4(this.objects.matrixOf(other, this.tmpM))
      ob.expandByVector(ob.getSize(this.dragPoint).multiplyScalar(-0.05))
      if (box.intersectsBox(ob)) this.warnBoxes[n++].copy(ob)
    }
    return this.warnBoxes.slice(0, n)
  }

  // ------------------------------------------------------------- gizmo drag

  private ringAngle(p: THREE.Vector3, o: WorldObject) {
    return Math.atan2(-(p.z - o.z), p.x - o.x)
  }

  /** Begin dragging a gizmo handle under the pointer. Returns true if one was hit. */
  private startGizmoDrag(): boolean {
    const o = this.canNudge() ? this.selectedObject() : undefined
    if (!o || !this.gizmo.visible) return false
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const handle = this.gizmo.pick(this.raycaster)
    if (!handle) return false
    const planeNormal = new THREE.Vector3()
    let startAngle = 0
    let startY = 0
    if (handle === 'ring') {
      planeNormal.set(0, 1, 0)
      this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this.tmpV.set(o.x, this.gizmo.ringY, o.z))
      if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) return false
      startAngle = this.ringAngle(this.dragPoint, o)
    } else {
      // Vertical plane through the object, facing the camera.
      planeNormal.copy(this.camera.position).sub(this.tmpV.set(o.x, 0, o.z)).setY(0).normalize()
      this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this.objects.worldPosition(o, this.tmpV))
      if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) return false
      startY = this.dragPoint.y
    }
    this.gizmoDrag = { handle, before: { ...o }, startAngle, startY, planeNormal }
    this.canvas.style.cursor = handle === 'ring' ? 'grabbing' : 'ns-resize'
    return true
  }

  private updateGizmoDrag(snap: boolean) {
    const d = this.gizmoDrag
    const o = this.selectedObject()
    if (!d || !o) return
    this.raycaster.setFromCamera(this.ndc, this.camera)
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) return
    if (d.handle === 'ring') {
      let rot = d.before.rotY + (this.ringAngle(this.dragPoint, o) - d.startAngle)
      if (snap) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12)
      o.rotY = rot
    } else {
      let y = d.before.yOff + (this.dragPoint.y - d.startY)
      if (snap) y = Math.round(y * 2) / 2
      o.yOff = y
    }
    this.objects.touch(o.id)
    editor.selected = { ...o }
  }

  private endGizmoDrag() {
    const d = this.gizmoDrag
    this.gizmoDrag = null
    this.canvas.style.cursor = ''
    const o = this.selectedObject()
    if (!d || !o) return
    if (o.rotY !== d.before.rotY || o.yOff !== d.before.yOff) {
      this.history.push(transformCommand(this.objects, d.before, o))
    }
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
