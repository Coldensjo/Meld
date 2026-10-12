import * as THREE from 'three'
import type { GenerateKind } from '../terrain/Terrain'
import type { Command } from '../state/history'
import { docs, editor, setStatus, stats, ui, type Prefs, type ToolId } from '../state/editor.svelte'
import { MapDocument, regionLabel, type Bookmark, type RegionRef, type VmangosRef } from './MapDocument'
import type { ExportInput } from '../io/vmangosExport'
import type { adt, vmangos } from '../../../wailsjs/go/models'
import { liquidMesh } from '../world/LiquidLayer'
import { CameraController } from './CameraController'
import { Environment } from './Environment'
import type { Tool, ToolContext } from '../tools/Tool'
import { PaintTool, RoadTool, SculptTool, WaterTool } from '../tools/TerrainTools'
import { TerrainStroke, brushCenter, paintPixel, type Rect } from '../tools/brush'
import { PlaceTool, SelectTool, removeCommand, transformCommand } from '../tools/ObjectTools'
import { MarqueeTool } from '../tools/MarqueeTool'
import { ClearTool } from '../tools/ClearTool'
import { copyRegion, pasteRegion, type MapClip } from '../world/clipboard'
import type { WorldObject } from '../world/ObjectLayer'
import { LAYERS } from '../terrain/layers'
import { CHUNK_CELLS, MAX_PALETTE, clearPalette, convertGlobalLayers, paletteCoverage, paletteIndex, replacePalette } from '../terrain/chunkPaint'
import { isColor } from '../terrain/paletteArray'
import { setMaxAnisotropy } from '../wow/api'
import { animatedAssets, getAsset } from '../models/assets'
import { PropEffects } from '../world/PropEffects'
import { SelectionOutline } from './SelectionOutline'
import { TransformGizmo, type GizmoHandle } from './TransformGizmo'

/** A block of the client's tiles, ready to open: its heights, paint and models in the editor's form. */
export interface RegionOpen {
  mapName: string
  x: number
  y: number
  size: number
  heights: Float32Array
  weights: Uint8Array
  chunkSlots: Uint8Array
  palette: string[]
  objects: RegionObject[]
  /** The client's water, as the region's chunks hold it. */
  liquids: adt.Liquid[]
}

/** A model of a region: its file ID (0 when it's new), type, and world placement. */
export interface RegionObject {
  uid: number
  type: string
  x: number
  y: number
  z: number
  rotY: number
  tiltX?: number
  tiltZ?: number
  scale: number
}

/** A 1.12 tile is 128 cells a side, which is the editor's map size for one tile. */
const TILE_CELLS = 128

export interface MapSnapshot {
  name: string
  size: number
  cellSize: number
  splatRes: number
  waterLevel: number
  waterEnabled: boolean
  /**
   * Includes ids so attachments (`parent`) survive save/load. `uid` is a model's unique ID in the
   * client's files, for a model of a client region.
   */
  objects: Array<WorldObject & { uid?: number }>
  /** The client region the map is a block of, so saves go back to it. */
  region: Pick<RegionRef, 'mapName' | 'x' | 'y' | 'size'> | null
  /** The server folder map this map publishes under. */
  vmangos: VmangosRef | null
  /** The texture palette (format 2). */
  palette: string[]
  texScale: number
  heights: Uint8Array
  /** Four weights per splat texel (format 2). */
  weights: Uint8Array
  /** Four palette indices per paint chunk (format 2). */
  chunkSlots: Uint8Array
  /** Format 1 maps only, converted on open: the eight global layers and their splats. */
  legacy?: { layerTextures: string[]; splatA: Uint8Array; splatB: Uint8Array }
}


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

  private env: Environment
  private effects = new PropEffects()
  /** Current hour; advances on its own when the day cycle is on. */
  private hour = 13
  private prefs: Prefs | null = null
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
    startWorldY: number
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
    this.scene.background = new THREE.Color()
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.env = new Environment(this.scene)
    this.scene.add(this.effects.group)


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
      get spawns() { return self.doc.spawnLayer },
      get objects() { return self.objects },
      get history() { return self.history },
      get scene() { return self.scene },
      get raycaster() { return self.raycaster },
      surface: (exclude?: Set<number>) => self.surfaceHit(exclude),
      pressure: () => (self.prefs?.tabletSupport ? self.penPressure : 1),
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
      clear: new ClearTool(),
    }

    this.controller.arrowsBlocked = () => this.canNudge()
    this.controller.wheelBlocked = (e) => editor.tool === 'place' && (e.ctrlKey || e.altKey)
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
    this.env.dispose()
    this.effects.dispose()
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

  /** The pen's last pressure, or 1 when the pointer isn't a pen. */
  private penPressure = 1

  private updatePointer(e: PointerEvent) {
    this.penPressure = e.pointerType === 'pen' ? e.pressure : 1
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
        if (editor.tool !== 'place' || !(e.ctrlKey || e.altKey)) return
        const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY // lines → pixels
        this.wheelAcc += delta
        const notch = 100
        while (Math.abs(this.wheelAcc) >= notch) {
          const dir = Math.sign(this.wheelAcc)
          this.wheelAcc -= dir * notch
          // Ctrl+scroll rotates the preview; Alt+scroll raises/lowers it (0.25 per notch).
          if (e.ctrlKey) this.placeTool.rotatePreview(-dir * THREE.MathUtils.degToRad(15))
          else editor.placeHeight = Math.round((editor.placeHeight - dir * 0.25) * 100) / 100
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
        if (editor.tool === 'paint') this.refreshMaskState()
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
    this.updateEnvironment(dt, time)

    if (this.pointerInside && !this.controller.isDragging) this.pick()
    else if (!this.leftDown) this.hit = null

    const tool = this.activeTool!
    if (this.leftDown) tool.tick?.(this.ctx, dt, this.hit)
    tool.frame?.(this.ctx, this.hit)

    this.syncPalette()
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
    u.chunkLineWorld.value = editor.chunkLines ? CHUNK_CELLS * this.terrain.cellSize : 0
    // Strong red while editing the mask; faint while painting so results stay visible.
    const painting = editor.tool === 'paint' || editor.tool === 'road'
    u.maskVisible.value = !painting ? 0 : editor.tool === 'paint' && editor.paintMode === 'mask' ? 0.45 : ui.maskActive ? 0.15 : 0
    this.updateSelectionUniforms(time)
    u.cliffAuto.value = editor.autoCliff ? 1 : 0
    u.waterLevel.value = editor.waterLevel
    u.waterEnabled.value = editor.waterEnabled ? 1 : 0
    this.water.level = editor.waterLevel
    this.water.visible = editor.waterEnabled

    if (this.prefs?.animations !== false) {
      const ms = time * 1000
      for (const a of animatedAssets) a.anim?.update(ms)
    }
    this.terrain.update()
    // A hidden object can't stay selected once hidden objects stop being drawn.
    if (this.objects.setShowHidden(ui.showHiddenModels) && editor.selected && this.objects.isHidden(editor.selected.id)) editor.selected = null
    this.objects.update()
    this.effects.enabled = this.prefs?.propEffects !== false
    this.effects.update(this.objects, time, this.controller.target, this.env.state.night)
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
    this.scene.fog = this.fogEnabled ? new THREE.Fog(this.env.state.horizon.clone(), w * 0.5 * d, w * 2.2 * d) : null
    this.camera.far = Math.max(2000, w * 4 * d)
    this.camera.updateProjectionMatrix()
  }

  /** Time of day, sky and lighting; feeds the terrain/water shaders. */
  private updateEnvironment(dt: number, time: number) {
    const p = this.prefs
    if (p?.dayCycle) this.hour = (this.hour + (dt * 24) / (Math.max(0.5, p.cycleMinutes) * 60)) % 24
    const env = this.env
    env.update(this.hour, time, this.camera)
    const s = env.state
    ;(this.scene.background as THREE.Color).copy(s.horizon)
    if (this.scene.fog) this.scene.fog.color.copy(s.horizon)

    const tu = this.terrain.material.uniforms
    tu.sunDir.value.copy(s.keyDir)
    tu.sunColor.value.copy(s.keyColor)
    tu.skyAmbient.value.copy(s.skyAmbient)
    tu.groundAmbient.value.copy(s.groundAmbient)
    const light = 0.06 + 0.94 * (1 - s.night)
    tu.waterDeep.value.setRGB(0.03 * light, 0.12 * light, 0.18 * light)

    const wu = this.water.material.uniforms
    wu.sunDir.value.copy(s.keyDir)
    wu.sunColor.value.copy(s.keyColor)
    wu.skyColor.value.copy(s.horizon).lerp(s.skyAmbient, 0.3)
    wu.shallow.value.setRGB(0.04 * light, 0.28 * light, 0.38 * light)
    wu.deep.value.setRGB(0.015 * light, 0.1 * light, 0.2 * light)
    ;(this.water.floor.material as THREE.MeshBasicMaterial).color.setRGB(0.03 * light, 0.12 * light, 0.18 * light)

    if (env.key.castShadow) {
      const extent = THREE.MathUtils.clamp(this.controller.distance * 1.3, 40, 700)
      env.updateShadow(this.controller.target, extent, env.key.shadow.mapSize.x)
    }
  }

  /** Apply user preferences (graphics + camera). Cheap; safe to call often. */
  applyPrefs(p: Prefs) {
    this.prefs = p
    if (!p.dayCycle) this.hour = p.timeOfDay
    this.env.setClouds(p.clouds)
    this.env.setShadows(p.shadows)
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
    this.applyLayerVisibility(p)
  }

  /** Shows or hides the terrain, water and objects, and draws the terrain as a wireframe. */
  private applyLayerVisibility(p: Prefs) {
    const d = this.doc
    if (!d) return
    d.terrain.group.visible = p.showTerrain
    d.terrain.material.wireframe = p.wireframe
    // A region's water is the client's, drawn per chunk; the flat sea-level plane is for maps made here.
    d.water.mesh.visible = p.showWater && !d.meta.region
    d.liquids.visible = p.showWater
    d.objects.group.visible = p.showObjects
    d.spawnLayer.setKinds({ monster: p.showMonsters, npc: p.showNpcs, object: p.showGameObjects })
  }

  /** Give the active terrain the palette whenever the editor's palette changes. */
  private syncPalette() {
    const key = editor.palette.join('\n')
    if (this.doc.paletteKey === key) return
    this.doc.paletteKey = key
    this.terrain.setPalette(editor.palette)
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
      palette: [...editor.palette],
      texScale: editor.texScale,
      waterLevel: editor.waterLevel,
      waterEnabled: editor.waterEnabled,
      paintLayer: editor.paintLayer,
      region: d.meta.region,
      vmangos: d.meta.vmangos,
      bookmarks: [...editor.bookmarks],
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
      this.scene.remove(this.doc.terrain.group, this.doc.water.mesh, this.doc.objects.group, this.doc.spawnLayer.group, this.doc.liquids)
    }
    this.doc = d
    this.scene.add(d.terrain.group, d.water.mesh, d.objects.group, d.spawnLayer.group, d.liquids)
    const m = d.meta
    editor.mapName = m.mapName
    editor.filePath = m.filePath
    editor.palette = [...m.palette]
    editor.bookmarks = [...m.bookmarks]
    editor.texScale = m.texScale
    editor.waterLevel = m.waterLevel
    editor.waterEnabled = m.waterEnabled
    editor.paintLayer = m.paintLayer
    editor.mapSize = d.terrain.size
    editor.region = m.region ? regionLabel(m.region) : ''
    editor.regionBlock = m.region ? { x: m.region.x, y: m.region.y, size: m.region.size } : null
    editor.spawns = d.spawnLayer.spawns
    ui.hiddenModels = d.objects.hidden.size
    editor.selectedSpawn = null
    d.terrain.setTileBorders(m.region ? TILE_CELLS : 0)
    editor.selected = null
    editor.selection = null
    ui.pasting = false
    this.nudgeSession = null
    this.controller.bounds = d.terrain.worldSize
    this.controller.maxDistance = d.terrain.worldSize * 1.6
    if (this.prefs) this.applyLayerVisibility(this.prefs)
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
    this.refreshMaskState()
    editor.dirty = m.dirty
    this.syncTabs()
  }

  /** Adds `d` as the active tab. It takes the place of `replace`, or of an untouched empty tab. */
  private addDocument(d: MapDocument, replace?: MapDocument) {
    // Opening a file into an untouched empty tab replaces it, like most editors.
    const old = replace ?? (this.doc?.pristine ? this.doc : null)
    this.documents.splice(replace ? this.documents.indexOf(replace) + 1 : this.documents.length, 0, d)
    this.activate(d)
    if (old) this.closeDocument(old.id)
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
  /**
   * Open a block of the client's tiles in its own tab, or switch to it if it's open already. The
   * heights, palette and paint come from tileImport.ts. Each model becomes an object at its place
   * on the ground, remembering its file ID. Returns the new document, or null when the block was
   * already open.
   */
  openRegion(r: RegionOpen): MapDocument | null {
    const same = this.documents.find((d) => {
      const o = d.meta.region
      return !!o && o.mapName === r.mapName && o.x === r.x && o.y === r.y && o.size === r.size
    })
    if (same) {
      this.activate(same)
      return null
    }
    const d = new MapDocument(r.size * TILE_CELLS, `${r.mapName} ${r.x}_${r.y} ${r.size}x${r.size}`)
    d.terrain.heights.set(r.heights)
    d.terrain.weights.set(r.weights)
    d.terrain.chunkSlots.set(r.chunkSlots)
    d.terrain.markAllDirty()
    d.meta.palette = [...r.palette]
    const water = liquidMesh(r.liquids, d.terrain.cellSize)
    if (water) d.liquids.add(water)
    const region: RegionRef = { mapName: r.mapName, x: r.x, y: r.y, size: r.size, uids: new Map() }
    d.meta.region = region
    for (const o of r.objects) {
      const placed = d.objects.add({
        type: o.type,
        x: o.x,
        z: o.z,
        yOff: o.y - d.terrain.heightAt(o.x, o.z),
        rotY: o.rotY,
        scale: o.scale,
        tiltX: o.tiltX,
        tiltZ: o.tiltZ,
      })
      if (o.uid) region.uids.set(placed.id, o.uid)
    }
    // The client's water isn't read yet, so a block starts with the water off rather than at sea level.
    d.meta.waterEnabled = false
    this.addDocument(d)
    return d
  }

  /**
   * Gives a region's document its creatures and game objects, from the world database. The
   * document may no longer be the active tab by the time they arrive; the layer is kept either way.
   */
  setSpawns(d: MapDocument, spawns: vmangos.WorldSpawn[]) {
    d.spawnLayer.set(spawns)
    if (d === this.doc) editor.spawns = spawns
    if (this.prefs) this.applyLayerVisibility(this.prefs)
  }

  /** Moves the camera to a spawn, in the active region's coordinates. */
  focusSpawn(s: vmangos.WorldSpawn) {
    this.controller.focus(s.x, s.z, 40)
  }

  /**
   * A new map to export for the 1.12 client, of tiles x tiles 128-cell tiles. It's made the same as
   * any new map, then marked with its folder and map ID.
   */
  newVmangosDocument(tiles: number, kind: GenerateKind, seed: number, ref: VmangosRef): MapDocument {
    const d = this.newDocument(tiles * TILE_CELLS, kind, seed, ref.dir)
    d.meta.vmangos = { ...ref }
    return d
  }

  /** The active map's client folder and map ID, when it was made for the client. */
  activeVmangos(): VmangosRef | null {
    return this.doc.meta.vmangos
  }

  /** The active map as the client export takes it. */
  exportInput(): ExportInput {
    const t = this.terrain
    const objects = this.objects.list().map((o) => {
      const w = this.objects.worldPlacement(o)
      return { type: o.type, x: w.pos.x, y: w.pos.y, z: w.pos.z, rotY: w.rot, scale: w.scale, tiltX: o.tiltX ?? 0, tiltZ: o.tiltZ ?? 0 }
    })
    return {
      size: t.size,
      cellSize: t.cellSize,
      heights: t.heights,
      weights: t.weights,
      chunkSlots: t.chunkSlots,
      palette: editor.palette,
      objects,
      waterEnabled: editor.waterEnabled,
      waterLevel: editor.waterLevel,
    }
  }

  /** The client region the active map came from, or null. */
  activeRegion(): RegionRef | null {
    return this.doc.meta.region
  }

  /** The active region's models in world coordinates, with the file ID each came from (0 if new). */
  regionObjects(): RegionObject[] {
    const d = this.doc
    const region = d.meta.region
    if (!region) return []
    const out: RegionObject[] = []
    for (const o of d.objects.objects.values()) {
      const w = d.objects.worldPlacement(o)
      out.push({ uid: region.uids.get(o.id) ?? 0, type: o.type, x: w.pos.x, y: w.pos.y, z: w.pos.z, rotY: w.rot, scale: w.scale, tiltX: o.tiltX ?? 0, tiltZ: o.tiltZ ?? 0 })
    }
    return out
  }

  /** The active tile's outer height grid, in the layout the tile writer takes. */
  outerHeights(): Float32Array {
    return this.terrain.heights
  }

  /**
   * Replaces every height with `next` (one vertex per entry, outerHeights' layout) as one undoable
   * step. Objects on the ground are re-snapped, as they are after sculpting.
   */
  setHeights(next: Float32Array, label: string) {
    const t = this.terrain
    const cs = t.cellSize
    const resnap = (r: Rect) => this.objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
    const stroke = new TerrainStroke(t, label, { heights: true }, resnap)
    t.heights.set(next)
    const whole = { x0: 0, z0: 0, x1: t.size, z1: t.size }
    t.markAllDirty()
    stroke.touchHeights(whole)
    const cmd = stroke.finish()
    if (cmd) this.history.push(cmd)
    resnap(whole)
  }

  /** Saves the camera's view of the open map as a bookmark. */
  addBookmark(): Bookmark {
    const c = this.controller
    const b: Bookmark = {
      name: `View ${editor.bookmarks.length + 1}`,
      x: c.target.x,
      y: c.target.y,
      z: c.target.z,
      yaw: c.yaw,
      pitch: c.pitch,
      distance: c.distance,
    }
    editor.bookmarks = [...editor.bookmarks, b]
    setStatus(`Bookmarked ${b.name}. Pick it in the Bookmarks menu to return.`)
    return b
  }

  /** Moves the camera to bookmark `i`. */
  gotoBookmark(i: number) {
    const b = editor.bookmarks[i]
    if (!b) return
    const c = this.controller
    c.target.set(b.x, b.y, b.z)
    c.yaw = b.yaw
    c.pitch = b.pitch
    c.distance = b.distance
  }

  clearBookmarks() {
    editor.bookmarks = []
  }

  /** Turns the camera round to look the other way. */
  turnCameraAround() {
    this.controller.yaw += Math.PI
  }

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
      this.scene.remove(d.terrain.group, d.water.mesh, d.objects.group, d.spawnLayer.group, d.liquids)
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
      objects: this.objects.list().map((o) => {
        const uid = this.doc.meta.region?.uids.get(o.id)
        return uid ? { ...o, uid } : { ...o }
      }),
      region: this.doc.meta.region ? { mapName: this.doc.meta.region.mapName, x: this.doc.meta.region.x, y: this.doc.meta.region.y, size: this.doc.meta.region.size } : null,
      vmangos: this.doc.meta.vmangos,
      palette: [...editor.palette],
      texScale: editor.texScale,
      heights: new Uint8Array(t.heights.buffer, t.heights.byteOffset, t.heights.byteLength),
      weights: t.weights,
      chunkSlots: t.chunkSlots,
    }
  }

  /**
   * Open a loaded map in a new tab (replacing an untouched empty tab). With `replaceId`, the map takes
   * that tab's place instead and keeps its camera and bookmarks, which is how Revert drops a map's
   * unsaved changes and undo history.
   */
  openDocument(m: MapSnapshot, filePath: string, replaceId?: number) {
    const replace = replaceId === undefined ? undefined : this.documents.find((x) => x.id === replaceId)
    if (replace === this.doc) this.stashActive()
    const verts = (m.size + 1) * (m.size + 1)
    if (m.heights.byteLength !== verts * 4) throw new Error('height data size mismatch')
    const d = new MapDocument(m.size, m.name || 'Untitled', m.cellSize)
    const t = d.terrain
    let palette: string[]
    if (m.legacy) {
      // Format 1: eight global layers. Each becomes palette entry i, and the chunks keep their four strongest.
      const packed = convertGlobalLayers(t.paintChunksPerSide, t.splatRes, m.splatRes, m.legacy.splatA, m.legacy.splatB)
      t.weights.set(packed.weights)
      t.chunkSlots.set(packed.chunkSlots)
      palette = Array.from({ length: LAYERS.length }, (_, i) => m.legacy!.layerTextures[i] || LAYERS[i].swatch)
    } else {
      if (m.weights.length !== t.weights.length || m.chunkSlots.length !== t.chunkSlots.length) {
        d.dispose()
        throw new Error('paint data size mismatch')
      }
      t.weights.set(m.weights)
      t.chunkSlots.set(m.chunkSlots)
      palette = m.palette.length ? [...m.palette] : LAYERS.map((l) => l.swatch)
    }
    while (palette.length < LAYERS.length) palette.push(LAYERS[palette.length].swatch)
    t.heights.set(new Float32Array(m.heights.slice().buffer))
    t.markAllDirty()
    const region: RegionRef | null = m.region ? { ...m.region, uids: new Map() } : null
    for (const o of m.objects) {
      const { uid, ...rest } = o
      const placed = d.objects.add(rest)
      if (uid && region) region.uids.set(placed.id, uid)
    }
    d.meta = {
      mapName: m.name || 'Untitled',
      filePath,
      dirty: false,
      palette,
      region,
      vmangos: m.vmangos ?? null,
      bookmarks: [],
      texScale: m.texScale || 8,
      waterLevel: m.waterLevel,
      waterEnabled: m.waterEnabled,
      paintLayer: 0,
    }
    if (replace) {
      d.camera = replace.camera
      d.meta.bookmarks = [...replace.meta.bookmarks]
    }
    this.addDocument(d, replace)
  }

  // ---------------------------------------------------------------- surfaces

  /** Terrain or object surface under the cursor, whichever is nearer. */
  surfaceHit(exclude?: Set<number>): { point: THREE.Vector3; parent: number | null } | null {
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const groundPoint = this.terrainPointUnderRay()
    const obj = this.objects.raycastSurface(this.raycaster, exclude)
    const groundDist = groundPoint ? groundPoint.distanceTo(this.raycaster.ray.origin) : Infinity
    if (obj && obj.distance < groundDist) return { point: obj.point, parent: obj.id }
    return groundPoint ? { point: groundPoint, parent: null } : null
  }

  private terrainPointUnderRay(): THREE.Vector3 | null {
    const p = new THREE.Vector3()
    return this.terrain.raycast(this.raycaster.ray, p) ? p : null
  }

  // ---------------------------------------------------------------- paint mask

  /** Publish whether the active map's mask has anything in it. */
  refreshMaskState() {
    const m = this.terrain.mask
    let any = false
    for (let i = 0; i < m.length; i += 3) {
      if (m[i]) {
        any = true
        break
      }
    }
    ui.maskActive = any
  }

  /** Run `fn` on the mask and record it as one undo step. */
  private editMask(label: string, fn: (m: Uint8Array) => void) {
    const t = this.terrain
    const R = t.splatRes
    const stroke = new TerrainStroke(t, label, { mask: true })
    fn(t.mask)
    stroke.touchMask({ x0: 0, z0: 0, x1: R - 1, z1: R - 1 })
    t.markMaskDirty()
    const cmd = stroke.finish()
    if (cmd) this.history.push(cmd)
    this.refreshMaskState()
  }

  clearMask() {
    this.editMask('Clear mask', (m) => m.fill(0))
  }

  invertMask() {
    this.editMask('Invert mask', (m) => {
      for (let i = 0; i < m.length; i++) m[i] = 255 - m[i]
    })
  }

  /** Turn the marquee selection into a mask (added to the existing mask). */
  maskFromSelection() {
    const s = editor.selection
    if (!s) return
    const R = this.terrain.splatRes
    const tpc = R / this.terrain.size
    this.editMask('Mask selection', (m) => {
      for (let z = s.z0 * tpc; z < s.z1 * tpc; z++) for (let x = s.x0 * tpc; x < s.x1 * tpc; x++) m[z * R + x] = 255
    })
  }

  /** Paint texture slot `layer` over the whole mask (soft mask edges blend). */
  fillMask(layer: number) {
    const t = this.terrain
    const R = t.splatRes
    const m = t.mask
    let x0 = R, z0 = R, x1 = -1, z1 = -1
    for (let z = 0; z < R; z++) {
      for (let x = 0; x < R; x++) {
        if (!m[z * R + x]) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (z < z0) z0 = z
        if (z > z1) z1 = z
      }
    }
    if (x1 < 0) {
      setStatus('The mask is empty. Paint a mask first (Paint tool › Mask).')
      return
    }
    const stroke = new TerrainStroke(t, 'Fill mask', { splat: true })
    let refused = 0
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const p = z * R + x
        if (m[p] && !paintPixel(t, p, layer, m[p] / 255)) refused++
      }
    }
    stroke.touchSplat({ x0, z0, x1, z1 })
    t.markSplatDirty()
    const cmd = stroke.finish()
    if (cmd) this.history.push(cmd)
    const tex = editor.palette[layer] ?? ''
    const name = isColor(tex) ? tex : tex.slice(tex.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
    setStatus(refused ? `Filled the mask with ${name}, except where a chunk already has four textures.` : `Filled the mask with ${name}.`)
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
    this.clip = copyRegion(this.terrain, this.objects, s, editor.palette)
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
      editor.palette,
      (t) => (editor.palette = t),
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

  /** Hides the selected object for this session (H), or shows it again when it is already hidden. */
  toggleHideSelected() {
    const o = this.selectedObject()
    if (!o) return
    const hide = !this.objects.hidden.has(o.id)
    this.objects.setHidden(o.id, hide)
    if (hide && !ui.showHiddenModels) editor.selected = null
    ui.hiddenModels = this.objects.hidden.size
    setStatus(hide ? 'Model hidden. Shift+H shows all hidden models again.' : 'Model shown.', 3000)
  }

  /** Shows every hidden object of the active map again (Shift+H). */
  unhideAll() {
    const n = this.objects.hidden.size
    this.objects.clearHidden()
    ui.hiddenModels = 0
    if (n) setStatus(`${n} hidden model${n === 1 ? '' : 's'} shown again.`, 3000)
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
    // A prop resting on/holding another isn't a collision.
    const family = this.objects.descendantIds(o.id)
    for (const id of this.objects.ancestorIds(o)) family.add(id)
    for (const other of this.objects.objects.values()) {
      if (n >= this.warnBoxes.length) break
      if (family.has(other.id) || this.objects.isHidden(other.id)) continue
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
    this.gizmoDrag = { handle, before: { ...o }, startAngle, startY, startWorldY: this.objects.worldPosition(o, this.tmpV).y, planeNormal }
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
      let dy = this.dragPoint.y - d.startY
      if (snap) dy = Math.round(dy * 2) / 2
      const w = this.objects.worldPlacement(o)
      w.pos.y = d.startWorldY + dy
      this.objects.place(o, o.parent ?? null, w)
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
    if (o.rotY !== d.before.rotY || o.yOff !== d.before.yOff || o.x !== d.before.x || o.z !== d.before.z) {
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
    // Work in world space so attached props move the way the camera expects.
    const w = this.objects.worldPlacement(o)
    w.pos.x = THREE.MathUtils.clamp(w.pos.x + fx * forward - fz * right, 0, this.terrain.worldSize)
    w.pos.z = THREE.MathUtils.clamp(w.pos.z + fz * forward + fx * right, 0, this.terrain.worldSize)
    w.pos.y += dy
    w.rot += dRot
    this.objects.place(o, o.parent ?? null, w)
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
      case 'h':
        this.toggleHideSelected()
        return true
    }
    return false
  }

  undo() {
    const c = this.history.undo()
    this.syncSelection()
    this.refreshMaskState()
    return c
  }

  redo() {
    const c = this.history.redo()
    this.syncSelection()
    this.refreshMaskState()
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

  /** Places a list of models (from an object list file) as one undoable step. */
  addObjects(list: Array<Omit<WorldObject, 'id'>>) {
    const added = list.map((o) => this.objects.add({ ...o }))
    const saved = added.map((o) => ({ ...o }))
    const cmd: Command = {
      label: 'Import object list',
      undo: () => saved.forEach((o) => this.objects.remove(o.id)),
      redo: () => saved.forEach((o) => this.objects.add({ ...o })),
    }
    this.history.push(cmd)
  }

  /** Sculpt's Vertex mode: flatten the selected vertices to their mean height, or clear the selection. */
  vertexAction(action: 'flatten' | 'clear') {
    ;(this.tools.sculpt as SculptTool).vertexAction(this.ctx, action)
  }

  /**
   * Removes models that stand exactly where another model of the same type stands, keeping the
   * first of each. One undo step. Positions and turns are compared to a hundredth.
   */
  removeDuplicateModels() {
    const seen = new Map<string, WorldObject>()
    const dupes: WorldObject[] = []
    for (const o of this.objects.objects.values()) {
      const key = [o.type, o.x, o.z, o.yOff, o.rotY, o.scale, o.parent ?? ''].map((v) => (typeof v === 'number' ? Math.round(v * 100) : v)).join('|')
      if (seen.has(key)) dupes.push(o)
      else seen.set(key, o)
    }
    if (dupes.length === 0) {
      setStatus('No duplicate models.')
      return
    }
    const cmd = removeCommand(this.objects, dupes)
    cmd.redo()
    this.history.push(cmd)
    if (editor.selected && dupes.some((d) => d.id === editor.selected!.id)) editor.selected = null
    setStatus(`Removed ${dupes.length} duplicate ${dupes.length === 1 ? 'model' : 'models'}. Undo restores them.`)
  }

  /** Delete the selected object; things attached to it stay where they are (re-homed). */
  deleteSelected() {
    if (!editor.selected) return
    const target = this.objects.objects.get(editor.selected.id)
    if (!target) return
    const objects = this.objects
    const kids = objects.childrenOf(target.id)
    const kidsBefore = kids.map((k) => ({ ...k }))
    for (const k of kids) objects.place(k, target.parent ?? null, objects.worldPlacement(k))
    const kidsAfter = kids.map((k) => ({ ...k }))
    objects.remove(target.id)
    const saved = { ...target }
    const restore = (states: typeof kidsBefore) =>
      states.forEach((st) => {
        const k = objects.objects.get(st.id)
        if (!k) return
        delete k.parent
        Object.assign(k, st)
        objects.touch(k.id)
      })
    this.history.push({
      label: 'Delete',
      undo: () => {
        objects.add({ ...saved })
        restore(kidsBefore)
      },
      redo: () => {
        restore(kidsAfter)
        objects.remove(saved.id)
      },
    })
    editor.selected = null
  }

  /** Detach the selected object from what it's attached to (keeps its world placement). */
  detachSelected() {
    const o = editor.selected ? this.objects.objects.get(editor.selected.id) : undefined
    if (!o || o.parent === undefined) return
    const before = { ...o }
    this.objects.place(o, null, this.objects.worldPlacement(o))
    this.history.push(transformCommand(this.objects, before, o))
    editor.selected = { ...o }
  }

  focusSelected() {
    if (editor.selected) this.controller.focus(editor.selected.x, editor.selected.z, 30)
  }

  /** Share of the painted map each palette entry takes (sampled, 0..1). */
  layerCoverage(): number[] {
    const t = this.terrain
    return paletteCoverage(t.weights, t.chunkSlots, t.splatRes, t.paintChunksPerSide, editor.palette.length)
  }

  /**
   * Make `path` paintable: its palette index if the map has it, otherwise a new entry at the end while
   * the palette has room. Undoable. Returns the index, or -1 when the palette is full.
   */
  useTexture(path: string): number {
    const palette = editor.palette
    let index = paletteIndex(palette, path)
    if (index < 0) {
      if (palette.length >= MAX_PALETTE) {
        setStatus(`This map's texture palette is full (${MAX_PALETTE} textures).`, 6000)
        return -1
      }
      const before = [...palette]
      editor.palette = [...palette, path]
      const after = [...editor.palette]
      index = after.length - 1
      this.history.push({
        label: 'Add texture',
        undo: () => (editor.palette = [...before]),
        redo: () => (editor.palette = [...after]),
      })
    }
    editor.paintLayer = index
    return index
  }

  /** Replaces palette texture `from` with `to` across the whole map (undoable). */
  swapTexture(from: number, to: number) {
    const t = this.terrain
    const stroke = new TerrainStroke(t, 'Replace texture', { splat: true })
    replacePalette(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, from, to)
    stroke.touchSplat({ x0: 0, z0: 0, x1: t.splatRes - 1, z1: t.splatRes - 1 })
    t.markSplatDirty()
    const cmd = stroke.finish()
    if (cmd) this.history.push(cmd)
    setStatus(`Replaced the texture everywhere on the map.`)
  }

  /** Makes the whole map one texture, `to` (undoable). */
  fillTextures(to: number) {
    const t = this.terrain
    const stroke = new TerrainStroke(t, 'Fill map with texture', { splat: true })
    clearPalette(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, to)
    stroke.touchSplat({ x0: 0, z0: 0, x1: t.splatRes - 1, z1: t.splatRes - 1 })
    t.markSplatDirty()
    const cmd = stroke.finish()
    if (cmd) this.history.push(cmd)
    setStatus(`The whole map is now one texture.`)
  }

  regenerateAutoPaint() {
    const t = this.terrain
    const before = { w: t.weights.slice(), s: t.chunkSlots.slice() }
    t.autoPaint(editor.waterLevel, editor.waterEnabled)
    const after = { w: t.weights.slice(), s: t.chunkSlots.slice() }
    const apply = (s: typeof before) => {
      t.weights.set(s.w)
      t.chunkSlots.set(s.s)
      t.markSplatDirty()
    }
    this.history.push({ label: 'Auto paint', undo: () => apply(before), redo: () => apply(after) })
  }
}
