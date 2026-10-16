import * as THREE from 'three'
import type { GenerateKind, Terrain } from '../terrain/Terrain'
import { presetById } from '../terrain/presets'
import type { Command } from '../state/history'
import { MAX_BRUSH_RADIUS, docs, editor, setStatus, setViewportHint, stats, type ContextItem, type DetailInfo, type Prefs, type ToolId, ui, wow } from '../state/editor.svelte'
import { MapDocument, regionLabel, type Bookmark, type RegionRef, type VmangosRef } from './MapDocument'
import type { ExportInput } from '../io/vmangosExport'
import type { adt, vmangos } from '../../../wailsjs/go/models'
import { cropLiquids, decodeLiquids, encodeLiquids, layLiquidCells, liquidsFromAdt, liquidsToAdt, liquidType, raycastLiquids, regenOpacity, type AdtLiquid, type LiquidClipCell } from '../water/liquids'
import { groundSlopeDeg } from '../world/groundTilt'
import { resetLiquidFrames, setLiquidLight, updateLiquids } from '../water/liquidMaterial'
import { BAND, lightAt, newLightAt, sceneFog, type ClientLights } from '../wow/clientLight'
import { celestialSunDir, lightingSunDir, moonDir, skyWarp, starAlpha, sunDiscScale } from '../wow/dayNight'
import { TILE_YARDS } from '../terrain/Terrain'
import { LiquidStroke } from '../water/liquidStroke'
import { CameraController } from './CameraController'
import { Environment, type ClientSky } from './Environment'
import { HorizonLayer } from '../world/HorizonLayer'
import type { Tool, ToolContext } from '../tools/Tool'
import { brushImage } from '../tools/brushImage'
import { BrushTool, PaintTool, RoadTool, SculptTool, WaterTool, waterOpacityFactor } from '../tools/TerrainTools'
import { StampTool } from '../tools/StampTool'
import { pickLayer, pickModel, pickSpawn } from '../tools/PipetteTool'
import { TerrainStroke, brushCenter, paintPixel, type Rect } from '../tools/brush'
import { editWholeMask, modifyMask } from '../tools/maskWand'
import { areaCells, areaShape, objectsInArea, setAreaCells } from '../state/areaSelection'
import { INSIDE, cellsInRect } from '../terrain/areaShape'
import { growMask, shrinkMask } from '../terrain/maskSelect'
import { ShadowStroke } from '../tools/shadowStroke'
import { modelCasters } from '../world/shadowCasters'
import { SHADOW_PER_CELL, packShadowBits, shadowBaker } from '../terrain/bakedShadows'
import { PlaceTool, SelectTool, groupTransformCommand, removeCommand, transformCommand } from '../tools/ObjectTools'
import { ClearTool } from '../tools/ClearTool'
import { SpawnLabels } from '../world/SpawnLabels'
import { MapDataTool } from '../tools/MapDataTool'
import { areaName } from '../wow/areas'
import { CHUNK_IMPASSABLE } from '../terrain/chunkFlags'
import { dragFalloff, dragRadius, stepRadius } from '../tools/brushSize'
import { NO_ROLE, guessRoles, validRoles, type TextureRoles } from '../terrain/roles'
import { groundEffectTables } from '../wow/groundEffectTables'
import { effectAt, frillDensity, effectFor, hasScopedEffects, noScopedEffects, tuftReach, type ScopedEffects, type TextureEffects } from '../world/groundEffects'

/** A plain copy of the zone and tile effect choices (they may be Svelte proxies). */
const plainScoped = (s: ScopedEffects): ScopedEffects => JSON.parse(JSON.stringify(s)) as ScopedEffects
import { layAlphamapChunk, textureWeights } from '../terrain/alphamap'
import { lookOf, looksByIndex, type TextureLooks } from '../world/textureLooks'
import { blockedCells } from '../world/GroundEffectLayer'
import { DoodadBrushTool, activeDoodadBrush } from '../tools/DoodadBrushTool'
import { SpawnBrushTool } from '../tools/SpawnBrushTool'
import { spawnType } from '../world/spawnInfo'
import type { SpawnBrushEntry } from '../tools/spawnBrush'
import { copyObjects, copyRegion, pasteObjects, pasteRegion, type MapClip, type ObjectClip } from '../world/clipboard'
import { turnObjectClip } from '../world/clipTurn'
import { mirrorClip, rotateClip } from '../world/clipRotate'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import { LAYERS } from '../terrain/layers'
import { CHUNK_CELLS, MAX_PALETTE, NO_TEXTURE, SLOTS, SPLAT_PER_CELL, chunkTextures, clearPalette, compactChunk, convertGlobalLayers, findSlot, hasEmptySlot, mergeDuplicateSlots, paletteCoverage, paletteIndex, removeSlot, replaceInChunk, replacePalette, resetTexel } from '../terrain/chunkPaint'
import { isColor } from '../terrain/paletteArray'
import { listAssets, setMaxAnisotropy } from '../wow/api'
import { runMapChecks } from '../check/run'
import type { Finding } from '../check/findings'
import { loadAreas } from '../wow/areas'
import { animatedAssets, displayName, getAsset, updateMaterialAnimations } from '../models/assets'
import { withDoodadSet } from '../models/wmoSet'
import { PropEffects } from '../world/PropEffects'
import { WmoRooms } from '../world/WmoRooms'
import { GROUND_SNAP_REACH } from '../world/particles'
import { RoomFlood } from '../world/wmoFlood'
import { RoomFogFade } from '../world/wmoFog'
import { RoomAdmit } from '../world/roomAdmit'
import { addRoomGate, beginRoomGates, endRoomGates, ROOM_MAX_GATED, setRoomFog } from '../world/roomGate'
import { toModel } from '../world/wmoRoom'
import { ParticleLayer } from '../world/ParticleLayer'
import { CloudDome } from './CloudDome'
import { serverSpot, teleportCommand, type ServerSpot } from '../io/portCoords'
import { AreaTriggerLayer, type TriggerShape } from '../world/areaTriggers'
import { antialiasAtStart } from './display'
import { frameDue } from './frameLimit'
import { GroupBoxes, ModelBoxes } from '../world/ModelBoxes'
import { isHelper } from '../models/helpers'
import type { MapInfo } from './MapDocument'
import { SelectionOutline, type OutlineTarget } from './SelectionOutline'
import { movableSelection, objectsInRect, selectObjects, selectedObjects, withGroups } from '../state/selection'
import { meanPivot, turnAbout } from '../world/pivot'
import { countHoles, fillHoles, snapToBlocks } from '../terrain/holes'
import { fitHeights, type FitOptions } from '../terrain/fitGround'
import { TransformGizmo, type GizmoHandle } from './TransformGizmo'
import type { CullView } from '../world/instanceCull'
import { spawnKey, spawnOrientation, spawnRotation } from '../world/SpawnLayer'
import { pickNearest } from '../world/pickNearest'
import { SpawnPaths } from '../world/SpawnPaths'
import { applySpawn, creatureTemplateOf, newCreatureSpawn, newObjectSpawn, selectSpawn, spawnAdd, spawnChange, spawnDelete, syncSpawnUi, withLook, withPoint, type SpawnFields } from '../world/spawnEdits'
import { AreaTriggers, Factions, MapEntries, MapLights, NextCreatureGUID, NextObjectGUID, RegionShadows, SpawnLook } from '../../../wailsjs/go/main/App'
import { base64ToBytes } from '../io/base64'

/** A block of the client's tiles, ready to open: its heights, paint and models in the editor's form. */
export interface RegionOpen {
  mapName: string
  x: number
  y: number
  size: number
  heights: Float32Array
  weights: Uint8Array
  chunkSlots: Uint8Array
  /** One byte per cell, 1 for a hole; empty when the region has none. */
  holes: Uint8Array
  /** One byte per cell, 1 where the client grows no ground effect doodads; empty when none. */
  noEffect: Uint8Array
  /** Each chunk's AreaTable.dbc ID and flags (CHUNK_IMPASSABLE), by block chunk. */
  areaIds: Uint32Array
  chunkFlags: Uint8Array
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

/** No overlap boxes, for a selection of several objects. */
const NO_BOXES: THREE.Box3[] = []
const NO_OBJECTS: readonly WorldObject[] = []

/** How far above the ground the top-down view's camera stands: over any building or mountain a map holds. */
const ORTHO_HEIGHT = 1500

/** Straight down, for finding the ground below a point. */
const DOWN = new THREE.Vector3(0, -1, 0)
/** The portal flood's seeds for a building the camera is not in: its outside leg. */
const NO_SEEDS = { inGroup: null, across: null } as const
/** How far above an orbit target `playerSpot` looks down from, in yards: a floor up to this high over the terrain is stood on. */
const PLAYER_PROBE = 3
/** How far above the ground a launched character is put, in yards, so it never starts inside the surface. */
const PLAYER_LIFT = 0.5

/** A 1.12 tile is 128 cells a side, which is the editor's map size for one tile. */
const TILE_CELLS = 128
/** A client tile's paint chunks a side. */
const TILE_PAINT_CHUNKS = TILE_CELLS / CHUNK_CELLS

/** Models whose bounds cover fewer pixels than this are not drawn, with the preference on. */
const SMALL_MODEL_PX = 1.5
/** Props whose bounds cover fewer pixels than this are drawn with their LOD (see models/lod.ts), whose error is about 1% of that. */
const LOD_PX = 100

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
  /** The palette entries that are the map's rock and dirt; null in a map saved before roles. */
  roles: TextureRoles | null
  /** The map's own ground effect per texture path. */
  textureEffects: TextureEffects
  /** The map's own look flags (animation, overbright) per texture path. */
  textureLooks: TextureLooks
  /** The map's ground effect choices per zone and per tile. */
  scopedEffects: ScopedEffects
  heights: Uint8Array
  /** Four weights per splat texel (format 2). */
  weights: Uint8Array
  /** Four palette indices per paint chunk (format 2). */
  chunkSlots: Uint8Array
  /** One byte per cell, 1 for a hole (format 3). Empty for an older map. */
  holes: Uint8Array
  /** The liquids blob (format 4, see liquids.ts); null for an older map, which has none. */
  liquids: Uint8Array | null
  /**
   * Each chunk's AreaTable.dbc ID and flags, and a byte per cell where no tufts grow (format 5);
   * null for an older map, which has none.
   */
  chunkData: { areaIds: Uint32Array; chunkFlags: Uint8Array; noEffect: Uint8Array } | null
  /** The baked shadows' bits (format 6, terrain/bakedShadows.ts); null when the map has none of its own. */
  shadows: Uint8Array | null
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
  /** The 3D view's camera, which the controller drives. */
  private persp: THREE.PerspectiveCamera
  /** The top-down 2D view's camera (U), placed over the controller's target each frame (`updateTopDown`). */
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, ORTHO_HEIGHT + 1000)
  private topDown = false
  private eyeV = new THREE.Vector3()
  /** The camera the view is drawn and picked with: the perspective one, or the top-down one while that view is on. */
  get camera(): THREE.Camera {
    return this.topDown ? this.ortho : this.persp
  }
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
  /** The WMO room the camera is in (`world/wmoRoom.ts`). */
  private rooms = new WmoRooms()
  private roomGround = (x: number, z: number): number | null =>
    this.terrain.contains(x, z) && !this.terrain.isHole(x, z) ? this.terrain.heightAt(x, z) : null
  /** The portal flood and room fog of the WMO the camera is in (`world/roomGate.ts`). */
  private roomFlood = new RoomFlood()
  /** Lets through the gate what stands in a room the flood reached (#156). */
  private roomAdmit = new RoomAdmit()
  private roomAdmits = (s: THREE.Sphere) => this.roomAdmit.admits(s)
  private roomFog = new RoomFogFade()
  private roomClip = new THREE.Matrix4()
  private outsideFlood = new RoomFlood()
  private roomInv = new THREE.Matrix4()
  private roomEyeLocal = new THREE.Vector3()
  private roomEyeModel: [number, number, number] = [0, 0, 0]
  private roomNarrow = new THREE.Matrix4()
  private roomGateFrustums: THREE.Frustum[] = []
  private roomGate: THREE.Frustum[] = []
  private roomSceneFog = { r: 0, g: 0, b: 0 }
  private roomSceneRgb = [0, 0, 0]
  private particles = new ParticleLayer()
  /** The particles' ground snap probe: terrain and models up to GROUND_SNAP_REACH below a point. */
  private snapRay = new THREE.Raycaster()
  private snapHit = new THREE.Vector3()
  private particleGround = (x: number, y: number, z: number): number | null => {
    const t = this.terrain
    let best: number | null = null
    if (t.contains(x, z) && !t.isHole(x, z)) {
      const h = t.heightAt(x, z)
      if (h <= y) best = h
    }
    this.snapRay.set(this.snapHit.set(x, y, z), DOWN)
    this.snapRay.far = GROUND_SNAP_REACH
    const obj = this.objects.raycastSurface(this.snapRay)
    if (obj && (best === null || obj.point.y > best)) best = obj.point.y
    return best
  }
  private clouds = new CloudDome()
  /** The time the clouds last moved, to advance them by. */
  private cloudsAt = 0
  private tmpColor = new THREE.Color()
  /** View › Bounding boxes: a box around every model. */
  private boxes = new ModelBoxes()
  /** The box around each selection group a selected model is in. */
  private groupBoxes = new GroupBoxes()
  /** The creatures' waypoint paths, for the active region. */
  readonly paths = new SpawnPaths()
  /** Current hour; advances on its own when the day cycle is on. */
  private hour = 13

  /** The hour the sky shows now, which the day cycle moves on without writing reactive state. */
  currentHour(): number {
    return this.hour
  }
  private prefs: Prefs | null = null
  private tools: Record<ToolId, Tool>
  private activeToolId: ToolId | null = null
  private activeTool: Tool | null = null
  private ctx: ToolContext
  private ndc = new THREE.Vector2()
  private pointerInside = false
  /** Alt is down: the pipette (Alt+click) is what a click would do, where the tool has one. */
  private altHeld = false
  private pipetteOn = false
  private leftDown = false
  /**
   * Alt+right-drag sizing the brush (Photoshop's): where it started, the size and falloff then, and the
   * ground point the brush ring stays on while the pointer moves.
   */
  private sizeDrag: { x: number; y: number; radius: number; falloff: number; hit: THREE.Vector3 } | null = null
  private hitVec = new THREE.Vector3()
  /** The client's status revision the liquids' frames were loaded for. */
  private wowRevision = -1
  private hit: THREE.Vector3 | null = null
  private clock = new THREE.Clock()
  private raf = 0
  private frames = 0
  private statTime = 0
  private resizeObs: ResizeObserver
  private outline = new SelectionOutline()
  /** Red marks (outline and tint) on the models the Clear tool's brush would delete (#131). */
  private doomOutline = new SelectionOutline({ color: new THREE.Color(1, 0.18, 0.15), fill: 0.32 })
  private doomTargets: OutlineTarget[] = []
  private doomMatrices: THREE.Matrix4[] = []
  private clearTool = new ClearTool()
  private spawnLabels: SpawnLabels
  private gizmo = new TransformGizmo()
  /** Active handle drag: which handle and the state when it started. */
  private gizmoDrag: {
    handle: GizmoHandle
    before: WorldObject
    startAngle: number
    startY: number
    startWorldY: number
    /** Scale drag: the cursor's distance from the prop's axis when the drag began, in the ring plane. */
    startDist: number
    planeNormal: THREE.Vector3
    /** The spawn being dragged instead of a model, with its facing and height before the drag. */
    spawn?: { key: string; orientation: number; y: number }
    /** A move arrow's drag: the ground direction it moves along, where the cursor met the plane, and the model's world position then. */
    move?: { axis: THREE.Vector3; from: THREE.Vector3; pos: THREE.Vector3 }
    /** A multi-selection being dragged as one: its models, their state before, and the pivot the handles work about. */
    group?: {
      targets: WorldObject[]
      before: WorldObject[]
      /** Each target's world placement when the drag began: x, z, y, yaw and scale. */
      start: Array<{ x: number; z: number; y: number; rot: number; scale: number }>
      pivot: { x: number; z: number }
    }
  } | null = null
  private dragPlane = new THREE.Plane()
  private dragPoint = new THREE.Vector3()
  private tmpBox = new THREE.Box3()
  private otherBox = new THREE.Box3()
  private tmpV = new THREE.Vector3()
  private tmpM = new THREE.Matrix4()
  /** Merges a burst of key nudges on the same selection into a single undo step. */
  private nudgeSession: { key: string; before: WorldObject[]; cmd: Command; time: number } | null = null
  private selectTool: SelectTool
  /** Scratch for the outline: one matrix per selected model, reused each frame. */
  private outlineTargets: OutlineTarget[] = []
  private outlineMatrices: THREE.Matrix4[] = []
  private placeTool = new PlaceTool({ placeSpawn: (at) => this.placeSpawnAt(at) })
  private doodadTool = new DoodadBrushTool()
  /** The looks of the spawn brush's templates (#171), by display and equipment; null while one is read. */
  private brushLooks = new Map<string, vmangos.LookResult | null>()
  /** Accumulated Ctrl+wheel delta, so smooth trackpads rotate in steps too. */
  private wheelAcc = 0
  /** Which modifier the accumulated wheel delta belongs to, so a remainder never carries over to the other. */
  private wheelMod = ''
  /** Copied region; shared by all documents so it can be pasted into another map. */
  private clip: MapClip | null = null
  /** Copied models, likewise shared. Whichever was copied last is what Paste places. */
  private objectClip: ObjectClip | null = null
  private lastCopied: 'area' | 'objects' = 'area'
  private viewDistance = 1
  private fogEnabled = true
  private abort = new AbortController()
  /** What is in view this frame, for culling the models and spawns (see world/instanceCull.ts). */
  private cullView: CullView = { frustums: [], spheres: [], eye: new THREE.Vector3(), pxPerUnit: 1, cutoffPx: 0 }
  private viewFrustum = new THREE.Frustum()
  private viewProj = new THREE.Matrix4()

  constructor(
    private canvas: HTMLCanvasElement,
    private container: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: antialiasAtStart(), powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.persp = new THREE.PerspectiveCamera(55, 1, 0.5, 5000)
    this.scene.background = new THREE.Color()
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.env = new Environment(this.scene)
    this.scene.add(this.horizon.mesh)
    this.scene.add(this.effects.group)
    this.scene.add(this.particles.group)
    this.scene.add(this.clouds.mesh)
    this.scene.add(this.boxes.lines, this.groupBoxes.lines)
    this.scene.add(this.paths.group)
    this.scene.add(this.triggerLayer.group)


    const aniso = this.renderer.capabilities.getMaxAnisotropy()
    setMaxAnisotropy(aniso)
    // The camera rides on the water surface where the ground is submerged.
    this.controller = new CameraController(this.persp, canvas, (x, z) => {
      const h = this.terrain.heightAt(x, z)
      return editor.waterEnabled ? Math.max(h, editor.waterLevel) : h
    })

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    this.ctx = {
      get terrain() { return self.terrain },
      get spawns() { return self.doc.spawnLayer },
      get paths() { return self.paths },
      get objects() { return self.objects },
      get history() { return self.history },
      get liquids() { return self.doc.liquids },
      get scene() { return self.scene },
      get raycaster() { return self.raycaster },
      surface: (exclude?: Set<number>) => self.surfaceHit(exclude),
      pressure: () => (self.prefs?.tabletSupport ? self.penPressure : 1),
      radiusPressure: () => self.radiusPressure(),
      cameraYaw: () => self.controller.yaw,
    }

    this.selectTool = new SelectTool({
      clipSize: () => (this.clip && this.lastCopied === 'area' ? { w: this.clip.w, h: this.clip.h } : null),
      objectClip: () => (this.lastCopied === 'objects' ? this.objectClip : null),
      commitPaste: () => this.commitPaste(),
      cancelPaste: () => this.cancelPaste(),
      placeSpawn: (at) => this.placeSpawnAt(at),
    })
    this.doodadTool.spawns = new SpawnBrushTool({
      newCreature: (e, x, y, z, o) => this.brushCreature(e, x, y, z, o),
      ghostType: (e) => {
        const look = this.brushLook(e)
        return look ? spawnType({ model: look.model, look: look.look, anim: look.anim }) : ''
      },
    })
    this.tools = {
      select: this.selectTool,
      sculpt: new SculptTool(),
      paint: new PaintTool(),
      road: new RoadTool(),
      water: new WaterTool(),
      place: this.placeTool,
      clear: this.clearTool,
      doodad: this.doodadTool,
      stamp: new StampTool(),
      mapdata: new MapDataTool(),
    }

    // The arrows nudge the selection, or in the Place tool offset the preview from the cursor.
    this.controller.arrowsBlocked = () => this.canNudge() || (editor.tool === 'place' && !!editor.prefab && !editor.placeScatter)
    this.controller.wheelBlocked = (e) =>
      (editor.tool === 'place' && (e.ctrlKey || e.shiftKey)) || (editor.tool === 'doodad' && e.ctrlKey) || (this.brushSizable() && e.ctrlKey) || (ui.pasting && this.lastCopied === 'objects' && e.ctrlKey)
    this.controller.rightBlocked = (e) => e.altKey && this.brushSizable()
    this.controller.onContextClick = (e) => this.openContextMenu(e)
    this.scene.add(this.gizmo.group)

    this.bindPointer()
    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(container)
    this.spawnLabels = new SpawnLabels(container)
    this.spawnLabels.blocked = (to) => this.sightBlocked(to)
    // The names take their colour from the faction's reaction (#134), once the client's tables are read.
    Factions()
      .then((list) => this.spawnLabels.setReactions(new Map((list ?? []).map((f) => [f.id, f]))))
      .catch(() => {})
    this.resize()
    this.newDocument(256, 'ocean', 0)
  }

  // ---------------------------------------------------------------- lifecycle

  start() {
    this.clock.start()
    let last = -Infinity
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop)
      // Graphics › FPS limit (#24): a frame waits for its interval; the clock's delta covers the skipped ones.
      if (!frameDue(now, last, this.prefs?.fpsLimit ?? 0)) return
      last = now
      this.frame()
    }
    loop(performance.now())
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.abort.abort()
    this.resizeObs.disconnect()
    this.controller.dispose()
    this.outline.dispose()
    this.doomOutline.dispose()
    this.spawnLabels.dispose()
    this.env.dispose()
    this.horizon.dispose()
    this.effects.dispose()
    this.particles.dispose()
    this.clouds.dispose()
    this.boxes.dispose()
    this.groupBoxes.dispose()
    this.paths.dispose()
    for (const d of this.documents) d.dispose()
    this.triggerLayer.dispose()
    this.renderer.dispose()
  }

  private resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    this.outline.setSize(buf.x, buf.y)
    this.doomOutline.setSize(buf.x, buf.y)
    this.persp.aspect = w / h
    this.persp.updateProjectionMatrix()
  }

  /**
   * The top-down 2D view (noggit's tile mode, U): an orthographic camera straight above the
   * controller's target, turned with the yaw so Q, E and a right drag still turn the map, and sized
   * so the ground spans what the 3D view would show at the controller's distance (the wheel zooms).
   * Fog is off while it is on, since the camera stands far above the ground.
   */
  private updateTopDown() {
    const shot = this.minimapShot
    const on = ui.topDown || !!shot
    this.controller.topDown = ui.topDown
    if (on !== this.topDown) {
      this.topDown = on
      this.applyViewDistance()
    }
    if (!on) return
    if (shot) {
      // A minimap tile (renderMinimapTile): the tile exactly, north up, from above everything on it.
      const o = this.ortho
      o.left = -shot.half
      o.right = shot.half
      o.top = shot.half
      o.bottom = -shot.half
      o.updateProjectionMatrix()
      o.up.set(0, 0, -1)
      o.position.set(shot.cx, shot.top + ORTHO_HEIGHT, shot.cz)
      o.lookAt(shot.cx, shot.top, shot.cz)
      o.updateMatrixWorld()
      return
    }
    const c = this.controller
    const g = this.terrain.heightAt(c.target.x, c.target.z)
    const ground = editor.waterEnabled ? Math.max(g, editor.waterLevel) : g
    const half = Math.max(2, c.distance * Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2))
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight)
    const o = this.ortho
    o.left = -half * aspect
    o.right = half * aspect
    o.top = half
    o.bottom = -half
    o.updateProjectionMatrix()
    o.up.set(-Math.sin(c.yaw), 0, -Math.cos(c.yaw))
    o.position.set(c.target.x, ground + ORTHO_HEIGHT, c.target.z)
    o.lookAt(c.target.x, ground, c.target.z)
    o.updateMatrixWorld()
  }

  /**
   * Where the view is seen from, for what sizes itself by the distance to the viewer (the gizmo's
   * handles, the grass tufts' range): the camera, or in the top-down view a point the controller's
   * distance above the target, so zooming in still brings them closer.
   */
  private viewEye(): THREE.Vector3 {
    if (!this.topDown) return this.camera.position
    const c = this.controller
    return this.eyeV.set(c.target.x, this.ortho.position.y - ORTHO_HEIGHT + c.distance, c.target.z)
  }

  // ---------------------------------------------------------------- input

  /** The pen's last pressure, or 1 when the pointer isn't a pen. */
  private penPressure = 1

  /** The pen's share of the brush radius while "Pen pressure sizes the brush" is on (#42), else 1. */
  private radiusPressure(): number {
    return this.prefs?.tabletSupport && this.prefs.tabletRadius ? Math.max(0.05, Math.min(1, this.penPressure)) : 1
  }

  private updatePointer(e: PointerEvent) {
    this.penPressure = e.pointerType === 'pen' ? e.pressure : 1
    const r = this.canvas.getBoundingClientRect()
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.pointerMoved = true
  }

  private liquidHit = new THREE.Vector3()
  /** The pointer moved since the last pick, for Camera › Locked cursor (#19). */
  private pointerMoved = false

  private pick() {
    this.raycaster.setFromCamera(this.ndc, this.camera)
    // The Hole mode aims at holes too (to fill them), so its ray stops where the ground would be.
    const solid = editor.tool === 'sculpt' && editor.sculptMode === 'hole'
    this.hit = this.terrain.raycast(this.raycaster.ray, this.hitVec, 4000, solid) ? this.hitVec : null
    if (editor.tool === 'water' && editor.waterMode === 'paint' && editor.water.onLiquids) this.pickLiquid()
  }

  /**
   * noggit's "Cursor intersects liquids": the water brush stops on a liquid's surface, or the sea's,
   * when it is nearer than the ground.
   */
  private pickLiquid() {
    const ray = this.raycaster.ray
    let best = this.hit ? this.hit.distanceTo(ray.origin) : Infinity
    let found = false
    if (raycastLiquids(this.doc.liquids, this.terrain.cellSize, ray, this.liquidHit, best)) {
      best = this.liquidHit.distanceTo(ray.origin)
      found = true
    }
    if (editor.waterEnabled && ray.direction.y !== 0) {
      const t = (editor.waterLevel - ray.origin.y) / ray.direction.y
      if (t > 0 && t < best) {
        ray.at(t, this.seaHit)
        if (this.terrain.contains(this.seaHit.x, this.seaHit.z)) {
          this.liquidHit.copy(this.seaHit)
          found = true
        }
      }
    }
    if (found) this.hit = this.hitVec.copy(this.liquidHit)
  }

  private seaHit = new THREE.Vector3()

  private bindPointer() {
    const sig = { signal: this.abort.signal }
    const c = this.canvas
    c.addEventListener('pointerenter', () => (this.pointerInside = true), sig)
    c.addEventListener('pointerleave', () => (this.pointerInside = false), sig)
    // Alt is tracked for the pipette cursor; a lost focus (Alt+Tab) releases it.
    window.addEventListener('keydown', (e) => e.key === 'Alt' && (this.altHeld = true), sig)
    window.addEventListener('keyup', (e) => e.key === 'Alt' && (this.altHeld = false), sig)
    window.addEventListener('blur', () => (this.altHeld = false), sig)
    // Ctrl+scroll rotates the placement preview (15° per notch), Shift+scroll scales it. Its height is
    // PgUp / PgDn and its offset the arrows (PlaceTool.onKey): Alt is the pipette, so Alt+scroll clashed.
    c.addEventListener(
      'wheel',
      (e) => {
        const doodads = editor.tool === 'doodad' && e.ctrlKey
        const sizing = this.brushSizable() && e.ctrlKey
        const turning = ui.pasting && this.lastCopied === 'objects' && e.ctrlKey
        if (!doodads && !sizing && !turning && (editor.tool !== 'place' || !(e.ctrlKey || e.shiftKey))) return
        const mod = e.ctrlKey ? 'ctrl' : 'shift'
        if (mod !== this.wheelMod) {
          this.wheelMod = mod
          this.wheelAcc = 0
        }
        const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY // lines → pixels
        this.wheelAcc += delta
        const notch = 100
        while (Math.abs(this.wheelAcc) >= notch) {
          const dir = Math.sign(this.wheelAcc)
          this.wheelAcc -= dir * notch
          if (turning) this.turnPastedModels(-dir * THREE.MathUtils.degToRad(15))
          else if (sizing) this.stepBrush(-dir > 0 ? 1 : -1)
          else if (doodads) this.doodadTool.spinPreview(-dir * THREE.MathUtils.degToRad(15))
          else if (e.ctrlKey) this.placeTool.rotatePreview(-dir * THREE.MathUtils.degToRad(15))
          else this.placeTool.scalePreview(-dir)
        }
      },
      { passive: true, signal: this.abort.signal },
    )
    c.addEventListener(
      'pointerdown',
      (e) => {
        this.updatePointer(e)
        // Alt+right-drag sizes the brush where it stands: sideways for the size, up and down for the falloff.
        if (e.button === 2 && e.altKey && this.brushSizable() && !this.leftDown) {
          this.pick()
          if (!this.hit) return
          try {
            c.setPointerCapture(e.pointerId)
          } catch {
            // A synthetic event (tests) has no pointer to capture.
          }
          this.sizeDrag = { x: e.clientX, y: e.clientY, radius: editor.brush.radius, falloff: editor.brush.falloff, hit: this.hit.clone() }
          this.showBrushHint()
          return
        }
        if (e.button !== 0) return
        c.setPointerCapture(e.pointerId)
        if (this.startGizmoDrag()) return
        // Alt+click is the pipette: a model's type to place, or the ground's texture to paint with.
        if (e.altKey && (editor.tool === 'select' || editor.tool === 'place')) {
          this.raycaster.setFromCamera(this.ndc, this.camera)
          const { spawn, id } = pickNearest(this.objects, this.doc.spawnLayer, this.raycaster)
          const o = id !== null ? this.objects.objects.get(id) : undefined
          if (spawn) void pickSpawn(spawn)
          else if (o) pickModel(o)
          else if (this.hit) pickLayer(this.terrain, this.hit)
          return
        }
        // Alt+click in the water brush locks its height (and angled mode's origin) to the cursor.
        if (e.altKey && editor.tool === 'water' && editor.waterMode === 'paint') {
          this.pick()
          if (this.hit) this.lockWater(this.hit)
          return
        }
        if (e.altKey && this.hit && (editor.tool === 'road' || (editor.tool === 'paint' && editor.paintMode !== 'mask'))) {
          pickLayer(this.terrain, this.hit)
          return
        }
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
        this.altHeld = e.altKey
        if (this.sizeDrag) {
          const d = this.sizeDrag
          editor.brush.radius = dragRadius(d.radius, e.clientX - d.x, 1, MAX_BRUSH_RADIUS)
          if (this.brushFalloffApplies()) editor.brush.falloff = dragFalloff(d.falloff, e.clientY - d.y)
          this.showBrushHint()
          return
        }
        if (this.gizmoDrag) {
          this.updateGizmoDrag(e.shiftKey)
          return
        }
        if (this.gizmo.visible && !this.leftDown && !this.controller.isDragging) {
          this.raycaster.setFromCamera(this.ndc, this.camera)
          const h = this.gizmo.pick(this.raycaster)
          this.gizmo.setHover(h)
          c.style.cursor = h === 'ring' ? 'grab' : h === 'arrow' ? 'ns-resize' : h === 'moveX' || h === 'moveZ' ? 'move' : ''
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
        if (e.button === 2 && this.sizeDrag) {
          this.sizeDrag = null
          return
        }
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
    if (editor.tool !== 'select' && editor.tool !== 'place') selectObjects(this.objects, [])
    this.activeToolId = editor.tool
    this.activeTool = this.tools[editor.tool]
    this.activeTool.activate?.(this.ctx)
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const time = this.clock.elapsedTime

    this.syncTool()
    this.controller.setWalk(ui.walkCamera && !this.topDown)
    this.controller.update(dt)
    this.updateTopDown()
    this.updateEnvironment(dt, time)

    if (this.sizeDrag) this.hit = this.hitVec.copy(this.sizeDrag.hit)
    else if (this.pointerInside && !this.controller.isDragging) {
      // Locked cursor (Noggit Red's): a brush's ground point stays put while the camera moves, and
      // follows only the mouse. The other tools still pick under the cursor every frame.
      if (!(this.prefs?.lockedCursor && this.activeTool?.usesBrush && this.hit && !this.pointerMoved)) this.pick()
      this.pointerMoved = false
    } else if (!this.leftDown) this.hit = null
    this.updatePipetteCursor()

    const tool = this.activeTool!
    if (this.leftDown) tool.tick?.(this.ctx, dt, this.hit)
    this.placeTool.hidePreview = this.altHeld
    tool.frame?.(this.ctx, this.hit)

    this.syncPalette()
    const u = this.terrain.material.uniforms
    this.updateLookTexture(u, time)
    u.brushVisible.value = tool.usesBrush && this.hit ? 1 : 0
    // The ring shows the radius the pen's pressure gives the brush tools (#42).
    const r0 = editor.brush.radius * (tool instanceof BrushTool ? this.radiusPressure() : 1)
    const radius = editor.tool === 'road' ? Math.max(1.5, r0 * 0.5) : r0
    // The doodad brush scatters in a circle whatever shape the other tools use.
    const square = editor.brush.shape === 'square' && editor.tool !== 'doodad'
    if (this.hit) {
      const [bx, bz] = brushCenter(this.hit.x, this.hit.z, radius, this.terrain.cellSize, square && editor.brush.snap)
      u.brushPos.value.set(bx, bz)
    }
    u.brushRadius.value = radius
    u.brushSquare.value = square ? 1 : 0
    this.updateBrushImageCursor(u, tool)
    u.gridVisible.value = editor.grid ? 1 : 0
    u.unpaintable.value = this.prefs?.showUnpaintable && editor.tool === 'paint' && editor.paintMode === 'texture' ? editor.paintLayer : -1
    u.climbCos.value = this.prefs?.climbView ? Math.cos((this.prefs.climbAngle * Math.PI) / 180) : 0
    u.contourStep.value = this.prefs?.showContours ? this.prefs.contourStep : 0
    u.chunkLineWorld.value = editor.chunkLines ? CHUNK_CELLS * this.terrain.cellSize : 0
    this.updateHoverChunk(u.chunkHover.value as THREE.Vector4)
    const md = editor.mapDataMode
    this.terrain.setMapDataOverlay(editor.tool !== 'mapdata' ? 0 : md === 'area' ? 1 : md === 'impassable' ? 2 : md === 'noTufts' ? 3 : 4)
    // Strong red while editing the mask; faint while painting so results stay visible.
    const painting = editor.tool === 'paint' || editor.tool === 'road'
    u.maskVisible.value = !painting ? 0 : editor.tool === 'paint' && editor.paintMode === 'mask' ? 0.45 : ui.maskActive ? 0.15 : 0
    this.updateSelectionUniforms(time)
    // The preview's rock on steep slopes is the map's rock role (the palette's slot 3 without one).
    u.cliffAuto.value = editor.autoCliff ? 1 : 0
    u.rockLayer.value = editor.roles.rock === NO_ROLE ? 3 : editor.roles.rock
    u.waterLevel.value = editor.waterLevel
    u.waterEnabled.value = editor.waterEnabled ? 1 : 0
    this.water.level = editor.waterLevel
    this.water.visible = editor.waterEnabled && this.prefs?.showWater !== false
    this.doc.liquidRenderer.setLayer(editor.tool === 'water' && !editor.water.allLayers ? Math.max(0, editor.water.layer | 0) : -1)
    this.doc.liquidRenderer.update()
    if (this.wowRevision !== wow.revision) {
      this.wowRevision = wow.revision
      resetLiquidFrames()
    }
    const ring = editor.tool === 'water' && editor.waterMode === 'paint' && this.hit ? { x: this.hit.x, y: this.hit.y, z: this.hit.z, radius: editor.brush.radius } : null
    updateLiquids(time * 1000, this.hour, wow.loaded, ring, this.env.state.keyDir)

    this.terrain.update(this.renderer)
    // A hidden object can't stay selected once hidden objects stop being drawn.
    if (this.objects.setShowHidden(ui.showHiddenModels) && editor.selectedIds.some((id) => this.objects.isHidden(id))) {
      selectObjects(this.objects, editor.selectedIds.filter((id) => !this.objects.isHidden(id)), editor.selected?.id)
    }
    this.objects.update()
    this.boxes.update(this.objects, this.prefs?.showBoxes === true, this.terrain.heightsVersion)
    this.updateTriggers()
    this.groupBoxes.update(this.objects, editor.selectedIds, this.terrain.heightsVersion, ui.historyVersion)
    // Lights first: culling keeps what can throw the shadowed lights' shadows.
    this.effects.enabled = this.prefs?.propEffects !== false
    this.effects.particles = this.prefs?.particles !== false
    this.effects.update(this.objects, time, this.controller.target, this.env.state.night, this.terrain.heightsVersion)
    this.updateClientPoints()
    this.rooms.update(this.objects, this.camera.position, this.roomGround)
    this.updateRoomGate(dt)
    this.cullInstances()
    this.animateModels(time)
    this.updateParticles(dt, time)
    this.updateSelectionVisuals()
    this.updateDoomVisuals()
    this.renderer.render(this.scene, this.camera)
    this.spawnLabels.update(this.doc.spawnLayer, this.camera, this.camera.position, this.container.clientWidth, this.container.clientHeight, dt)
    // The counters describe the last render call, so read the scene's before the outline passes.
    const calls = this.renderer.info.render.calls
    const triangles = this.renderer.info.render.triangles
    this.outline.render(this.renderer, this.camera)
    this.doomOutline.render(this.renderer, this.camera)

    this.frames++
    if (time - this.statTime >= 0.5) {
      stats.fps = Math.round(this.frames / (time - this.statTime))
      stats.drawCalls = calls
      stats.triangles = triangles
      stats.objects = this.objects.objects.size
      stats.cursor = this.hit ? { x: this.hit.x, y: this.hit.y, z: this.hit.z } : null
      stats.detail = this.prefs?.detailInfo ? this.detailInfo() : null
      const hoverArea = editor.tool === 'mapdata' ? this.hoverArea() : ''
      if (stats.hoverArea !== hoverArea) stats.hoverArea = hoverArea
      const c = this.controller
      stats.view = ui.minimap ? { x: c.target.x, z: c.target.z, yaw: c.yaw, cells: this.terrain.size, world: this.terrain.worldSize } : null
      this.frames = 0
      this.statTime = time
    }
  }

  /**
   * Draws only the models and spawns in view: inside the camera's frustum, or the shadow camera's so
   * what is just off screen still throws its shadow into view, and (by preference) large enough on
   * screen to see.
   */
  private cullInstances() {
    const v = this.cullView
    this.camera.updateMatrixWorld()
    this.viewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
    this.viewFrustum.setFromProjectionMatrix(this.viewProj)
    v.frustums.length = 0
    v.frustums.push(this.viewFrustum)
    for (const light of [this.env.key, this.env.far]) {
      if (!light.castShadow) continue
      light.updateMatrixWorld()
      light.shadow.updateMatrices(light)
      v.frustums.push(light.shadow.getFrustum())
    }
    v.spheres = this.effects.shadowSpheres
    // In a WMO room the open world shows only through its doorways (#116): each window the portal
    // flood left is the view narrowed to its rect, and a sealed room has none.
    const room = this.rooms.current
    if (room && !this.topDown) {
      const w = this.roomFlood.exteriorWindows
      const n = w.length / 4
      while (this.roomGateFrustums.length < n) this.roomGateFrustums.push(new THREE.Frustum())
      this.roomGate.length = 0
      for (let i = 0; i < n; i++) {
        const x0 = w[i * 4], y0 = w[i * 4 + 1], x1 = w[i * 4 + 2], y1 = w[i * 4 + 3]
        const sx = x1 - x0, sy = y1 - y0
        this.roomNarrow.set(2 / sx, 0, 0, -(x0 + x1) / sx, 0, 2 / sy, 0, -(y0 + y1) / sy, 0, 0, 1, 0, 0, 0, 0, 1).multiply(this.viewProj)
        this.roomGateFrustums[i].setFromProjectionMatrix(this.roomNarrow)
        this.roomGate.push(this.roomGateFrustums[i])
      }
      v.gate = this.roomGate
      v.gateExempt = room.id
      v.gateAdmits = this.roomAdmits
    } else {
      v.gate = null
      v.gateAdmits = null
    }
    this.terrain.gate(v.gate)
    v.eye.copy(this.camera.position)
    // Pixels per unit at a distance of one. The top-down camera stands ORTHO_HEIGHT above the ground,
    // so its constant pixels per unit is scaled by that distance.
    v.pxPerUnit = this.topDown ? (this.container.clientHeight / (2 * this.ortho.top)) * ORTHO_HEIGHT : this.container.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2))
    v.cutoffPx = this.prefs?.cullSmallModels === false ? 0 : SMALL_MODEL_PX
    v.lodPx = LOD_PX
    this.objects.cull(v)
    // Spawns show through a room's walls by preference (#150): the camera often sits inside a building
    // while the author works on the creatures around it.
    const gate = v.gate
    if (this.prefs?.spawnsThroughWalls !== false) v.gate = null
    this.doc.spawnLayer.cull(v)
    v.gate = gate
    this.updateGroundEffects()
    // The water and the tufts show through a room's doorways only, as the rest of the world (#119).
    this.doc.groundEffects.gate(v.gate ?? null)
    this.doc.liquidRenderer.gate(v.gate ?? null)
    this.water.gate(v.gate ?? null)
    this.updateBakedShadows()
    const sel = editor.selectedSpawn
    this.paths.update(this.doc.spawnLayer, sel ? spawnKey(sel) : null, editor.selectedWaypoint, !!this.prefs?.showAllPaths)
  }

  /**
   * Plays the idle animations of the model types in view: those with a placed or spawned instance on
   * the active map, the placement preview, and (while pasting) the paste's previews. Skinning runs on
   * the CPU per model type, so types loaded for other tabs or nothing at all cost nothing.
   */
  private animateModels(time: number) {
    // With animations off, a model still holds the first frame of its idle (or posed) loop rather
    // than the bind pose, which for many creatures is a T-pose. It is posed once, at time 0.
    const still = this.prefs?.animations === false
    const ms = still ? 0 : time * 1000
    const prefab = editor.tool === 'place' ? editor.prefab : ''
    const doodads = editor.tool === 'doodad'
    const spawns = this.doc.spawnLayer
    // Moving textures (waterfalls, lava) and changing colours (glows, shimmers) follow the same clock;
    // with animations off they hold still.
    updateMaterialAnimations(ms)
    for (const [type, a] of animatedAssets) {
      if (still && a.anim!.posedAt === 0) continue
      if (ui.pasting || type === prefab || (doodads && this.doodadTool.previewing(type)) || this.objects.hasVisible(type) || spawns.hasType(type)) a.anim!.update(ms)
    }
  }

  /** Runs the models' particles on the animations' clock, after the bones they ride are posed. */
  private updateParticles(dt: number, time: number) {
    const p = this.particles
    p.enabled = this.prefs?.particles !== false
    p.ground = this.particleGround
    // Lit particles take the sky light and the sun on a surface facing up, as the terrain shades.
    const tu = this.terrain.material.uniforms
    const sun = Math.max(0, (tu.sunDir.value as THREE.Vector3).y)
    p.light.copy(tu.skyAmbient.value as THREE.Color).add(this.tmpColor.copy(tu.sunColor.value as THREE.Color).multiplyScalar(sun))
    p.light.setRGB(Math.min(1, p.light.r), Math.min(1, p.light.g), Math.min(1, p.light.b))
    // With animations off the tracks hold at the loop's start, as the bones do, but the particles still fly.
    p.update(this.objects, this.doc.spawnLayer, dt, this.prefs?.animations === false ? 0 : time * 1000, this.camera, this.viewFrustum, this.cullView.gate ?? null, this.rooms.current?.id ?? -1, this.prefs?.spawnsThroughWalls !== false, this.cullView.gateAdmits ?? null)
  }

  private applyViewDistance() {
    const w = this.terrain.worldSize
    const d = this.viewDistance
    this.fogNear = w * 0.5 * d
    this.fogFar = w * 2.2 * d
    this.scene.fog = this.fogEnabled && !this.topDown ? new THREE.Fog(this.env.state.horizon.clone(), this.fogNear, this.fogFar) : null
    this.persp.far = Math.max(2000, w * 4 * d)
    this.persp.updateProjectionMatrix()
  }

  /** Time of day, sky and lighting; feeds the terrain/water shaders. */
  private updateEnvironment(dt: number, time: number) {
    const p = this.prefs
    if (p?.dayCycle) this.hour = (this.hour + (dt * 24) / (Math.max(0.5, p.cycleMinutes) * 60)) % 24
    const env = this.env
    env.update(this.hour, time, this.camera)
    const s = env.state
    // The editor's own fog distances; client lighting replaces them with the light's.
    const fog = this.scene.fog as THREE.Fog | null
    if (fog) {
      fog.near = this.fogNear
      fog.far = this.fogFar
    }
    this.applyClientLight(time)
    ;(this.scene.background as THREE.Color).copy(s.horizon)
    if (fog) fog.color.copy(s.horizon)
    this.horizon.update(this.doc.id, this.doc.meta.region, !!this.prefs?.showHorizon && wow.loaded && !this.topDown, s.horizon)

    const tu = this.terrain.material.uniforms
    tu.sunDir.value.copy(s.keyDir)
    tu.sunColor.value.copy(s.keyColor)
    tu.skyAmbient.value.copy(s.skyAmbient)
    tu.groundAmbient.value.copy(s.groundAmbient)
    const light = 0.06 + 0.94 * (1 - s.night)
    tu.waterDeep.value.setRGB(0.03 * light, 0.12 * light, 0.18 * light)

    // Under the sea the floor is deep water; with the sea off it is dark earth, seen through holes.
    const floor = this.water.floor.material as THREE.MeshBasicMaterial
    if (editor.waterEnabled) floor.color.setRGB(0.03 * light, 0.12 * light, 0.18 * light)
    else floor.color.setRGB(0.05 * light, 0.042 * light, 0.035 * light)

    if (env.key.castShadow) this.fitShadows()
    else env.aimKey(this.camera.position)
  }

  /** Lighting › Client Lighting: the client's lights of the open map, which map they are, and the light at the camera. */
  private clientLights: ClientLights | null = null
  private clientLightsMap = -1
  private clientLightsLoading = false
  private lightOut = newLightAt()
  /** View › Far Horizon: the map's WDL around an open region. */
  private horizon = new HorizonLayer()
  /** The editor's own fog distances (applyViewDistance), put back each frame before client lighting. */
  private fogNear = 0
  private fogFar = 0
  private fogOut = [0, 0]
  private sunDirOut = [0, 1, 0]
  private celestialOut = [0, 1, 0]
  private moonOut = [0, 1, 0]
  private clientSky: ClientSky = { colors: this.lightOut.colors, skyAt: BAND.skyTop * 3, fogAt: BAND.fog * 3, sunAt: BAND.sun * 3, warp: 0, sunDir: this.celestialOut, moonDir: this.moonOut, sunScale: 1, starAlpha: 0 }
  /** Map.dbc IDs by folder name (lower case), read once, to find a region's map. */
  /** The open map's area triggers (#141), drawn with View › Area triggers or while the Portals dialog edits them. */
  readonly triggerLayer = new AreaTriggerLayer()
  /** The document whose triggers were read from the client, and while it reads. */
  private triggersFor = -1
  private triggersLoading = false
  /** Set while the Portals dialog draws its own (edited) list. */
  private triggersEdited = false

  /** Draws the Portals dialog's triggers, `selected` highlighted, until endTriggerEdit. */
  showTriggers(list: readonly TriggerShape[], selected: number | null) {
    this.triggersEdited = true
    const r = this.doc.meta.region
    this.triggerLayer.set(list, r?.x ?? 0, r?.y ?? 0, selected)
  }

  /** The Portals dialog closed: View › Area triggers reads the map's triggers again (they may have been saved). */
  endTriggerEdit() {
    this.triggersEdited = false
    this.triggersFor = -1
  }

  /** Shows the triggers while asked for, reading the open map's once per document. */
  private updateTriggers() {
    const on = this.triggersEdited || this.prefs?.showAreaTriggers === true
    this.triggerLayer.group.visible = on && !this.topDown
    if (!on || this.triggersEdited || this.triggersLoading || this.triggersFor === this.doc.id) return
    const id = this.openMapId()
    if (id === null) return
    const doc = this.doc
    this.triggersLoading = true
    AreaTriggers(id)
      .then((r) => {
        if (doc !== this.doc || this.triggersEdited) return
        const reg = doc.meta.region
        this.triggerLayer.set(r.triggers ?? [], reg?.x ?? 0, reg?.y ?? 0, null)
      })
      .catch(() => this.triggerLayer.set([], 0, 0, null))
      .finally(() => {
        this.triggersLoading = false
        this.triggersFor = doc.id
      })
  }

  /**
   * Where the camera of open map `id` (a tab) is, in the server's coordinates: the active one's as
   * Launch puts the character (playerSpot), another's at its saved camera target. Null for a map with
   * no client map ID.
   */
  async spotOfDoc(id: number): Promise<ServerSpot | null> {
    const d = this.documents.find((x) => x.id === id)
    if (!d) return null
    if (d === this.doc) return this.playerSpot()
    const m = d.meta
    if (!m.vmangos && !m.region) return null
    if (!m.vmangos) await this.loadMapIds()
    const mapId = m.vmangos ? m.vmangos.mapId : (this.mapIds?.get(m.region!.mapName.toLowerCase()) ?? 0)
    const c = d.camera
    if (!c) return null
    return serverSpot(c.target.clone().setY(c.target.y + PLAYER_LIFT), mapId, m.region?.x ?? 0, m.region?.y ?? 0, c.yaw)
  }

  /** The open map's Light.dbc lights for the minimap's light zones (#26), read once per map ID. */
  private zoneLights: { id: number; lights: Promise<{ x: number; z: number; inner: number; outer: number; global: boolean; id: number }[]> } | null = null

  /**
   * The open map's lights as circles in the open block's editor coordinates (a region's lights are
   * in the whole map's frame, so its first tile is taken off), or none for a map without a client ID.
   */
  async lightZones(): Promise<{ id: number; x: number; z: number; inner: number; outer: number; global: boolean }[]> {
    const m = this.doc.meta
    if (!m.vmangos) await this.loadMapIds()
    const id = this.openMapId()
    if (id === null || (!m.vmangos && !m.region)) return []
    if (this.zoneLights?.id !== id) {
      this.zoneLights = { id, lights: MapLights(id).then((l) => (l?.lights ?? []).map((x) => ({ id: x.id, x: x.x, z: x.z, inner: x.inner, outer: x.outer, global: x.global }))).catch(() => []) }
    }
    const r = m.region
    const dx = r ? r.x * TILE_YARDS : 0, dz = r ? r.y * TILE_YARDS : 0
    return (await this.zoneLights.lights).map((l) => ({ ...l, x: l.x - dx, z: l.z - dz }))
  }

  private mapIds: Map<string, number> | null = null
  /** The client's map list being read, once asked for. */
  private mapIdsLoading: Promise<void> | null = null

  /** The open map's Map.dbc ID: a map made for the client's own, a region's by its folder, else Azeroth's (0); null while unknown. */
  /** Reads the client's map list (folder to map ID) once. */
  private loadMapIds(): Promise<void> {
    this.mapIdsLoading ??= MapEntries()
      .then((rows) => void (this.mapIds = new Map((rows ?? []).map((r) => [r.Dir.toLowerCase(), r.ID]))))
      .catch(() => void (this.mapIds = new Map()))
    return this.mapIdsLoading
  }

  private openMapId(): number | null {
    const m = this.doc.meta
    if (m.vmangos) return m.vmangos.mapId
    if (!m.region) return 0
    if (!this.mapIds) {
      void this.loadMapIds()
      return null
    }
    return this.mapIds.get(m.region.mapName.toLowerCase()) ?? 0
  }

  /**
   * Sets the open client map's own facts (Map Properties: type, name, zone, loading screen, players,
   * ghost entrance), written on publish; one undo step.
   */
  setMapInfo(info: MapInfo) {
    const ref = this.doc.meta.vmangos
    if (!ref) return
    const before = ref.info ? { ...ref.info } : undefined
    const after = { ...info }
    ref.info = after
    this.history.push({
      label: 'Map info',
      undo: () => (ref.info = before ? { ...before } : undefined),
      redo: () => (ref.info = { ...after }),
    })
  }

  /** The open map's Map.dbc ID for the light editor: waits for the map table when a region needs it. */
  async lightsMapId(): Promise<number> {
    for (let i = 0; i < 100; i++) {
      const id = this.openMapId()
      if (id !== null) return id
      await new Promise((r) => setTimeout(r, 50))
    }
    return 0
  }

  /** Where the camera is in the tiles' placement frame (yards), which the client's lights are placed in. */
  cameraInFileFrame(): { x: number; y: number; z: number } {
    const cam = this.camera.position
    const region = this.doc.meta.region
    return { x: cam.x + (region ? region.x * TILE_YARDS : 0), y: cam.y, z: cam.z + (region ? region.y * TILE_YARDS : 0) }
  }

  /** Reads the map's lights again for the preview (after the light editor saved them). */
  reloadClientLights() {
    this.clientLightsMap = -1
    this.clientLights = null
  }

  /**
   * With Lighting › Client Lighting on, the light becomes the client's own at the camera (wow/clientLight.ts):
   * the map's global light with the local lights it is in blended over it gives the sun's and the sky's
   * light, the fog's colour and distances and the water's colours, and the client's DayNight tables
   * (wow/dayNight.ts) the sun's direction, which never sets. The sky dome is the client's too: its five
   * colour stops, warped toward the sun at dawn and dusk where the light says so. Off, or until the
   * lights are read, the editor's own lighting and sky stay.
   */
  private applyClientLight(time: number) {
    const tu = this.terrain.material.uniforms
    tu.clientLit.value = 0
    const id = this.prefs?.clientLighting && wow.loaded ? this.openMapId() : null
    if (id === null) {
      setLiquidLight(null)
      this.env.setClientSky(null, time)
      this.clouds.hide()
      return
    }
    if (id !== this.clientLightsMap) {
      this.clientLights = null
      if (!this.clientLightsLoading) {
        this.clientLightsLoading = true
        const want = id
        MapLights(want)
          .then((l) => {
            this.clientLights = l as ClientLights
            this.clientLightsMap = want
          })
          .catch((err) => {
            console.warn('client lights not read', err)
            this.clientLightsMap = want
          })
          .finally(() => (this.clientLightsLoading = false))
      }
    }
    const lights = this.clientLights
    const cam = this.camera.position
    const region = this.doc.meta.region
    const x = cam.x + (region ? region.x * TILE_YARDS : 0)
    const z = cam.z + (region ? region.y * TILE_YARDS : 0)
    if (!lights || !lightAt(lights, x, cam.y, z, this.hour, this.lightOut)) {
      setLiquidLight(null)
      this.env.setClientSky(null, time)
      this.clouds.hide()
      return
    }
    const c = this.lightOut.colors
    const s = this.env.state
    const minute = this.hour * 60
    const sun = lightingSunDir(minute, this.sunDirOut)
    s.keyDir.set(sun[0], sun[1], sun[2])
    const fog = this.scene.fog as THREE.Fog | null
    if (fog) {
      const [near, far] = sceneFog(this.lightOut, this.persp.far, this.fogOut)
      // A light with no fog end (two of the client's) fogs everything, as the client does.
      fog.far = Math.max(far, 0.001)
      fog.near = Math.min(near, fog.far - 0.001)
    }
    const sky = this.clientSky
    celestialSunDir(minute, this.celestialOut)
    moonDir(minute, this.moonOut)
    sky.warp = skyWarp(minute, this.lightOut.highlightSky)
    sky.sunScale = sunDiscScale(minute)
    sky.starAlpha = starAlpha(minute)
    this.env.setClientSky(sky, time)
    const dt = Math.min(0.1, Math.max(0, time - this.cloudsAt))
    this.cloudsAt = time
    this.clouds.update(dt, this.lightOut, minute, this.celestialOut, this.moonOut, this.camera.position, this.prefs?.clouds !== false && !this.topDown)
    s.keyColor.setRGB(c[BAND.diffuse * 3], c[BAND.diffuse * 3 + 1], c[BAND.diffuse * 3 + 2], THREE.SRGBColorSpace)
    s.skyAmbient.setRGB(c[BAND.ambient * 3], c[BAND.ambient * 3 + 1], c[BAND.ambient * 3 + 2], THREE.SRGBColorSpace)
    s.groundAmbient.copy(s.skyAmbient).multiplyScalar(0.5)
    s.horizon.setRGB(c[BAND.fog * 3], c[BAND.fog * 3 + 1], c[BAND.fog * 3 + 2], THREE.SRGBColorSpace)
    this.env.hemi.color.copy(s.skyAmbient)
    this.env.hemi.groundColor.copy(s.groundAmbient)
    this.env.key.color.copy(s.keyColor)
    setLiquidLight(this.lightOut)
    // The ground takes the rows as the client stores them (gamma), lit per vertex with the sheen.
    tu.clientLit.value = 1
    ;(tu.clientAmbient.value as THREE.Vector3).fromArray(c, BAND.ambient * 3)
    ;(tu.clientDiffuse.value as THREE.Vector3).fromArray(c, BAND.diffuse * 3)
    ;(tu.clientSpecular.value as THREE.Vector3).fromArray(c, BAND.sun * 3)
  }

  /**
   * Fits the shadow cascades to the view: the sharp near one around where the camera looks (the
   * ground point ahead, kept within its own reach of the camera), the far one around the distance.
   * The far map is redrawn only when its fit or the scene changes, as it covers everything in reach.
   */
  private fitShadows() {
    const env = this.env
    const eye = this.camera.position
    const fwd = this.camera.getWorldDirection(this.shadowFwd)
    this.shadowRay.set(eye, fwd)
    const focus = this.shadowFocus
    const dist = this.terrain.raycast(this.shadowRay, focus, 3000) ? focus.distanceTo(eye) : 300
    const nearExtent = THREE.MathUtils.clamp(dist, 30, 250)
    const farExtent = THREE.MathUtils.clamp(dist * 6, 800, 2500)
    const nearCenter = this.shadowNear.copy(eye).addScaledVector(fwd, Math.min(dist, nearExtent))
    const farCenter = this.shadowFar.copy(eye).addScaledVector(fwd, Math.min(dist, farExtent * 0.6))
    const moved = env.updateShadow(nearCenter, nearExtent, farCenter, farExtent)
    const objects = this.objects
    const scene = `${objects.version}/${this.terrain.heightsVersion}/${this.doc.spawnLayer.version}`
    if (moved || objects !== this.shadowObjects || scene !== this.shadowScene) {
      env.far.shadow.needsUpdate = true
      this.shadowObjects = objects
      this.shadowScene = scene
    }
  }
  private shadowFwd = new THREE.Vector3()
  private shadowRay = new THREE.Ray()
  private shadowFocus = new THREE.Vector3()
  private shadowNear = new THREE.Vector3()
  private shadowFar = new THREE.Vector3()
  private shadowObjects: ObjectLayer | null = null
  private shadowScene = ''

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
    this.controller.setFollowGround(p.cameraFollowGround)
    this.controller.collision = p.cameraCollision
    this.applyLayerVisibility(p)
  }

  /** Shows or hides the terrain, water and objects, and draws the terrain as a wireframe. */
  private applyLayerVisibility(p: Prefs) {
    const d = this.doc
    if (!d) return
    d.terrain.group.visible = p.showTerrain
    d.terrain.material.wireframe = p.wireframe
    d.water.mesh.visible = p.showWater && editor.waterEnabled
    d.liquidRenderer.group.visible = p.showWater
    d.objects.group.visible = p.showObjects
    d.objects.setKindsShown(p.showDoodads, p.showBuildings)
    d.groundEffects.group.visible = p.showGroundEffects
    d.spawnLayer.setKinds({ monster: p.showMonsters, npc: p.showNpcs, object: p.showGameObjects })
    d.spawnLayer.setEvents(p.shownEvents)
    this.spawnLabels.enabled = p.spawnNames
    this.spawnLabels.setSide(p.namesSide)
    // What a layer toggle hides can't stay selected, since it can't be clicked either (#135).
    if (!p.showObjects && editor.selectedIds.length) selectObjects(d.objects, [])
    else if (editor.selectedIds.some((id) => d.objects.isHidden(id))) selectObjects(d.objects, editor.selectedIds.filter((id) => !d.objects.isHidden(id)))
    const s = editor.selectedSpawn
    if (s && (!{ monster: p.showMonsters, npc: p.showNpcs, object: p.showGameObjects }[s.kind] || !d.spawnLayer.eventShown(s))) selectSpawn(null)
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
      waterLevel: editor.waterLevel,
      waterEnabled: editor.waterEnabled,
      paintLayer: editor.paintLayer,
      sculptPaintLayer: editor.sculptPaintLayer,
      roles: { ...editor.roles },
      textureEffects: { ...editor.textureEffects },
      textureLooks: { ...editor.textureLooks },
      scopedEffects: structuredClone(plainScoped(editor.scopedEffects)),
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
    // The chunk under the cursor on one map means nothing on another.
    editor.hoverChunk = -1
    ui.replaceSlot = null
    if (this.leftDown) {
      this.activeTool?.onUp?.(this.ctx, this.hit, new PointerEvent('pointerup'))
      this.leftDown = false
    }
    if (stash && this.doc && this.doc !== d) {
      this.stashActive()
      this.scene.remove(this.doc.terrain.group, this.doc.water.mesh, this.doc.water.floor, this.doc.objects.group, this.doc.groundEffects.group, this.doc.spawnLayer.group, this.doc.liquidRenderer.group)
    }
    this.doc = d
    this.scene.add(d.terrain.group, d.water.mesh, d.water.floor, d.objects.group, d.groundEffects.group, d.spawnLayer.group, d.liquidRenderer.group)
    const m = d.meta
    editor.mapName = m.mapName
    editor.filePath = m.filePath
    editor.palette = [...m.palette]
    editor.bookmarks = [...m.bookmarks]
    editor.waterLevel = m.waterLevel
    editor.waterEnabled = m.waterEnabled
    editor.paintLayer = m.paintLayer
    editor.sculptPaintLayer = m.sculptPaintLayer
    editor.roles = { ...m.roles }
    editor.textureEffects = { ...m.textureEffects }
    editor.textureLooks = { ...m.textureLooks }
    editor.scopedEffects = structuredClone(m.scopedEffects ?? noScopedEffects())
    editor.mapSize = d.terrain.size
    editor.region = m.region ? regionLabel(m.region) : ''
    editor.regionBlock = m.region ? { x: m.region.x, y: m.region.y, size: m.region.size } : null
    editor.regionMap = m.region?.mapName ?? ''
    editor.spawns = d.spawnLayer.spawns.slice()
    editor.spawnsError = d.spawnsError
    ui.spawnChanges = d.spawnLayer.edits().length
    ui.hiddenModels = d.objects.hidden.size
    selectSpawn(null)
    d.terrain.setTileBorders(m.region ? TILE_CELLS : 0)
    editor.selected = null
    editor.selectedIds = []
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
    const preset = presetById(kind)
    d.meta.waterLevel = preset.waterLevel
    d.meta.waterEnabled = preset.water
    d.terrain.autoPaint(d.meta.waterLevel, d.meta.waterEnabled)
    d.meta.roles = guessRoles(d.meta.palette)
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
    if (r.holes.length === d.terrain.holes.length) d.terrain.holes.set(r.holes)
    if (r.noEffect.length === d.terrain.noEffect.length) d.terrain.noEffect.set(r.noEffect)
    if (r.areaIds.length === d.terrain.areaIds.length) d.terrain.areaIds.set(r.areaIds)
    if (r.chunkFlags.length === d.terrain.chunkFlags.length) d.terrain.chunkFlags.set(r.chunkFlags)
    d.terrain.markAllDirty()
    d.meta.palette = [...r.palette]
    d.meta.roles = guessRoles(r.palette)
    liquidsFromAdt(d.liquids, r.liquids)
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
    // The client's water is in the liquid layers, so a block has no sea of its own.
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
    d.spawnsError = ''
    if (d === this.doc) {
      editor.spawns = spawns.slice()
      editor.spawnsError = ''
      ui.spawnChanges = 0
    }
    if (this.prefs) this.applyLayerVisibility(this.prefs)
  }

  /** Records why a region's spawns could not be read, so the Spawns panel can say so and offer a retry. */
  setSpawnsError(d: MapDocument, message: string) {
    d.spawnsError = message
    if (d === this.doc) editor.spawnsError = message
  }

  /** Moves the camera to a spawn, in the active region's coordinates. */
  /**
   * A plain right-click: selects the creature, region object or placed model under the cursor and
   * opens a menu of what can be done with it. On bare ground there is no menu.
   */
  private openContextMenu(e: PointerEvent) {
    ui.contextMenu = null
    this.updatePointer(e)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const items: ContextItem[] = []
    let title = ''
    const { spawn, id } = pickNearest(this.objects, this.doc.spawnLayer, this.raycaster)
    if (spawn) {
      if (editor.tool !== 'select') editor.tool = 'select'
      selectSpawn(spawn)
      const key = spawnKey(spawn)
      title = `${spawn.name} (${spawn.kind === 'object' ? 'object' : 'creature'} ${spawn.entry}${spawn.model ? '' : ', invisible in the game'})`
      if (spawn.kind !== 'object') {
        items.push({ label: 'Edit creature…', run: () => (ui.creatureEditor = { key, entry: spawn.entry }) })
        items.push({ label: spawn.waypoints?.length ? 'Edit path' : 'Give it a path', run: () => this.editPath(key) })
      }
      items.push({ label: 'Focus', shortcut: 'F', run: () => this.focusSpawn(spawn) })
      items.push({ separator: true }, { label: 'Delete spawn', shortcut: 'Del', danger: true, run: () => this.deleteSelectedSpawn() })
    } else {
      const o = id !== null ? this.objects.objects.get(id) : undefined
      if (!o) return
      if (editor.tool !== 'select' && editor.tool !== 'place') editor.tool = 'select'
      if (!editor.selectedIds.includes(o.id)) selectObjects(this.objects, [o.id])
      const n = editor.selectedIds.length
      title = n > 1 ? `${n} models` : displayName(o.type)
      items.push({ label: 'Focus', shortcut: 'F', run: () => this.focusSelected() })
      items.push({ label: 'Duplicate', shortcut: 'Ctrl+Shift+D', run: () => this.duplicateSelected() })
      items.push({ label: 'Place more of this', run: () => pickModel(o) })
      items.push({ separator: true }, { label: n > 1 ? 'Delete models' : 'Delete model', shortcut: 'Del', danger: true, run: () => this.deleteSelected() })
    }
    ui.contextMenu = { x: e.clientX, y: e.clientY, title, items }
  }

  focusSpawn(s: vmangos.WorldSpawn) {
    this.controller.focus(s.x, s.z, 40)
  }

  /**
   * Starts editing creature `key`'s path on the map (#138): selects it in the Select tool, closes the
   * creature editor that would cover the map, and picks the last point, so a click on the ground
   * adds a point at the end. `PathEditBar` shows what can be done until Done or Esc.
   */
  editPath(key: string) {
    const s = this.doc.spawnLayer.get(key)
    if (!s || s.kind === 'object') return
    if (editor.tool !== 'select') editor.tool = 'select'
    selectSpawn(s)
    ui.creatureEditor = null
    editor.selectedWaypoint = (s.waypoints?.length ?? 0) - 1
    ui.pathEdit = true
  }

  /** Deletes the picked point of the selected creature's path, as one undo step. */
  deletePathPoint() {
    const sel = editor.selectedSpawn
    const i = editor.selectedWaypoint
    if (!sel || i < 0) return
    const s = this.doc.spawnLayer.get(spawnKey(sel))
    if (!s?.waypoints?.[i]) return
    const cmd = spawnChange(this.doc.spawnLayer, spawnKey(sel), { waypoints: withPoint(s.waypoints, i, null) }, `Delete path point (${sel.name})`)
    if (cmd) this.history.push(cmd)
    editor.selectedWaypoint = Math.min(i, s.waypoints.length - 1)
  }

  /** Moves the camera to a point of the active region, such as a waypoint. */
  focusPoint(x: number, z: number) {
    this.controller.focus(x, z, 30)
  }

  /**
   * Changes fields of the active region's spawn `key` as one undoable step. A creature whose
   * display, equipment or pose changes is dressed again by the Go side first.
   */
  async editSpawn(key: string, vals: SpawnFields, label: string) {
    const d = this.doc
    const s = d.spawnLayer.get(key)
    if (!s) return
    let full: SpawnFields
    try {
      full = await withLook(s, vals)
    } catch (err) {
      setStatus(`Could not dress the spawn: ${err}`, 8000)
      return
    }
    const cmd = spawnChange(d.spawnLayer, key, full, label)
    if (cmd) d.history.push(cmd)
  }

  /** The guid the next placed creature gets; 0 until the world database has been asked. */
  private nextCreatureGuid = 0
  /** A read of the database's next creature guid is under way (for the spawn brush, which can't wait). */
  private guidReading = false

  /** The spawn brush's look for a template: its result, or null while it is read (asked for then). */
  private brushLook(e: SpawnBrushEntry): vmangos.LookResult | null {
    const key = `${e.display}|${e.equipment}`
    if (this.brushLooks.has(key)) return this.brushLooks.get(key) ?? null
    this.brushLooks.set(key, null)
    SpawnLook(e.display, e.equipment, 0, 0, 1)
      .then((look) => this.brushLooks.set(key, look))
      .catch((err) => {
        this.brushLooks.delete(key)
        setStatus(`Could not dress ${e.name}: ${err}`, 6000)
      })
    return null
  }

  /**
   * A new creature of a spawn brush template (#171), with the next free guid, as placeCreature gives
   * one; null while its look or the database's next guid is still read.
   */
  private brushCreature(e: SpawnBrushEntry, x: number, y: number, z: number, orientation: number): vmangos.WorldSpawn | null {
    const look = this.brushLook(e)
    if (!this.nextCreatureGuid) {
      if (!this.guidReading) {
        this.guidReading = true
        NextCreatureGUID()
          .then((g) => (this.nextCreatureGuid = Math.max(this.nextCreatureGuid, g)))
          .catch((err) => setStatus(`Could not read the next creature guid: ${err}`, 6000))
          .finally(() => (this.guidReading = false))
      }
      return null
    }
    if (!look) return null
    let guid = this.nextCreatureGuid
    for (const doc of this.documents) for (const s of doc.spawnLayer.spawns) if (s.kind !== 'object') guid = Math.max(guid, s.guid + 1)
    this.nextCreatureGuid = guid + 1
    return newCreatureSpawn({ ...e, model: '', look: '', displayScale: 1 }, guid, x, y, z, orientation, look)
  }

  /**
   * Spawns creature template `t` at `at` in the active region, facing the camera, as one undoable
   * step, and selects it. Its guid is above every creature guid of the world database and of every
   * open region, so creatures placed in different tabs never share one.
   */
  /** Spawns whichever template the browser's spawn tabs picked (ui.placeCreature or ui.placeObject) at a point. */
  placeSpawnAt(at: THREE.Vector3) {
    if (ui.placeCreature) void this.placeCreature(ui.placeCreature, at)
    else if (ui.placeObject) void this.placeObject(ui.placeObject, at)
  }

  private nextObjectGuid = 0

  /** Spawns a game object template at a point, facing the camera, as one undo step. */
  async placeObject(t: vmangos.ObjectTemplate, at: THREE.Vector3) {
    const d = this.doc
    try {
      const dbNext = this.nextObjectGuid ? 0 : await NextObjectGUID()
      let guid = Math.max(this.nextObjectGuid, dbNext)
      for (const doc of this.documents) for (const s of doc.spawnLayer.spawns) if (s.kind === 'object') guid = Math.max(guid, s.guid + 1)
      this.nextObjectGuid = guid + 1
      const cam = this.camera.position
      const o = spawnOrientation(Math.atan2(-(cam.z - at.z), cam.x - at.x))
      const s = newObjectSpawn(t, guid, at.x, at.y, at.z, o)
      d.history.push(spawnAdd(d.spawnLayer, s, `Add ${t.name}`))
      if (d === this.doc) selectSpawn(s)
    } catch (err) {
      setStatus(`Could not place ${t.name}: ${err}`, 8000)
    }
  }

  async placeCreature(t: vmangos.CreatureTemplate, at: THREE.Vector3) {
    const d = this.doc
    try {
      const [dbNext, look] = await Promise.all([this.nextCreatureGuid ? Promise.resolve(0) : NextCreatureGUID(), SpawnLook(t.display, t.equipment, 0, 0, 1)])
      let guid = Math.max(this.nextCreatureGuid, dbNext)
      for (const doc of this.documents) for (const s of doc.spawnLayer.spawns) if (s.kind !== 'object') guid = Math.max(guid, s.guid + 1)
      this.nextCreatureGuid = guid + 1
      // Face the camera: the model's front (+X at rest) turned towards where the camera is.
      const cam = this.camera.position
      const o = spawnOrientation(Math.atan2(-(cam.z - at.z), cam.x - at.x))
      const s = newCreatureSpawn(t, guid, at.x, at.y, at.z, o, look)
      d.history.push(spawnAdd(d.spawnLayer, s, `Add ${t.name}`))
      if (d === this.doc) selectSpawn(s)
    } catch (err) {
      setStatus(`Could not place ${t.name}: ${err}`, 8000)
    }
  }

  /**
   * Brings the spawns of creature template `entry` in every open region up to date after the
   * template was saved (`was` its values before): name, level, faction and the like, and for a spawn
   * showing the template's display or equipment rather than its own, the new ones. The database
   * already has this, so it is not a spawn edit to save, nor an undo step.
   */
  async applyCreatureTemplate(entry: number, now: Record<string, string>, was: Record<string, string>) {
    const t = creatureTemplateOf(entry, now)
    const old = creatureTemplateOf(entry, was)
    const info: Partial<vmangos.WorldSpawn> = {
      name: t.name,
      subname: t.subname,
      levelMin: t.levelMin,
      levelMax: t.levelMax,
      faction: t.faction,
      npcFlags: t.npcFlags,
      rank: t.rank,
      type: t.type,
    }
    const looks = new Map<string, Promise<vmangos.LookResult>>()
    for (const d of this.documents) {
      const layer = d.spawnLayer
      let touched = false
      for (const s of layer.spawns.slice()) {
        if (s.kind === 'object' || s.entry !== entry) continue
        const vals: Partial<vmangos.WorldSpawn> = { ...info }
        const ownDisplay = s.display !== old.display
        const display = ownDisplay ? s.display : t.display
        const equipment = s.equipment === old.equipment ? t.equipment : s.equipment
        if (display !== s.display || equipment !== s.equipment || (!ownDisplay && t.scale !== old.scale)) {
          const key = [display, equipment, s.standState, s.emoteState, s.sheathState].join('|')
          let p = looks.get(key)
          if (!p) {
            p = SpawnLook(display, equipment, s.standState, s.emoteState, s.sheathState)
            looks.set(key, p)
          }
          try {
            const l = await p
            const templateScale = ownDisplay ? (s.displayScale > 0 ? s.scale / s.displayScale : 1) : t.scale
            Object.assign(vals, { display, equipment, model: l.model, look: l.look, anim: l.anim, displayScale: l.displayScale, scale: templateScale * (l.displayScale || 1) })
          } catch (err) {
            console.warn('spawn not re-dressed', err)
          }
        }
        layer.rebase(s, vals)
        touched = true
      }
      if (touched && d === this.doc) syncSpawnUi(layer, true)
    }
  }

  /** Deletes the selected spawn of the active region, undoably. */
  deleteSelectedSpawn() {
    const sel = editor.selectedSpawn
    if (!sel) return
    const cmd = spawnDelete(this.doc.spawnLayer, spawnKey(sel), `Delete ${sel.name}`)
    if (cmd) this.history.push(cmd)
  }

  /** The active region's spawn edits for the world database. */
  spawnEdits(): vmangos.SpawnEdit[] {
    return this.doc.spawnLayer.edits()
  }

  /** The world database now has the active region's spawn edits. */
  markSpawnsSaved() {
    this.doc.spawnLayer.markSaved()
    syncSpawnUi(this.doc.spawnLayer)
  }

  /**
   * Keys for a spawn selected alone: turn it (R), delete it, deselect it. While its path is being
   * edited, Delete removes the picked point and Esc stops editing.
   */
  private handleSpawnKey(e: KeyboardEvent): boolean {
    if ((ui.placeCreature || ui.placeObject) && e.key === 'Escape') {
      ui.placeCreature = ui.placeObject = null
      setStatus('Stopped placing creatures.')
      return true
    }
    const sel = editor.selectedSpawn
    if (!sel || editor.selectedIds.length > 0 || editor.tool !== 'select') return false
    if (ui.pathEdit) {
      if (e.key === 'Escape') {
        ui.pathEdit = false
        return true
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selectedWaypoint >= 0) {
        this.deletePathPoint()
        return true
      }
    }
    switch (e.key) {
      case 'r':
      case 'R': {
        const spin = THREE.MathUtils.degToRad(e.altKey ? 5 : 15) * (e.shiftKey ? -1 : 1)
        const o = spawnOrientation(spawnRotation(sel.orientation) + spin)
        void this.editSpawn(spawnKey(sel), { orientation: o }, `Turn ${sel.name}`)
        return true
      }
      case 'Delete':
      case 'Backspace':
        this.deleteSelectedSpawn()
        return true
      case 'Escape':
        selectSpawn(null)
        return true
    }
    return false
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

  /**
   * The GM command that teleports to the point under the cursor (`.go xyz`, io/portCoords.ts), in the
   * client's coordinates and map, or why there is none: nothing under the cursor, or a map that isn't
   * in the client. A region's map ID waits for the client's map list the first time.
   */
  async teleportAtCursor(): Promise<{ command: string } | { error: string }> {
    if (!this.hit) return { error: 'Point at the ground or a model to copy its position.' }
    const at = this.hit.clone()
    const m = this.doc.meta
    if (!m.vmangos && !m.region) return { error: 'This map isn’t in the client yet, so it has no map ID: make it with File › New World… or open a part of Azeroth.' }
    if (!m.vmangos) await this.loadMapIds()
    const id = this.openMapId() ?? 0
    return { command: teleportCommand(at, id, m.region?.x ?? 0, m.region?.y ?? 0) }
  }

  /**
   * Where a character launched into the game should stand: on the ground or the model surface below
   * the camera (the orbit target in ground-following mode, the camera itself when flying), facing the
   * way the camera looks, in the server's coordinates and map. Null for a map that isn't in the client.
   */
  async playerSpot(): Promise<ServerSpot | null> {
    const m = this.doc.meta
    if (!m.vmangos && !m.region) return null
    if (!m.vmangos) await this.loadMapIds()
    const id = this.openMapId()
    if (id === null) return null
    const c = this.controller
    // From a little above an orbit target, so a floor just over the terrain is found, not a roof.
    const from = c.followGround ? c.target.clone().setY(c.target.y + PLAYER_PROBE) : this.camera.position.clone()
    const at = this.groundBelow(from) ?? from.clone().setY(this.terrain.heightAt(from.x, from.z))
    at.y += PLAYER_LIFT
    return serverSpot(at, id, m.region?.x ?? 0, m.region?.y ?? 0, c.yaw)
  }

  /** The nearest terrain or model surface straight below `from`, or null when there is none. */
  private groundBelow(from: THREE.Vector3): THREE.Vector3 | null {
    this.raycaster.set(from, DOWN)
    const ground = new THREE.Vector3()
    const onGround = this.terrain.raycast(this.raycaster.ray, ground)
    const obj = this.objects.raycastSurface(this.raycaster)
    if (obj && (!onGround || obj.distance < ground.distanceTo(from))) return obj.point
    return onGround ? ground : null
  }

  /** The active map as the client export takes it. */
  exportInput(): ExportInput {
    const t = this.terrain
    // Helper shapes are the editor's own visual aids and never go to the client.
    const objects = this.objects.list().filter((o) => !isHelper(o.type)).map((o) => {
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
      effects: editor.palette.map((p) => effectFor(p, editor.textureEffects, groundEffectTables())),
      looks: looksByIndex(editor.palette, editor.textureLooks),
      effectAt: hasScopedEffects(editor.scopedEffects) ? this.exportEffectAt() : undefined,
      noEffect: blockedCells(t, this.objects, new Uint8Array(t.size * t.size)),
      // A map saved before the file kept chunk data has none of its own, so the client's stays.
      headers: this.doc.chunkDataKnown ? { areaIds: t.areaIds, chunkFlags: t.chunkFlags } : undefined,
      holes: t.holes,
      // Sent with the headers only: a map that has none of its own keeps the client's.
      shadows: t.shadow ?? undefined,
      objects,
      waterEnabled: editor.waterEnabled,
      waterLevel: editor.waterLevel,
      liquids: this.doc.liquids,
    }
  }

  /**
   * The active region's liquids for its save, placed by block chunk: every layer, and whether only
   * the chunks that have some count (`partial`, for a region saved before maps kept liquids), which
   * leaves the client's other liquids alone.
   */
  regionLiquids(): { liquids: AdtLiquid[]; partial: boolean } {
    return { liquids: liquidsToAdt(this.doc.liquids), partial: !this.doc.liquidsKnown }
  }

  /** Sets the water brush's lock to a point and turns the lock on (Alt+click in the water brush). */
  lockWater(p: THREE.Vector3) {
    editor.water.lockPos = { x: p.x, y: Math.round(p.y * 100) / 100, z: p.z }
    editor.water.lock = true
    setStatus(`Water locked at height ${editor.water.lockPos.y.toFixed(2)}.`)
  }

  /** For a free-form area, which chunks (8x8 cells, by index) hold a cell of it; undefined for a rect or none. */
  private shapeChunks(): ((c: number) => boolean) | undefined {
    const t = this.terrain
    const shape = areaShape(t, t.size)
    if (!shape) return undefined
    const side = t.paintChunksPerSide
    return (c) => chunkInShape(shape, t.size, c % side, Math.floor(c / side))
  }

  /** The selected area's cells, or undefined for the whole map. */
  private selectionCells() {
    const s = editor.selection
    return s ? { x0: s.x0, z0: s.z0, x1: s.x1 - 1, z1: s.z1 - 1 } : undefined
  }

  /** noggit's Crop water: removes liquid cells that lie under the ground, in the selected area or the whole map. */
  cropWater() {
    const stroke = new LiquidStroke(this.doc.liquids, 'Crop water')
    const n = cropLiquids(this.doc.liquids, this.terrain, this.selectionCells(), stroke.reserve, this.shapeChunks()).length
    const cmd = stroke.finish()
    if (cmd) this.history.push(cmd)
    setStatus(n ? `Cropped the water in ${n} chunks.` : 'No water lies under the ground there.')
  }

  /**
   * Lays watermap cells (see io/watermapImport.ts) into the map's liquids as water, then works the
   * depth colours out again over the cells it touched, as one undo step. Returns the cells laid.
   */
  importWatermap(cells: LiquidClipCell[]): number {
    if (!cells.length) return 0
    const stroke = new LiquidStroke(this.doc.liquids, 'Import watermap')
    layLiquidCells(this.doc.liquids, cells, stroke.reserve)
    const rect = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
    for (const c of cells) {
      rect.x0 = Math.min(rect.x0, c.x)
      rect.z0 = Math.min(rect.z0, c.z)
      rect.x1 = Math.max(rect.x1, c.x)
      rect.z1 = Math.max(rect.z1, c.z)
    }
    regenOpacity(this.doc.liquids, this.terrain, null, rect, stroke.reserve)
    const cmd = stroke.finish()
    if (cmd) this.history.push(cmd)
    return cells.length
  }

  /** noggit's Regen ADT opacity: every liquid vertex's depth again from the ground, at the brush's opacity setting. */
  regenWaterOpacity() {
    const stroke = new LiquidStroke(this.doc.liquids, 'Regenerate water opacity')
    const factor = editor.water.opacity === 'auto' ? null : waterOpacityFactor(editor.water.liquid)
    const n = regenOpacity(this.doc.liquids, this.terrain, factor, this.selectionCells(), stroke.reserve, this.shapeChunks()).length
    const cmd = stroke.finish()
    if (cmd) this.history.push(cmd)
    setStatus(n ? `Regenerated the opacity of the water in ${n} chunks.` : 'There is no water to regenerate.')
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
      if (isHelper(o.type)) continue
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
    const whole = { x0: 0, z0: 0, x1: t.size, z1: t.size }
    stroke.reserveHeights(whole)
    t.heights.set(next)
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

  /** The viewport's size in CSS pixels. */
  viewportSize(): [number, number] {
    return [this.container.clientWidth, this.container.clientHeight]
  }

  /** The camera's view and the hour of day, for a copied scene (io/scene.ts). */
  sceneView() {
    const c = this.controller
    return { target: [c.target.x, c.target.y, c.target.z] as [number, number, number], yaw: c.yaw, pitch: c.pitch, distance: c.distance, hour: this.hour }
  }

  /** Restores a copied scene's view and hour. Call it after the scene's prefs are applied. */
  setSceneView(v: ReturnType<Engine['sceneView']>) {
    this.controller.setView(v.target[0], v.target[1], v.target[2], v.yaw, v.pitch, v.distance)
    this.hour = v.hour
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
      this.scene.remove(d.terrain.group, d.water.mesh, d.water.floor, d.objects.group, d.groundEffects.group, d.spawnLayer.group, d.liquidRenderer.group)
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

  /** The active map's document, for work that outlives a tab switch (loading its spawns). */
  activeDocument() {
    return this.doc
  }

  snapshot(): MapSnapshot {
    return this.snapshotOf(this.doc)
  }

  /** The map of any open tab, as `snapshot` gives the active one's (autosave copies every dirty tab). */
  snapshotOf(d: MapDocument): MapSnapshot {
    const t = d.terrain
    // The active tab's settings live in `editor`, the others' in their stashed meta.
    const m = d === this.doc ? editor : d.meta
    const region = d.meta.region
    return {
      name: m.mapName,
      size: t.size,
      cellSize: t.cellSize,
      splatRes: t.splatRes,
      waterLevel: m.waterLevel,
      waterEnabled: m.waterEnabled,
      objects: d.objects.list().map((o) => {
        const uid = region?.uids.get(o.id)
        return uid ? { ...o, uid } : { ...o }
      }),
      region: region ? { mapName: region.mapName, x: region.x, y: region.y, size: region.size } : null,
      vmangos: d.meta.vmangos,
      palette: [...m.palette],
      roles: { ...m.roles },
      textureEffects: { ...m.textureEffects },
      textureLooks: { ...m.textureLooks },
      scopedEffects: structuredClone(plainScoped(m.scopedEffects ?? noScopedEffects())),
      heights: new Uint8Array(t.heights.buffer, t.heights.byteOffset, t.heights.byteLength),
      weights: t.weights,
      chunkSlots: t.chunkSlots,
      holes: t.holes,
      liquids: encodeLiquids(d.liquids),
      chunkData: { areaIds: t.areaIds, chunkFlags: t.chunkFlags, noEffect: t.noEffect },
      shadows: t.shadow ? packShadowBits(t.shadow) : null,
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
    if (m.holes.length === t.holes.length) t.holes.set(m.holes)
    else if (m.holes.length) throw new Error('hole data size mismatch')
    if (m.liquids) decodeLiquids(d.liquids, m.liquids)
    d.liquidsKnown = m.liquids !== null
    if (m.chunkData) {
      const c = m.chunkData
      if (c.areaIds.length !== t.areaIds.length || c.chunkFlags.length !== t.chunkFlags.length || c.noEffect.length !== t.noEffect.length) {
        d.dispose()
        throw new Error('chunk data size mismatch')
      }
      t.areaIds.set(c.areaIds)
      t.chunkFlags.set(c.chunkFlags)
      t.noEffect.set(c.noEffect)
    }
    d.chunkDataKnown = m.chunkData !== null
    if (m.shadows) {
      if (m.shadows.length !== (t.shadowSide * t.shadowSide) / 8) {
        d.dispose()
        throw new Error('shadow data size mismatch')
      }
      t.setBakedShadows(m.shadows, t.shadowSide)
      // The map's own: the client's are not read over them.
      t.bakedRequested = true
    }
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
      waterLevel: m.waterLevel,
      waterEnabled: m.waterEnabled,
      paintLayer: 0,
      sculptPaintLayer: 0,
      roles: m.roles ? validRoles(m.roles, palette.length) : guessRoles(palette),
      textureEffects: { ...m.textureEffects },
      textureLooks: { ...(m.textureLooks ?? {}) },
      scopedEffects: structuredClone(m.scopedEffects ?? noScopedEffects()),
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

  /** The last mask scan, by map and mask version, so a stroke that left the mask alone skips the scan. */
  private maskScan: { terrain: Terrain; version: number; active: boolean } | null = null

  /** Publish whether the active map's mask has anything in it. */
  refreshMaskState() {
    const t = this.terrain
    const s = this.maskScan
    if (s && s.terrain === t && s.version === t.maskVersion) {
      ui.maskActive = s.active
      return
    }
    const m = t.mask
    // Four texels a step: the mask is a whole number of words (its side is a multiple of 32).
    const words = new Uint32Array(m.buffer, m.byteOffset, m.byteLength >> 2)
    let any = false
    for (let i = 0; i < words.length && !any; i++) if (words[i]) any = true
    for (let i = words.length << 2; i < m.length && !any; i++) if (m[i]) any = true
    this.maskScan = { terrain: t, version: t.maskVersion, active: any }
    ui.maskActive = any
  }

  /** Run `fn` on the mask and record it as one undo step. */
  private editMask(label: string, fn: (m: Uint8Array) => void) {
    editWholeMask(this.terrain, this.history, label, fn)
    this.refreshMaskState()
  }

  /** Mask › Grow, Shrink or Feather Mask by the options bar's step (#183). */
  modifyMask(how: 'grow' | 'shrink' | 'feather') {
    if (!ui.maskActive) {
      setStatus('The mask is empty. Paint a mask first (Paint tool › Mask).')
      return
    }
    modifyMask(this.terrain, this.history, how)
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

  /** Turn the selected area into a mask (added to the existing mask). */
  maskFromSelection() {
    const s = editor.selection
    if (!s) return
    const R = this.terrain.splatRes
    const size = this.terrain.size
    const tpc = R / size
    const shape = areaShape(this.terrain, size)
    this.editMask('Mask selection', (m) => {
      for (let z = s.z0 * tpc; z < s.z1 * tpc; z++) {
        for (let x = s.x0 * tpc; x < s.x1 * tpc; x++) if (!shape || shape[Math.floor(z / tpc) * size + Math.floor(x / tpc)]) m[z * R + x] = 255
      }
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
    stroke.reserveSplat({ x0, z0, x1, z1 })
    let refused = 0
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const p = z * R + x
        if (m[p] && !paintPixel(t, p, layer, m[p] / 255)) refused++
      }
    }
    stroke.touchSplat({ x0, z0, x1, z1 })
    t.markSplatDirty({ x0, z0, x1, z1 })
    const cmd = stroke.finish()
    if (cmd) this.history.push(cmd)
    const tex = editor.palette[layer] ?? ''
    const name = isColor(tex) ? tex : tex.slice(tex.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
    setStatus(refused ? `Filled the mask with ${name}, except where a chunk already has four textures.` : `Filled the mask with ${name}.`)
  }

  /**
   * Terrain › Fill Selection / Fill Mask with Doodad Brush (#169): scatters the active doodad brush over
   * the selected area, or over the paint mask (thinned by its value), as one undo step.
   */
  fillWithDoodadBrush(useMask: boolean) {
    const brush = activeDoodadBrush()
    if (!brush || !brush.entries.length) {
      setStatus('Make a doodad brush with models first (Doodad tool › Edit brush).', 6000)
      return
    }
    const t = this.terrain
    let area = editor.selection
    let mask: Uint8Array | null = null
    if (useMask) {
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
      const tpc = R / t.size
      area = { x0: Math.floor(x0 / tpc), z0: Math.floor(z0 / tpc), x1: Math.ceil((x1 + 1) / tpc), z1: Math.ceil((z1 + 1) / tpc) }
      mask = m
    }
    if (!area) {
      setStatus('Select an area first (Select tool, drag on the ground).')
      return
    }
    const shape = useMask ? null : areaShape(t, t.size)
    if (shape) {
      // A free-form area fills its own cells: a mask of them, full inside.
      const R = t.splatRes
      const tpc = R / t.size
      mask = new Uint8Array(R * R)
      for (let z = area.z0 * tpc; z < area.z1 * tpc; z++) {
        for (let x = area.x0 * tpc; x < area.x1 * tpc; x++) if (shape[Math.floor(z / tpc) * t.size + Math.floor(x / tpc)]) mask[z * R + x] = 255
      }
    }
    const n = this.doodadTool.fill(this.ctx, brush, area, mask)
    setStatus(n ? `Placed ${n} models of "${brush.name}".` : `"${brush.name}" found no room there: its rules or spacing ruled out every spot.`, 6000)
  }

  // ---------------------------------------------------------------- selected area / clipboard

  private updateSelectionUniforms(time: number) {
    const u = this.terrain.material.uniforms
    const cs = this.terrain.cellSize
    u.selTime.value = time
    const at = this.selectTool.pasteAt
    if (ui.pasting && this.lastCopied === 'area' && this.clip && at) {
      u.selRect.value.set(at.x * cs, at.z * cs, (at.x + this.clip.w) * cs, (at.z + this.clip.h) * cs)
      u.selMode.value = 2
    } else if (editor.selection) {
      const s = editor.selection
      u.selRect.value.set(s.x0 * cs, s.z0 * cs, s.x1 * cs, s.z1 * cs)
      const cells = areaShape(this.terrain, this.terrain.size)
      if (cells) {
        u.selTex.value = this.areaTexture(cells, this.terrain.size)
        u.selMode.value = 3
      } else u.selMode.value = 1
    } else {
      u.selMode.value = 0
    }
  }

  private areaTex: THREE.DataTexture | null = null

  /** The free-form area's cells as the terrain shader's texture, swapped only when the shape changes. */
  private areaTexture(cells: Uint8Array, size: number): THREE.DataTexture {
    let tex = this.areaTex
    if (tex && tex.image.width !== size) {
      tex.dispose()
      tex = null
    }
    if (!tex) {
      tex = new THREE.DataTexture(cells, size, size, THREE.RedFormat, THREE.UnsignedByteType)
      tex.magFilter = tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      tex.needsUpdate = true
      this.areaTex = tex
    } else if (tex.image.data !== cells) {
      tex.image.data = cells
      tex.needsUpdate = true
    }
    return tex
  }

  /**
   * Edit › Grow / Shrink Selection (#183): widens or narrows the selected area by `cells` cells, which
   * makes a rect a shape with rounded corners. The models in it are selected again.
   */
  resizeSelection(cells: number) {
    const t = this.terrain
    const size = t.size
    const cur = areaCells(t, size)
    if (!cur) {
      setStatus('Select an area first: drag on the ground with the Select tool (V).')
      return
    }
    const next = cur.slice()
    if (cells > 0) growMask(next, size, cells)
    else shrinkMask(next, size, -cells)
    const r = setAreaCells(t, size, next)
    selectObjects(this.objects, r ? withGroups(this.objects, objectsInArea(this.objects, t, size, t.cellSize).map((o) => o.id)) : [])
    setStatus(r ? `${cells > 0 ? 'Grew' : 'Shrank'} the area to ${r.x1 - r.x0} × ${r.z1 - r.z0} cells.` : 'The area shrank to nothing.')
  }

  /** Selects the whole map and every object in it. */
  selectAll() {
    const n = this.terrain.size
    editor.selection = { x0: 0, z0: 0, x1: n, z1: n }
    selectObjects(this.objects, objectsInRect(this.objects, this.terrain.cellSize, editor.selection).map((o) => o.id))
  }

  /**
   * Selects every placed model of `type`: among the selected models when `within` is set (narrowing
   * a mixed selection to one kind), else in the whole map. Hidden models are left out.
   */
  selectModelsOfType(type: string, within = false) {
    const pool = within ? selectedObjects(this.objects) : [...this.objects.objects.values()]
    const ids = pool.filter((o) => o.type === type && this.objects.pickable(o.id)).map((o) => o.id)
    selectObjects(this.objects, ids)
    const name = displayName(type)
    setStatus(ids.length === 1 ? `Selected the one ${name}.` : `Selected ${ids.length} × ${name}.`)
  }

  deselect() {
    editor.selection = null
    selectObjects(this.objects, [])
    if (ui.pasting) this.cancelPaste()
  }

  /**
   * Cuts the selected area out of the ground (`hole` true) or fills it in again. A hole draws no ground
   * and the cursor sees through it, so a cave or a cellar can be placed below. One undo step.
   */
  setHoleInSelection(hole: boolean) {
    const s = editor.selection
    if (!s || s.x1 <= s.x0 || s.z1 <= s.z0) {
      setStatus('Select an area first: drag on the ground with the Select tool (V).')
      return
    }
    const t = this.terrain
    const stroke = new TerrainStroke(t, hole ? 'Cut hole' : 'Fill hole', { holes: true })
    // Whole 2x2-cell blocks, as the client keeps holes: the area grows out to the blocks it touches.
    const r = snapToBlocks({ x0: s.x0, z0: s.z0, x1: s.x1 - 1, z1: s.z1 - 1 }, t.size)
    stroke.reserveHoles(r)
    const shape = areaShape(t, t.size)
    const n = shape ? fillShapeHoles(t.holes, t.size, shape, r, hole ? 1 : 0) : fillHoles(t.holes, t.size, r.x0, r.z0, r.x1 + 1, r.z1 + 1, hole ? 1 : 0)
    if (!n) {
      setStatus(hole ? 'That area is already a hole.' : 'There is no hole in that area.')
      return
    }
    stroke.touchHoles(r)
    t.markDirty(r.x0, r.z0, r.x1 + 1, r.z1 + 1)
    const cmd = stroke.finish()
    if (cmd) this.history.push(cmd)
    this.refreshSelectionArea()
    setStatus(hole ? `Cut a hole of ${n} ${n === 1 ? 'cell' : 'cells'}. Fill hole puts the ground back; Ctrl+Z undoes.` : `Filled ${n} ${n === 1 ? 'cell' : 'cells'} of hole.`)
  }

  /**
   * Models › Fit Ground to Selection (#168): moves the ground under each selected model to just under
   * its lowest floor, blending back over a ring, and with Cut holes opens the ground where it stands
   * above an interior floor. With `stamp`, presses the models' undersides into the ground instead (a
   * rock's base, a crater), the Unity Mesh Stamp. The models keep their place in the world: a model on
   * the ground gets its `yOff` back for the ground that moved under it. One undo step.
   */
  fitGroundToSelection(stamp: boolean, fit: FitOptions) {
    const ids = editor.selectedIds.filter((id) => this.objects.objects.has(id))
    if (!ids.length) {
      setStatus('Select one or more models first (Select tool).')
      return
    }
    const t = this.terrain
    const cs = t.cellSize
    const V = t.verts
    const opts: FitOptions = stamp ? { ...fit, margin: 0, mode: 'both', holes: false } : fit
    const resnap = (r: Rect) => this.objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
    const stroke = new TerrainStroke(t, stamp ? 'Stamp model into ground' : 'Fit ground to model', { heights: true, holes: true }, resnap)
    const box = new THREE.Box3()
    const moved: Array<{ before: WorldObject; after: WorldObject }> = []
    let fitted = 0
    let loading = 0
    for (const id of ids) {
      if (!this.objects.surfaceBox(id, box)) {
        loading++
        continue
      }
      const x0 = Math.max(0, Math.floor((box.min.x - opts.falloff) / cs))
      const z0 = Math.max(0, Math.floor((box.min.z - opts.falloff) / cs))
      const x1 = Math.min(t.size, Math.ceil((box.max.x + opts.falloff) / cs))
      const z1 = Math.min(t.size, Math.ceil((box.max.z + opts.falloff) / cs))
      if (x1 <= x0 || z1 <= z0) continue
      const w = x1 - x0 + 1
      const h = z1 - z0 + 1
      const ground = new Float32Array(w * h)
      const floor = new Float32Array(w * h).fill(NaN)
      const bottom = box.min.y - 1
      for (let z = 0; z < h; z++) {
        for (let x = 0; x < w; x++) {
          const vx = x0 + x
          const vz = z0 + z
          const g = t.heights[vz * V + vx]
          ground[z * w + x] = g
          const wx = vx * cs
          const wz = vz * cs
          if (wx < box.min.x || wx > box.max.x || wz < box.min.z || wz > box.max.z) continue
          // A floor counts only near the ground: a stable without one would otherwise lift the
          // ground to its hayloft.
          floor[z * w + x] = stamp ? this.objects.surfaceAt(id, wx, wz, false, bottom) : this.objects.surfaceAt(id, wx, wz, true, bottom, g - fit.reach, g + fit.reach)
        }
      }
      const r = fitHeights(ground, floor, w, h, x0, z0, cs, opts)
      if (!r.changed) continue
      fitted++
      // The models on the ground under this one would ride the ground: note where each stood.
      const o = this.objects.objects.get(id)!
      const before = o.parent === undefined ? t.heightAt(o.x, o.z) : 0
      const rect = { x0, z0, x1, z1 }
      stroke.reserveHeights(rect)
      for (let z = 0; z < h; z++) t.heights.set(r.heights.subarray(z * w, z * w + w), (z0 + z) * V + x0)
      stroke.touchHeights(rect)
      t.markDirty(x0, z0, x1, z1)
      if (r.holes.some((v) => v)) {
        const cr = { x0, z0, x1: x1 - 1, z1: z1 - 1 }
        stroke.reserveHoles(cr)
        for (let z = 0; z < h - 1; z++) for (let x = 0; x < w - 1; x++) if (r.holes[z * (w - 1) + x]) t.holes[(z0 + z) * t.size + x0 + x] = 1
        stroke.touchHoles(cr)
      }
      if (o.parent === undefined) {
        const dy = before - t.heightAt(o.x, o.z)
        if (dy !== 0) {
          const prev = { ...o }
          o.yOff += dy
          this.objects.touch(o.id)
          moved.push({ before: prev, after: { ...o } })
        }
      }
    }
    const terrainCmd = stroke.finish()
    if (terrainCmd) {
      resnap({ x0: 0, z0: 0, x1: t.size, z1: t.size })
      const moves = moved.length
        ? groupTransformCommand(
            this.objects,
            moved.map((m) => m.before),
            moved.map((m) => m.after),
          )
        : null
      this.history.push({
        label: terrainCmd.label,
        undo: () => {
          moves?.undo()
          terrainCmd.undo()
        },
        redo: () => {
          terrainCmd.redo()
          moves?.redo()
        },
      })
    }
    const what = stamp ? 'Stamped' : 'Fitted the ground to'
    if (fitted) setStatus(`${what} ${fitted} ${fitted === 1 ? 'model' : 'models'}.${loading ? ` ${loading} still loading, left out.` : ''}`, 5000)
    else setStatus(loading ? 'The selected models are still loading; try again in a moment.' : 'Nothing to change: the ground already fits.', 5000)
  }

  /** How many cells of the selected area are holes, for the options bar. */
  holesInSelection(): number {
    const s = editor.selection
    if (!s) return 0
    const t = this.terrain
    const shape = areaShape(t, t.size)
    if (!shape) return countHoles(t.holes, t.size, s.x0, s.z0, s.x1, s.z1)
    let n = 0
    for (let z = s.z0; z < s.z1; z++) for (let x = s.x0; x < s.x1; x++) if (shape[z * t.size + x] && t.holes[z * t.size + x]) n++
    return n
  }

  /** Copy the selected area (terrain, holes, textures, objects) to the clipboard. */
  /**
   * Copies the selected models, or, with none selected, the selected area (terrain, holes, textures
   * and the models in it), to the clipboard.
   */
  copySelection(): boolean {
    const sel = selectedObjects(this.objects)
    if (sel.length) {
      this.objectClip = copyObjects(this.terrain, this.objects, sel)
      this.lastCopied = 'objects'
      ui.hasClip = true
      const n = this.objectClip.objects.length
      setStatus(`Copied ${n} ${n === 1 ? 'model' : 'models'}. Ctrl+V pastes a copy under the cursor (in any map tab); Ctrl+Shift+D duplicates in place.`)
      return true
    }
    const s = editor.selection
    if (!s || s.x1 <= s.x0 || s.z1 <= s.z0) {
      setStatus('Nothing selected. Click a model, or drag on the ground with the Select tool (V) to select part of the map first.')
      return false
    }
    const shape = areaShape(this.terrain, this.terrain.size)
    this.clip = copyRegion(this.terrain, this.objects, s, editor.palette, this.doc.liquids, shape ? cellsInRect(shape, this.terrain.size, s) : undefined)
    this.lastCopied = 'area'
    ui.hasClip = true
    const liquid = this.clip.liquids?.cells.length ? `, ${this.clip.liquids.cells.length} liquid cells` : ''
    setStatus(`Copied ${this.clip.w}×${this.clip.h} cells${liquid} and ${this.clip.objects.length} objects. Paste with Ctrl+V (works in other map tabs too).`)
    return true
  }

  /** The selected models as a clip about their middle (Save Selection as Prefab, #170), or null with none. */
  selectionClip(): ObjectClip | null {
    const sel = selectedObjects(this.objects)
    return sel.length ? copyObjects(this.terrain, this.objects, sel) : null
  }

  /**
   * Puts `clip` on the clipboard and starts pasting it under the cursor, as Ctrl+V does with copied
   * models: how a prefab is placed (#170). R and Ctrl+scroll turn it before the click.
   */
  placeObjectClip(clip: ObjectClip) {
    this.objectClip = clip
    this.lastCopied = 'objects'
    ui.hasClip = true
    this.startPaste()
  }

  /** Turns the models waiting to be pasted about their middle (R, Shift+R, Ctrl+scroll while pasting models). */
  turnPastedModels(radians: number) {
    if (!ui.pasting || this.lastCopied !== 'objects' || !this.objectClip) return
    this.objectClip = turnObjectClip(this.objectClip, radians)
  }

  /** Whether what Paste would place is models rather than an area. */
  pastingModels() {
    return this.lastCopied === 'objects'
  }

  /** Start placing the clipboard: the copied models, or a rect of the copied area, follow the mouse until clicked. */
  startPaste() {
    if (!(this.lastCopied === 'objects' ? this.objectClip : this.clip)) {
      setStatus('The clipboard is empty. Select models or an area with the Select tool and press Ctrl+C.')
      return
    }
    editor.tool = 'select'
    selectObjects(this.objects, [])
    ui.pasting = true
    this.selectTool.pasteAt = null
    this.selectTool.pasteWorld = null
    setStatus(
      this.lastCopied === 'objects'
        ? 'Click to put the copied models down · Enter places them · Esc cancels'
        : 'Click to place the paste · Enter places it · R turns it · PgUp/PgDn raise/lower · Esc cancels',
      0,
    )
  }

  /** Turns the area waiting to be pasted a quarter turn (R while pasting; noggit's chunk mover has the same). */
  rotateClip() {
    if (!ui.pasting || this.lastCopied !== 'area' || !this.clip) return
    this.clip = rotateClip(this.clip, this.terrain.cellSize)
    setViewportHint(`Paste ${this.clip.w}×${this.clip.h}`)
  }

  /** The texture looks for the terrain shader, 256 entries of RGBA, and what it was built from. */
  private lookTex: THREE.DataTexture | null = null
  private lookFrom: { looks: unknown; palette: unknown } = { looks: null, palette: null }

  /** Keeps the terrain shader's texture looks (scrolling, overbright) in step with the map's (B-162). */
  private updateLookTexture(u: Record<string, THREE.IUniform>, time: number) {
    // time is the clock's seconds.
    if (!this.lookTex) {
      this.lookTex = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
      this.lookTex.needsUpdate = true
    }
    const looks = editor.textureLooks
    const palette = editor.palette
    if (this.lookFrom.looks !== looks || this.lookFrom.palette !== palette) {
      this.lookFrom = { looks, palette }
      const data = this.lookTex.image.data as Uint8Array
      data.fill(0)
      palette.forEach((p, i) => {
        const f = looks[p]
        if (f === undefined || i >= 256) return
        const l = lookOf(f)
        data[i * 4] = l.animate ? l.speed + 1 : 0
        data[i * 4 + 1] = l.turn
        data[i * 4 + 2] = l.overbright ? 255 : 0
      })
      this.lookTex.needsUpdate = true
    }
    u.lookTex.value = this.lookTex
    u.lookTime.value = time
  }

  /** The image brush's texture on the GPU, and the brushImage version it holds. */
  private brushImgTex: THREE.DataTexture | null = null
  private brushImgVersion = -1

  /** Shows the image brush in the brush ring while a tool it shapes is active, turned as its stroke will be. */
  private updateBrushImageCursor(u: Record<string, THREE.IUniform>, tool: Tool) {
    if (this.brushImgVersion !== brushImage.version) {
      this.brushImgVersion = brushImage.version
      this.brushImgTex?.dispose()
      this.brushImgTex = null
      if (brushImage.bytes) {
        this.brushImgTex = new THREE.DataTexture(brushImage.bytes, brushImage.w, brushImage.h, THREE.RedFormat, THREE.UnsignedByteType)
        this.brushImgTex.magFilter = this.brushImgTex.minFilter = THREE.LinearFilter
        this.brushImgTex.needsUpdate = true
      }
    }
    const on = !!this.brushImgTex && tool.usesBrush && !!tool.imageShaped?.()
    u.brushImgOn.value = on ? 1 : 0
    if (!on) return
    u.brushImg.value = this.brushImgTex
    const r = (editor.brushImage.rotation * Math.PI) / 180
    ;(u.brushImgRot.value as THREE.Vector2).set(Math.cos(r), Math.sin(r))
  }

  /** Mirrors the area waiting to be pasted east to west (`x`) or north to south (`z`). */
  mirrorClip(axis: 'x' | 'z') {
    if (!ui.pasting || this.lastCopied !== 'area' || !this.clip) return
    this.clip = mirrorClip(this.clip, axis, this.terrain.cellSize)
    setViewportHint(axis === 'x' ? 'Paste mirrored east to west' : 'Paste mirrored north to south')
  }

  /** Copies the selected models and puts the copies down a little to the side, selected, as one undo step. */
  duplicateSelected() {
    const sel = selectedObjects(this.objects)
    if (!sel.length) return
    const clip = copyObjects(this.terrain, this.objects, sel)
    let ax = 0
    let az = 0
    for (const o of sel) {
      const p = this.objects.worldPosition(o, this.tmpV)
      ax += p.x
      az += p.z
    }
    const step = this.terrain.cellSize
    const r = pasteObjects(this.terrain, this.objects, clip, ax / sel.length + step, az / sel.length + step)
    if (!r) return
    r.cmd.label = sel.length === 1 ? 'Duplicate model' : `Duplicate ${sel.length} models`
    this.history.push(r.cmd)
    selectObjects(this.objects, r.added.map((o) => o.id))
    setStatus(`Duplicated ${r.added.length} ${r.added.length === 1 ? 'model' : 'models'}; the copies are selected, so the arrow keys move them.`)
  }

  cancelPaste() {
    ui.pasting = false
    setStatus('Paste cancelled.')
  }

  commitPaste() {
    if (this.lastCopied === 'objects') {
      const at = this.selectTool.pasteWorld
      if (!this.objectClip || !at) return
      const r = pasteObjects(this.terrain, this.objects, this.objectClip, at.x, at.z, this.selectTool.pasteOnModel)
      if (!r) {
        setStatus('Nothing landed on the map.')
        return
      }
      this.history.push(r.cmd)
      // The copies stay selected, so they can be nudged into place or pasted again with Ctrl+V.
      selectObjects(this.objects, r.added.map((o) => o.id))
      ui.pasting = false
      setStatus(`Pasted ${r.added.length} ${r.added.length === 1 ? 'model' : 'models'}. Ctrl+V pastes again; Ctrl+Z undoes.`)
      return
    }
    const at = this.selectTool.pasteAt
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
      this.doc.liquids,
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

  /**
   * Hides the selected objects for this session (H), with everything attached to them so nothing is
   * left in mid-air, or shows them all again when the selection is all hidden.
   */
  toggleHideSelected() {
    const sel = selectedObjects(this.objects)
    if (!sel.length) return
    const hide = sel.some((o) => !this.objects.hidden.has(o.id))
    const ids = this.objects.descendantsOf(sel.map((o) => o.id))
    for (const id of ids) this.objects.setHidden(id, hide)
    if (hide && !ui.showHiddenModels) selectObjects(this.objects, [])
    ui.hiddenModels = this.objects.hidden.size
    const n = sel.length
    const what = n === 1 ? 'Model' : `${n} models`
    const kids = ids.size - n
    const attached = kids ? ` with ${kids} attached` : ''
    setStatus(hide ? `${what}${attached} hidden. Shift+H shows all hidden models again.` : `${what}${attached} shown.`, 3000)
  }

  /** Shows every hidden object of the active map again (Shift+H). */
  unhideAll() {
    const n = this.objects.hidden.size
    this.objects.clearHidden()
    ui.hiddenModels = 0
    if (n) setStatus(`${n} hidden model${n === 1 ? '' : 's'} shown again.`, 3000)
  }

  /**
   * Outlines every selected object, and shows the handles on the selection when it is one object
   * (Select and Place tools).
   */
  private updateSelectionVisuals() {
    const sel = this.canNudge() ? selectedObjects(this.objects) : []
    const targets = this.outlineTargets
    targets.length = 0
    for (let i = 0; i < sel.length; i++) {
      const m = (this.outlineMatrices[i] ??= new THREE.Matrix4())
      this.objects.matrixOf(sel[i], m)
      targets.push({ asset: getAsset(sel[i].type), matrix: m, touching: this.touchesSomething(sel[i], sel.length) })
    }
    this.outline.setTargets(targets)
    this.outline.setTerrain(this.terrain)
    if (sel.length > 1) {
      // A group: the handles stand at its pivot, sized to the whole, and work the group as one.
      this.placeGroupGizmo(sel)
      this.outline.setWarnBoxes(NO_BOXES)
      if (this.canvas.style.cursor && !this.gizmoDrag) this.canvas.style.cursor = ''
      return
    }
    const o = sel.length === 1 ? sel[0] : undefined
    if (!o) {
      // No model: the selected creature or object of the region gets the ring and arrow instead.
      const s = this.gizmoSpawn()
      if (s && this.doc.spawnLayer.boundsOf(s, this.tmpBox)) {
        const size = this.tmpBox.getSize(this.tmpV)
        this.gizmo.update(this.dragPoint.set(s.x, s.y, s.z), Math.max(size.x, size.z) * 0.55, this.tmpBox.max.y, this.viewEye(), false)
      } else this.gizmo.hide()
      this.outline.setWarnBoxes(NO_BOXES)
      if (this.canvas.style.cursor && !this.gizmoDrag) this.canvas.style.cursor = ''
      return
    }
    const asset = getAsset(o.type)
    this.objects.matrixOf(o, this.tmpM)

    this.tmpBox.copy(asset.bbox).applyMatrix4(this.tmpM)
    const size = this.tmpBox.getSize(this.tmpV)
    const base = this.objects.worldPosition(o, this.dragPoint)
    this.gizmo.update(base, Math.max(size.x, size.z) * 0.55, this.tmpBox.max.y, this.viewEye(), !o.type.startsWith('wmo:'), true, editor.gizmoLocal ? this.objects.worldYaw(o) : 0)

    // Last: overlappingBoxes reuses the scratch matrix/vectors used above.
    this.outline.setWarnBoxes(this.overlappingBoxes(o))
  }

  private sightRay = new THREE.Raycaster()
  private sightDir = new THREE.Vector3()
  private sightHit = new THREE.Vector3()

  /** Whether the ground or a building stands between the camera and `to` (a spawn's name, #125). */
  private sightBlocked(to: THREE.Vector3): boolean {
    const eye = this.camera.position
    const dir = this.sightDir.subVectors(to, eye)
    const d = dir.length()
    if (d < 1) return false
    dir.divideScalar(d)
    const ray = this.sightRay
    ray.set(eye, dir)
    ray.far = d - 0.5
    if (this.terrain.raycast(ray.ray, this.sightHit, d - 0.5)) return true
    // Buildings hide a name, as walls do in the game; trees and doodads don't.
    return this.objects.wmoBlocks(ray)
  }

  /** Marks the models the Clear tool's brush would delete, while it is the active tool. */
  private updateDoomVisuals() {
    const doomed = editor.tool === 'clear' ? this.clearTool.doomed : NO_OBJECTS
    const targets = this.doomTargets
    if (!doomed.length && !targets.length) return
    targets.length = 0
    for (let i = 0; i < doomed.length; i++) {
      const m = (this.doomMatrices[i] ??= new THREE.Matrix4())
      this.objects.matrixOf(doomed[i], m)
      targets.push({ asset: getAsset(doomed[i].type), matrix: m, touching: false })
    }
    this.doomOutline.setTargets(targets)
  }

  /** Puts the gizmo at a multi-selection's pivot, the ring round the whole group and the arrow over its top. */
  private placeGroupGizmo(sel: readonly WorldObject[]) {
    const targets = movableSelection(this.objects)
    const pivot = this.selectionPivot(targets.length ? targets : sel)
    let radius = 0
    let topY = -Infinity
    let baseY = 0
    let scalable = true
    for (const o of sel) {
      this.objects.matrixOf(o, this.tmpM)
      this.tmpBox.copy(getAsset(o.type).bbox).applyMatrix4(this.tmpM)
      for (const x of [this.tmpBox.min.x, this.tmpBox.max.x]) for (const z of [this.tmpBox.min.z, this.tmpBox.max.z]) radius = Math.max(radius, Math.hypot(x - pivot.x, z - pivot.z))
      topY = Math.max(topY, this.tmpBox.max.y)
      baseY += this.objects.worldPosition(o, this.tmpV).y / sel.length
      if (o.type.startsWith('wmo:')) scalable = false
    }
    const lead = this.selectedObject() ?? sel[0]
    this.gizmo.update(this.dragPoint.set(pivot.x, baseY, pivot.z), radius * 1.05, topY, this.viewEye(), scalable, true, editor.gizmoLocal ? this.objects.worldYaw(lead) : 0)
  }

  private warnBoxes: THREE.Box3[] = Array.from({ length: 8 }, () => new THREE.Box3())
  private touchBox = new THREE.Box3()
  private touchM = new THREE.Matrix4()

  /**
   * Whether a selected model touches anything, for the outline's colour: it is attached to a parent,
   * its lowest point is on (or under) the ground somewhere across its footprint, or another prop's
   * box meets its own. The prop test walks every object, so a big selection skips it.
   */
  private touchesSomething(o: WorldObject, selected: number): boolean {
    if (o.parent !== null && o.parent !== undefined) return true
    const box = this.touchBox.copy(getAsset(o.type).bbox).applyMatrix4(this.objects.matrixOf(o, this.touchM))
    // The ground under the footprint's centre and corners (no allocation: this runs every frame).
    let ground = this.groundAt((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2)
    ground = Math.max(ground, this.groundAt(box.min.x, box.min.z), this.groundAt(box.max.x, box.min.z))
    ground = Math.max(ground, this.groundAt(box.min.x, box.max.z), this.groundAt(box.max.x, box.max.z))
    if (box.min.y <= ground + 0.25) return true
    return selected <= 16 && this.overlappingBoxes(o).length > 0
  }

  /** The terrain height at a point, or -Infinity off the map or over a hole. */
  private groundAt(x: number, z: number): number {
    const t = this.terrain
    return t.contains(x, z) && !t.isHole(x, z) ? t.heightAt(x, z) : -Infinity
  }

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

  private ringAngle(p: THREE.Vector3, o: { x: number; z: number }) {
    return Math.atan2(-(p.z - o.z), p.x - o.x)
  }

  /** The selected creature or region object the gizmo works on, when no model is selected (Select tool). */
  private gizmoSpawn(): vmangos.WorldSpawn | undefined {
    if (editor.tool !== 'select' || editor.selectedIds.length || !editor.selectedSpawn) return undefined
    return this.doc.spawnLayer.get(spawnKey(editor.selectedSpawn)) ?? undefined
  }

  /**
   * Puts where a gizmo drag is into dragPoint: the cursor on the drag plane, or, for the height arrow in
   * the top-down view (whose straight-down ray never meets the arrow's upright plane), a height from the
   * cursor's height on screen, a yard per yard of the view. Returns false when the cursor misses the plane.
   */
  private dragAt(handle: GizmoHandle): boolean {
    if (handle === 'arrow' && this.topDown) {
      const o = this.ortho
      this.dragPoint.y = (this.ndc.y * (o.top - o.bottom)) / (2 * o.zoom)
      return true
    }
    this.raycaster.setFromCamera(this.ndc, this.camera)
    return !!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)
  }

  /** Begin dragging a gizmo handle under the pointer. Returns true if one was hit. */
  private startGizmoDrag(): boolean {
    if (this.canNudge() && editor.selectedIds.length > 1) return this.startGroupGizmoDrag()
    const o = this.canNudge() && editor.selectedIds.length === 1 ? this.selectedObject() : undefined
    if (!o) return this.startSpawnGizmoDrag()
    if (!this.gizmo.visible) return false
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const handle = this.gizmo.pick(this.raycaster)
    if (!handle) return false
    const planeNormal = new THREE.Vector3()
    let startAngle = 0
    let startY = 0
    let startDist = 1
    if (handle === 'moveX' || handle === 'moveZ') {
      // Along the arrow, on the ring's plane.
      planeNormal.set(0, 1, 0)
      this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this.objects.worldPosition(o, this.tmpV).setY(this.gizmo.ringY))
      if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) return false
      const move = { axis: this.gizmo.axisDir(handle, new THREE.Vector3()), from: this.dragPoint.clone(), pos: this.objects.worldPosition(o, new THREE.Vector3()) }
      this.gizmoDrag = { handle, before: { ...o }, startAngle, startY, startWorldY: move.pos.y, startDist, planeNormal, move }
      this.canvas.style.cursor = 'move'
      return true
    }
    if (handle === 'ring' || handle === 'scale') {
      planeNormal.set(0, 1, 0)
      const centre = this.objects.worldPosition(o, this.tmpV).setY(this.gizmo.ringY)
      this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, centre)
      if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) return false
      startAngle = this.ringAngle(this.dragPoint, o)
      startDist = Math.max(0.05, Math.hypot(this.dragPoint.x - centre.x, this.dragPoint.z - centre.z))
    } else {
      // Vertical plane through the object, facing the camera.
      planeNormal.copy(this.camera.position).sub(this.tmpV.set(o.x, 0, o.z)).setY(0).normalize()
      this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this.objects.worldPosition(o, this.tmpV))
      if (!this.dragAt('arrow')) return false
      startY = this.dragPoint.y
    }
    this.gizmoDrag = { handle, before: { ...o }, startAngle, startY, startWorldY: this.objects.worldPosition(o, this.tmpV).y, startDist, planeNormal }
    this.canvas.style.cursor = handle === 'ring' ? 'grabbing' : handle === 'scale' ? 'ew-resize' : 'ns-resize'
    return true
  }

  /**
   * A multi-selection's handles work the group as one about its pivot: the ring turns it (each model
   * about the pivot with Rotate around pivot point, else in place), the knob scales it (the models and
   * their spread from the pivot), and the arrow lifts it. One undo step on release.
   */
  private startGroupGizmoDrag(): boolean {
    const targets = movableSelection(this.objects)
    if (targets.length < 2 || !this.gizmo.visible) return false
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const handle = this.gizmo.pick(this.raycaster)
    if (!handle) return false
    const pivot = this.selectionPivot(targets)
    const planeNormal = new THREE.Vector3()
    let startAngle = 0
    let startY = 0
    let startDist = 1
    let move: { axis: THREE.Vector3; from: THREE.Vector3; pos: THREE.Vector3 } | undefined
    if (handle === 'moveX' || handle === 'moveZ') {
      planeNormal.set(0, 1, 0)
      this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this.tmpV.set(pivot.x, this.gizmo.ringY, pivot.z))
      if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) return false
      move = { axis: this.gizmo.axisDir(handle, new THREE.Vector3()), from: this.dragPoint.clone(), pos: new THREE.Vector3(pivot.x, 0, pivot.z) }
    } else if (handle === 'ring' || handle === 'scale') {
      planeNormal.set(0, 1, 0)
      this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this.tmpV.set(pivot.x, this.gizmo.ringY, pivot.z))
      if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) return false
      startAngle = this.ringAngle(this.dragPoint, pivot)
      startDist = Math.max(0.05, Math.hypot(this.dragPoint.x - pivot.x, this.dragPoint.z - pivot.z))
    } else {
      planeNormal.copy(this.camera.position).sub(this.tmpV.set(pivot.x, 0, pivot.z)).setY(0).normalize()
      this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this.tmpV.set(pivot.x, this.gizmo.ringY, pivot.z))
      if (!this.dragAt('arrow')) return false
      startY = this.dragPoint.y
    }
    const start = targets.map((o) => {
      const w = this.objects.worldPlacement(o)
      return { x: w.pos.x, z: w.pos.z, y: w.pos.y, rot: w.rot, scale: w.scale }
    })
    const primary = this.selectedObject() ?? targets[0]
    this.gizmoDrag = {
      handle,
      before: { ...primary },
      startAngle,
      startY,
      startWorldY: 0,
      startDist,
      planeNormal,
      move,
      group: { targets, before: targets.map((o) => ({ ...o })), start, pivot },
    }
    this.canvas.style.cursor = handle === 'ring' ? 'grabbing' : handle === 'scale' ? 'ew-resize' : move ? 'move' : 'ns-resize'
    return true
  }

  private updateGroupGizmoDrag(snap: boolean) {
    const d = this.gizmoDrag
    const g = d?.group
    if (!d || !g) return
    if (!this.dragAt(d.handle)) return
    const p = g.pivot
    let turn = 0
    let factor = 1
    let dy = 0
    let mx = 0
    let mz = 0
    if (d.move) {
      let along = (this.dragPoint.x - d.move.from.x) * d.move.axis.x + (this.dragPoint.z - d.move.from.z) * d.move.axis.z
      if (snap) along = Math.round(along * 2) / 2
      mx = d.move.axis.x * along
      mz = d.move.axis.z * along
      setViewportHint(`Move ${along >= 0 ? '+' : ''}${along.toFixed(2)} along ${d.handle === 'moveX' ? 'x' : 'z'} (${g.targets.length} objects)`)
    } else if (d.handle === 'ring') {
      turn = this.ringAngle(this.dragPoint, p) - d.startAngle
      if (snap) turn = Math.round(turn / (Math.PI / 12)) * (Math.PI / 12)
      this.gizmo.setSweep(d.startAngle, turn)
      setViewportHint(`Rotation ${Math.round(THREE.MathUtils.radToDeg(turn))}° (${g.targets.length} objects)`)
    } else if (d.handle === 'scale') {
      factor = Math.hypot(this.dragPoint.x - p.x, this.dragPoint.z - p.z) / d.startDist
      if (snap) factor = Math.max(0.1, Math.round(factor * 10) / 10)
      setViewportHint(`Scale ×${factor.toFixed(2)} (${g.targets.length} objects)`)
    } else {
      dy = this.dragPoint.y - d.startY
      if (snap) dy = Math.round(dy * 2) / 2
      setViewportHint(`Height ${dy >= 0 ? '+' : ''}${dy.toFixed(2)} (${g.targets.length} objects)`)
    }
    const about = editor.rotatePivot
    for (let i = 0; i < g.targets.length; i++) {
      const o = g.targets[i]
      const s = g.start[i]
      const w = this.objects.worldPlacement(o)
      let x = s.x + mx
      let z = s.z + mz
      if (about && turn !== 0) {
        const t = turnAbout(s.x, s.z, p.x, p.z, turn)
        x = t.x
        z = t.z
      }
      if (about && factor !== 1) {
        x = p.x + (x - p.x) * factor
        z = p.z + (z - p.z) * factor
      }
      w.pos.x = THREE.MathUtils.clamp(x, 0, this.terrain.worldSize)
      w.pos.z = THREE.MathUtils.clamp(z, 0, this.terrain.worldSize)
      // A ground model is re-seated on the terrain where it lands; an attached one keeps its height.
      w.pos.y = (o.parent === undefined && (turn !== 0 || factor !== 1 || mx !== 0 || mz !== 0) ? this.terrain.heightAt(w.pos.x, w.pos.z) + g.before[i].yOff : s.y) + dy
      w.rot = s.rot + turn
      w.scale = THREE.MathUtils.clamp(Math.round(s.scale * factor * 100) / 100, 0.05, 20)
      this.objects.place(o, o.parent ?? null, w)
      if (editor.selected?.id === o.id) editor.selected = { ...o }
    }
  }

  /** The spawn's ring turns its facing and its arrow its height; its position stays. */
  private startSpawnGizmoDrag(): boolean {
    const s = this.gizmoSpawn()
    if (!s || !this.gizmo.visible) return false
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const handle = this.gizmo.pick(this.raycaster)
    if (!handle || handle === 'scale' || handle === 'moveX' || handle === 'moveZ') return false
    const planeNormal = new THREE.Vector3()
    let startAngle = 0
    let startY = 0
    if (handle === 'ring') {
      planeNormal.set(0, 1, 0)
      this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this.tmpV.set(s.x, this.gizmo.ringY, s.z))
      if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) return false
      startAngle = this.ringAngle(this.dragPoint, s)
    } else {
      planeNormal.copy(this.camera.position).sub(this.tmpV.set(s.x, 0, s.z)).setY(0).normalize()
      this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this.tmpV.set(s.x, s.y, s.z))
      if (!this.dragAt('arrow')) return false
      startY = this.dragPoint.y
    }
    const key = spawnKey(s)
    this.gizmoDrag = { handle, before: { id: -1, type: '', x: s.x, z: s.z, yOff: 0, rotY: 0, scale: 1 }, startAngle, startY, startWorldY: s.y, startDist: 1, planeNormal, spawn: { key, orientation: s.orientation, y: s.y } }
    this.canvas.style.cursor = handle === 'ring' ? 'grabbing' : 'ns-resize'
    return true
  }

  private updateSpawnGizmoDrag(snap: boolean) {
    const d = this.gizmoDrag
    const sp = d?.spawn
    const s = sp ? this.doc.spawnLayer.get(sp.key) : undefined
    if (!d || !sp || !s) return
    if (!this.dragAt(d.handle)) return
    if (d.handle === 'ring') {
      let rot = spawnRotation(sp.orientation) + (this.ringAngle(this.dragPoint, s) - d.startAngle)
      if (snap) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12)
      this.gizmo.setSweep(d.startAngle, rot - spawnRotation(sp.orientation))
      applySpawn(this.doc.spawnLayer, sp.key, { orientation: spawnOrientation(rot) })
      setViewportHint(`Facing ${Math.round(THREE.MathUtils.radToDeg(spawnOrientation(rot)))}°`)
    } else {
      let dy = this.dragPoint.y - d.startY
      if (snap) dy = Math.round(dy * 2) / 2
      const y = sp.y + dy
      applySpawn(this.doc.spawnLayer, sp.key, { y })
      const above = y - this.terrain.heightAt(s.x, s.z)
      setViewportHint(`Height ${above >= 0 ? '+' : ''}${above.toFixed(2)} above the ground`)
    }
  }

  private updateGizmoDrag(snap: boolean) {
    const d = this.gizmoDrag
    if (d?.spawn) return this.updateSpawnGizmoDrag(snap)
    if (d?.group) return this.updateGroupGizmoDrag(snap)
    const o = this.selectedObject()
    if (!d || !o) return
    if (!this.dragAt(d.handle)) return
    if (d.move) {
      // Along the arrow: a model on the ground stays on it where it lands; an attached one keeps its height.
      let along = (this.dragPoint.x - d.move.from.x) * d.move.axis.x + (this.dragPoint.z - d.move.from.z) * d.move.axis.z
      if (snap) along = Math.round(along * 2) / 2
      const w = this.objects.worldPlacement(o)
      w.pos.x = THREE.MathUtils.clamp(d.move.pos.x + d.move.axis.x * along, 0, this.terrain.worldSize)
      w.pos.z = THREE.MathUtils.clamp(d.move.pos.z + d.move.axis.z * along, 0, this.terrain.worldSize)
      w.pos.y = o.parent === undefined ? this.terrain.heightAt(w.pos.x, w.pos.z) + d.before.yOff : d.move.pos.y
      this.objects.place(o, o.parent ?? null, w)
      setViewportHint(`Move ${along >= 0 ? '+' : ''}${along.toFixed(2)} along ${d.handle === 'moveX' ? 'x' : 'z'}`)
    } else if (d.handle === 'ring') {
      let rot = d.before.rotY + (this.ringAngle(this.dragPoint, o) - d.startAngle)
      if (snap) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12)
      o.rotY = rot
      this.gizmo.setSweep(d.startAngle, rot - d.before.rotY)
      const deg = Math.round(THREE.MathUtils.euclideanModulo(THREE.MathUtils.radToDeg(rot), 360)) % 360
      setViewportHint(`Rotation ${deg}°`)
    } else if (d.handle === 'scale') {
      // The knob rides the ring, whose radius grows with the scale, so it follows the cursor.
      const centre = this.objects.worldPosition(o, this.tmpV)
      const dist = Math.hypot(this.dragPoint.x - centre.x, this.dragPoint.z - centre.z)
      let scale = d.before.scale * (dist / d.startDist)
      if (snap) scale = Math.round(scale * 10) / 10
      o.scale = THREE.MathUtils.clamp(Math.round(scale * 100) / 100, 0.05, 20)
      setViewportHint(`Scale ×${o.scale.toFixed(2)}`)
    } else {
      let dy = this.dragPoint.y - d.startY
      if (snap) dy = Math.round(dy * 2) / 2
      const w = this.objects.worldPlacement(o)
      w.pos.y = d.startWorldY + dy
      this.objects.place(o, o.parent ?? null, w)
      setViewportHint(`Height ${o.yOff >= 0 ? '+' : ''}${o.yOff.toFixed(2)}`)
    }
    this.objects.touch(o.id)
    editor.selected = { ...o }
  }

  private endGizmoDrag() {
    const d = this.gizmoDrag
    this.gizmoDrag = null
    this.gizmo.setSweep(0, 0)
    this.canvas.style.cursor = ''
    if (d?.spawn) {
      const layer = this.doc.spawnLayer
      const sp = d.spawn
      const s = layer.get(sp.key)
      if (!s || (s.orientation === sp.orientation && s.y === sp.y)) return
      const before: SpawnFields = d.handle === 'ring' ? { orientation: sp.orientation } : { y: sp.y }
      const after: SpawnFields = d.handle === 'ring' ? { orientation: s.orientation } : { y: s.y }
      this.history.push({ label: `${d.handle === 'ring' ? 'Turn' : 'Raise'} ${s.name}`, undo: () => applySpawn(layer, sp.key, before), redo: () => applySpawn(layer, sp.key, after) })
      return
    }
    if (d?.group) {
      const g = d.group
      const same = (a: WorldObject, b: WorldObject) => a.x === b.x && a.z === b.z && a.yOff === b.yOff && a.rotY === b.rotY && a.scale === b.scale
      if (g.targets.every((o, i) => same(o, g.before[i]))) return
      const verb = d.handle === 'ring' ? 'Turn' : d.handle === 'scale' ? 'Scale' : d.move ? 'Move' : 'Raise'
      this.history.push(groupTransformCommand(this.objects, g.before, g.targets, `${verb} ${g.targets.length} objects`))
      return
    }
    const o = this.selectedObject()
    if (!d || !o) return
    if (o.rotY !== d.before.rotY || o.yOff !== d.before.yOff || o.x !== d.before.x || o.z !== d.before.z || o.scale !== d.before.scale) {
      this.history.push(transformCommand(this.objects, d.before, o))
    }
  }

  /** Whether Alt+click picks something in the active tool: a model or the ground's texture, a texture, or the water's height. */
  private pipetteApplies() {
    const t = editor.tool
    if (t === 'select' || t === 'place' || t === 'road') return true
    if (t === 'paint') return editor.paintMode !== 'mask'
    if (t === 'water') return editor.waterMode === 'paint'
    if (t === 'mapdata') return editor.mapDataMode === 'area'
    if (t === 'sculpt') return editor.sculptMode === 'flatten'
    return false
  }

  /** Shows the eyedropper while Alt is held over the viewport where Alt+click is the pipette. Toggles a class only on change. */
  private updatePipetteCursor() {
    const want = this.altHeld && this.pointerInside && !this.leftDown && !this.gizmoDrag && !this.controller.isDragging && this.pipetteApplies()
    if (want === this.pipetteOn) return
    this.pipetteOn = want
    this.canvas.classList.toggle('pipette', want)
  }

  /** The active tool has a brush the size controls apply to (the doodad brush spins on Ctrl+scroll instead). */
  private brushSizable(): boolean {
    return !!this.activeTool?.usesBrush && editor.tool !== 'place' && editor.tool !== 'doodad'
  }

  /** Whether the falloff means anything to the active tool (the water brush and roads have none). */
  private brushFalloffApplies(): boolean {
    const t = editor.tool
    return t !== 'road' && !(t === 'water' && editor.waterMode === 'paint') && !(t === 'sculpt' && editor.sculptMode === 'vertex')
  }

  /** [ and ] (and Ctrl+scroll): the brush one Photoshop-style notch bigger or smaller. */
  stepBrush(dir: 1 | -1) {
    editor.brush.radius = stepRadius(editor.brush.radius, dir, 1, MAX_BRUSH_RADIUS)
    this.showBrushHint()
  }

  private showBrushHint() {
    const f = this.brushFalloffApplies() ? ` · Falloff ${editor.brush.falloff.toFixed(2)}` : ''
    setViewportHint(`Size ${editor.brush.radius.toFixed(1)}${f}`)
  }

  /** The zone and tile effect choices the tuft key was last made from, and that key. */
  private scopedFrom: ScopedEffects | null = null
  private scopedKey = ''

  /** The export's effect per palette texture and paint chunk, with the map's zone and tile choices. */
  private exportEffectAt(): (tex: number, gx: number, gz: number) => number {
    const t = this.terrain
    const side = t.paintChunksPerSide
    const palette = editor.palette
    const own = editor.textureEffects
    const scoped = plainScoped(editor.scopedEffects)
    const tables = groundEffectTables()
    return (tex, gx, gz) => effectAt(palette[tex] ?? '', own, scoped, t.areaIds[gz * side + gx], Math.floor(gx / 16), Math.floor(gz / 16), tables)
  }

  /** Where the camera is for the ground effect choices: the zone of the chunk under it and the map's tile. */
  effectScopeAtCamera(): { areaId: number; tx: number; tz: number } {
    const t = this.terrain
    const at = this.controller.target
    const side = t.paintChunksPerSide
    const per = t.worldSize / side
    const gx = Math.min(side - 1, Math.max(0, Math.floor(at.x / per)))
    const gz = Math.min(side - 1, Math.max(0, Math.floor(at.z / per)))
    return { areaId: t.areaIds[gz * side + gx], tx: Math.floor(gx / 16), tz: Math.floor(gz / 16) }
  }

  /**
   * Lighting › Baked Shadows shows or hides the baked shadows (MCSH); the Map data tool's Shadow mode
   * shows them too. A region whose map holds none of its own reads the client's once per terrain, and
   * they become the map's (saved with it and sent on export, B-057), unless the author painted some first.
   */
  private updateBakedShadows() {
    const t = this.terrain
    t.showBakedShadows(!!this.prefs?.bakedShadows || (editor.tool === 'mapdata' && editor.mapDataMode === 'shadow'))
    const region = this.doc.meta.region
    if (t.bakedRequested || !region || !wow.loaded) return
    t.bakedRequested = true
    RegionShadows(region.mapName, region.x, region.y, region.size)
      .then((s) => {
        if (s?.bits && !t.shadow) t.setBakedShadows(base64ToBytes(s.bits), s.side)
      })
      .catch((err) => console.warn('baked shadows not read', err))
  }

  /** The selected area as shadow texels (inclusive), or the whole map. */
  private shadowRect() {
    const t = this.terrain
    const s = editor.selection
    const n = SHADOW_PER_CELL
    if (s && s.x1 > s.x0 && s.z1 > s.z0) return { x0: s.x0 * n, z0: s.z0 * n, x1: s.x1 * n - 1, z1: s.z1 * n - 1 }
    return { x0: 0, z0: 0, x1: t.shadowSide - 1, z1: t.shadowSide - 1 }
  }

  /**
   * Terrain › Bake Shadows: works the baked shadows out from the ground and, unless `groundOnly`, the
   * placed models (#163), in the selected area or the whole map, for the client's lighting sun at the
   * current hour (which never sets), as one undo step. Models make it slow (seconds a tile in a forest),
   * so it runs a band of rows at a time between frames, with its progress in the status bar.
   */
  async bakeShadows(groundOnly = false) {
    if (this.shadowBaking) {
      setStatus('Shadows are still baking.')
      return
    }
    const t = this.terrain
    const r = this.shadowRect()
    const stroke = new ShadowStroke(t, groundOnly ? 'Bake shadows from the ground' : 'Bake shadows')
    stroke.reserve(r)
    const sun = lightingSunDir(this.hour * 60, [0, 0, 0])
    const models = groundOnly ? null : modelCasters(this.objects, t.size, t.cellSize)
    const bake = shadowBaker(t.heights, t.size, t.cellSize, sun, models?.casters)
    const out = t.ensureShadow()
    const where = editor.selection ? 'in the selected area' : 'over the map'
    // A free-form area bakes its rect, then puts back the texels outside its cells.
    const shape = areaShape(t, t.size)
    const side = t.shadowSide
    const kept = shape ? shadowTexels(out, side, r) : null
    this.shadowBaking = true
    let n = 0
    try {
      const band = { ...r }
      let z = r.z0
      while (z <= r.z1) {
        const start = performance.now()
        // About 30 ms of rows, then a turn for the editor.
        while (z <= r.z1 && performance.now() - start < 30) {
          band.z0 = z
          band.z1 = Math.min(r.z1, z + 1)
          n += bake(band, out)
          z = band.z1 + 1
        }
        if (z <= r.z1) {
          setStatus(`Baking shadows ${where}… ${Math.round(((z - r.z0) / (r.z1 - r.z0 + 1)) * 100)}%`, 2000)
          // A message, not a timeout: a hidden window throttles timeouts to one a second.
          await new Promise<void>((done) => {
            const ch = new MessageChannel()
            ch.port1.onmessage = () => done()
            ch.port2.postMessage(0)
          })
        }
      }
    } finally {
      this.shadowBaking = false
    }
    if (shape && kept) n = restoreOutsideShape(out, side, r, kept, shape, t.size, SHADOW_PER_CELL)
    // The bake may have ended on another tab; its stroke belongs to the map it started on.
    stroke.touch(r)
    const cmd = stroke.finish()
    if (cmd) (this.documents.find((d) => d.terrain === t)?.history ?? this.history).push(cmd)
    const from = models ? ` from the ground and ${models.count} models` : ' from the ground'
    const waiting = models?.loading ? ` ${models.loading} models still loading cast nothing; bake again once they show.` : ''
    setStatus((n ? `Baked the shadows ${where}${from}: ${n} texels changed.` : `The shadows ${where} were already so.`) + waiting, waiting ? 8000 : 4000)
  }

  /** Whether a shadow bake is running (bakeShadows). */
  private shadowBaking = false

  /** The tile the top-down camera frames while renderMinimapTile draws it, or null. */
  private minimapShot: { cx: number; cz: number; half: number; top: number } | null = null
  private minimapTarget: THREE.WebGLRenderTarget | null = null

  /** How many placed models still wait for their mesh (they draw as placeholders until then). */
  modelsLoading(): number {
    let n = 0
    for (const o of this.objects.list()) if (!isHelper(o.type) && !getAsset(o.type).ready) n++
    return n
  }

  /**
   * Draws the map's tile (tx, tz) straight from above for the client's minimap (B-129): `side` pixels
   * a side of RGBA, row 0 at the tile's north edge, column 0 at its west. The ground, the sea and the
   * liquids, lit as the editor lights them, and `models`: none, the buildings (WMOs, as the client's
   * own minimaps show them, without the trees) or all; no sky, fog, spawns, helpers or editing
   * overlays. Drawn four times larger and averaged down, so edges don't shimmer.
   */
  renderMinimapTile(tx: number, tz: number, models: 'none' | 'buildings' | 'all', side = 256): Uint8Array {
    const t = this.terrain
    const tile = TILE_CELLS * t.cellSize
    let top = editor.waterEnabled ? editor.waterLevel : -Infinity
    for (let i = 0; i < t.heights.length; i++) if (t.heights[i] > top) top = t.heights[i]
    // Models stand up to a few hundred yards above the ground; the camera is far above that.
    this.minimapShot = { cx: (tx + 0.5) * tile, cz: (tz + 0.5) * tile, half: tile / 2, top: top + 400 }
    const big = side * 4
    // From that height the deepest ground may lie past the top-down view's far plane.
    const far = this.ortho.far
    this.ortho.far = ORTHO_HEIGHT + 400 + 20000
    try {
      this.frame()
      const u = t.material.uniforms
      const saved: Array<[THREE.IUniform, unknown]> = []
      const set = (key: string, v: unknown) => {
        const un = u[key]
        if (!un) return
        saved.push([un, typeof un.value === 'object' && un.value && 'clone' in un.value ? (un.value as THREE.Vector4).clone() : un.value])
        if (un.value instanceof THREE.Vector4) un.value.set(0, 0, 0, 0)
        else un.value = v
      }
      set('brushVisible', 0)
      set('gridVisible', 0)
      set('chunkLineWorld', 0)
      set('contourStep', 0)
      set('climbCos', 0)
      set('selMode', 0)
      set('mapDataMode', 0)
      set('maskVisible', 0)
      set('unpaintable', -1)
      set('chunkHover', null)
      const keep = new Set<THREE.Object3D>([t.group, this.water.mesh, this.water.floor, this.doc.liquidRenderer.group, this.effects.group])
      if (models !== 'none') keep.add(this.objects.group)
      const hidden: THREE.Object3D[] = []
      if (models === 'buildings') {
        for (const m of this.objects.group.children) {
          if (!m.visible || String(m.userData.type ?? '').startsWith('wmo:')) continue
          m.visible = false
          hidden.push(m)
        }
      }
      for (const c of this.scene.children) {
        // Lights stay, so no shader is rebuilt for another light count.
        if (!c.visible || keep.has(c) || (c as THREE.Light).isLight) continue
        c.visible = false
        hidden.push(c)
      }
      const background = this.scene.background
      this.scene.background = new THREE.Color(0, 0, 0)
      let rt = this.minimapTarget
      if (!rt || rt.width !== big) {
        rt?.dispose()
        rt = this.minimapTarget = new THREE.WebGLRenderTarget(big, big, { samples: 0 })
        rt.texture.colorSpace = THREE.SRGBColorSpace
        // three tone maps and converts to sRGB only when drawing to the screen or to an XR target, and
        // the minimap should look as the editor's view does. Stored as plain bytes, not as an sRGB
        // texture, which would encode the shader's already encoded colours a second time.
        ;(rt as THREE.WebGLRenderTarget & { isXRRenderTarget: boolean }).isXRRenderTarget = true
        rt.texture.internalFormat = 'RGBA8'
      }
      const pix = new Uint8Array(big * big * 4)
      const prev = this.renderer.getRenderTarget()
      try {
        this.renderer.setRenderTarget(rt)
        this.renderer.clear()
        this.renderer.render(this.scene, this.ortho)
        this.renderer.readRenderTargetPixels(rt, 0, 0, big, big, pix)
      } finally {
        this.renderer.setRenderTarget(prev)
        this.scene.background = background
        for (const c of hidden) c.visible = true
        for (const [un, v] of saved) {
          if (un.value instanceof THREE.Vector4 && v instanceof THREE.Vector4) un.value.copy(v)
          else un.value = v
        }
      }
      // Averaged down 4x4, and turned upright: GL reads the bottom row first.
      const out = new Uint8Array(side * side * 4)
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          let r = 0
          let g = 0
          let b = 0
          for (let sy = 0; sy < 4; sy++) {
            const row = big - 1 - (y * 4 + sy)
            for (let sx = 0; sx < 4; sx++) {
              const i = (row * big + x * 4 + sx) * 4
              r += pix[i]
              g += pix[i + 1]
              b += pix[i + 2]
            }
          }
          const o = (y * side + x) * 4
          out[o] = r >> 4
          out[o + 1] = g >> 4
          out[o + 2] = b >> 4
          out[o + 3] = 255
        }
      }
      return out
    } finally {
      this.minimapShot = null
      this.ortho.far = far
      this.ortho.updateProjectionMatrix()
    }
  }

  /** Terrain › Clear Shadows: lights every baked shadow texel in the selected area or the whole map, as one undo step. */
  clearShadows() {
    this.clearShadowRect(this.shadowRect(), editor.selection ? 'in the selected area' : 'over the map')
  }

  /** Lights the baked shadow texels of a rect (inclusive), as one undo step; `where` names it in the status. */
  private clearShadowRect(r: { x0: number; z0: number; x1: number; z1: number }, where: string) {
    const t = this.terrain
    if (!t.shadow) {
      setStatus('The map has no baked shadows.')
      return
    }
    const stroke = new ShadowStroke(t, `Clear shadows ${where}`)
    stroke.reserve(r)
    const data = t.shadow
    const shape = areaShape(t, t.size)
    const n = SHADOW_PER_CELL
    for (let z = r.z0; z <= r.z1; z++) {
      if (!shape) {
        data.fill(0, z * t.shadowSide + r.x0, z * t.shadowSide + r.x1 + 1)
        continue
      }
      // A free-form area: only the texels of its cells.
      for (let x = r.x0; x <= r.x1; x++) if (shape[Math.floor(z / n) * t.size + Math.floor(x / n)]) data[z * t.shadowSide + x] = 0
    }
    stroke.touch(r)
    const cmd = stroke.finish()
    if (cmd) this.history.push(cmd)
    setStatus(cmd ? `Cleared the baked shadows ${where}.` : `There were no baked shadows ${where}.`)
  }

  /** Keeps the grass tufts around the camera current (see GroundEffectLayer). */
  private updateGroundEffects() {
    const layer = this.doc.groundEffects
    if (!layer.group.visible) return
    const tables = groundEffectTables()
    if (!tables) return
    // What the build depends on besides the ground: the palette, the map's own effects, the density
    // and the buildings (any object change, since the cells under a building grow nothing).
    const density = this.prefs?.groundEffectDensity ?? 'normal'
    let key = `${density}|${this.objects.version}|` + editor.palette.join('|')
    for (const [tex, id] of Object.entries(editor.textureEffects)) key += `|${tex}=${id}`
    if (this.scopedFrom !== editor.scopedEffects) {
      this.scopedFrom = editor.scopedEffects
      this.scopedKey = JSON.stringify(editor.scopedEffects)
    }
    key += this.scopedKey
    // The client seeds each chunk's tufts by its place in the client's map: a region's tiles start at its first.
    const region = this.doc.meta.region
    // Tufts show as far as the fade lets them, which is farther at the corners of a wide view.
    layer.reach = tuftReach(this.persp.fov, this.persp.aspect)
    layer.update(this.viewEye(), editor.palette, editor.textureEffects, tables, key, performance.now(), this.objects, frillDensity(density), editor.scopedEffects, region?.x ?? 0, region?.y ?? 0)
  }

  /** How many grass tufts are drawn now, for the status bar. */
  tuftCount(): number {
    return this.doc.groundEffects.count
  }

  /** Keyboard editing of the selected objects applies in the Select and Place tools. */
  canNudge() {
    return (!!editor.selected || editor.selectedIds.length > 0) && (editor.tool === 'select' || editor.tool === 'place')
  }

  /** The pivot a group turns about: the mean of the movable selection's world positions (see pivot.ts). */
  selectionPivot(targets: readonly WorldObject[] = movableSelection(this.objects)): { x: number; z: number } {
    return meanPivot(targets.map((o) => this.objects.worldPosition(o, this.tmpV)).map((p) => ({ x: p.x, z: p.z })))
  }

  /**
   * Move/raise/spin the selected objects. dx/dz are camera-relative (right,
   * forward); dy raises; dRot is radians: each object turns about itself, and with Rotate around
   * pivot point a group also turns about its pivot, keeping its shape. Rapid repeats merge
   * into one undo.
   */
  nudgeSelected(right: number, forward: number, dy: number, dRot: number) {
    const targets = movableSelection(this.objects)
    if (!targets.length) return
    const now = performance.now()
    const s = this.nudgeSession
    const key = targets.map((o) => o.id).join(',')
    const continuing = !!s && s.key === key && this.history.peek() === s.cmd && now - s.time < 1500
    const before = continuing ? s.before : targets.map((o) => ({ ...o }))
    const yaw = this.controller.yaw
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const pivot = dRot !== 0 && editor.rotatePivot && targets.length > 1 ? this.selectionPivot(targets) : null
    for (const o of targets) {
      // Work in world space so attached props move the way the camera expects.
      const w = this.objects.worldPlacement(o)
      if (pivot) {
        const t = turnAbout(w.pos.x, w.pos.z, pivot.x, pivot.z, dRot)
        w.pos.x = t.x
        w.pos.z = t.z
      }
      w.pos.x = THREE.MathUtils.clamp(w.pos.x + fx * forward - fz * right, 0, this.terrain.worldSize)
      w.pos.z = THREE.MathUtils.clamp(w.pos.z + fz * forward + fx * right, 0, this.terrain.worldSize)
      // A model on the ground stays on it where it lands; an attached one keeps its height.
      if (pivot && o.parent === undefined) w.pos.y = this.terrain.heightAt(w.pos.x, w.pos.z) + o.yOff
      w.pos.y += dy
      w.rot += dRot
      this.objects.place(o, o.parent ?? null, w)
      if (editor.selected?.id === o.id) editor.selected = { ...o }
    }
    const cmd = groupTransformCommand(this.objects, before, targets)
    if (continuing) this.history.replaceTop(cmd)
    else this.history.push(cmd)
    this.nudgeSession = { key, before, cmd, time: now }
  }

  /**
   * Sets the selected models that stand on the ground back onto it (a height offset of 0), as Noggit
   * Red's Snap to ground does; attached models ride their parents and are left alone. One undo step.
   */
  snapSelectedToGround() {
    const targets = movableSelection(this.objects).filter((o) => o.parent === undefined && o.yOff !== 0)
    if (!targets.length) {
      setStatus(editor.selectedIds.length ? 'The selected models already stand on the ground (attached ones ride their parents).' : 'Select the models to put on the ground first.', 3000)
      return
    }
    const before = targets.map((o) => ({ ...o }))
    for (const o of targets) {
      const w = this.objects.worldPlacement(o)
      w.pos.y = this.terrain.heightAt(w.pos.x, w.pos.z)
      this.objects.place(o, null, w)
      if (editor.selected?.id === o.id) editor.selected = { ...o }
    }
    this.history.push(groupTransformCommand(this.objects, before, targets))
    setStatus(`Put ${targets.length} model${targets.length === 1 ? '' : 's'} on the ground.`, 2500)
  }

  /** Keys for the selected object. Returns true if handled. */
  handleSelectionKey(e: KeyboardEvent): boolean {
    if (ui.pasting && this.lastCopied === 'area' && (e.key === 'r' || e.key === 'R')) {
      this.rotateClip()
      return true
    }
    if (ui.pasting && this.lastCopied === 'objects' && (e.key === 'r' || e.key === 'R')) {
      this.turnPastedModels((e.shiftKey ? 1 : -1) * THREE.MathUtils.degToRad(45))
      return true
    }
    if (this.handleSpawnKey(e)) return true
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
        selectObjects(this.objects, [])
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
    this.refreshSelectionArea()
    this.refreshMaskState()
    return c
  }

  redo() {
    const c = this.history.redo()
    this.syncSelection()
    this.refreshSelectionArea()
    this.refreshMaskState()
    return c
  }

  /** Undoes or redoes until `position` steps of the history are done (the History window's click). */
  goToHistory(position: number) {
    if (!this.history.goTo(position)) return
    this.syncSelection()
    this.refreshSelectionArea()
    this.refreshMaskState()
  }

  /** Republishes the selected area, so the options bar re-reads what it holds (holes, for one). */
  private refreshSelectionArea() {
    if (editor.selection) editor.selection = { ...editor.selection }
  }

  private syncSelection() {
    if (!editor.selected && !editor.selectedIds.length) return
    selectObjects(this.objects, editor.selectedIds, editor.selected?.id)
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
    this.syncSelection()
    setStatus(`Removed ${dupes.length} duplicate ${dupes.length === 1 ? 'model' : 'models'}. Undo restores them.`)
  }

  /**
   * Noggit Red's Assist › Clean up, on the client tile under the camera target (#45), one undo step
   * each: the height to zero, the textures back to each chunk's base, the textures replaced by the
   * paint texture alone, each chunk's duplicate textures merged, every model removed, or the
   * duplicate models removed.
   */
  /**
   * The client tile under the camera target: its index in the map, its first vertex and a name for
   * the status bar (the client's tile numbers in a region), or null off the map.
   */
  tileUnderCamera(): { tx: number; tz: number; x0: number; z0: number; cells: number; name: string } | null {
    const t = this.terrain
    const target = this.controller.target
    const tiles = Math.max(1, Math.round(t.size / TILE_CELLS))
    const tx = Math.floor(target.x / (TILE_CELLS * t.cellSize))
    const tz = Math.floor(target.z / (TILE_CELLS * t.cellSize))
    if (tx < 0 || tz < 0 || tx >= tiles || tz >= tiles) return null
    const block = editor.regionBlock
    const name = block ? `tile ${block.x + tx}, ${block.y + tz}` : `tile ${tx}, ${tz}`
    return { tx, tz, x0: tx * TILE_CELLS, z0: tz * TILE_CELLS, cells: TILE_CELLS, name }
  }

  /** The lowest and highest ground on the tile under the camera, or on the whole map (Noggit Red's Auto Heights). */
  heightRange(scope: 'map' | 'tile'): [number, number] | null {
    const t = this.terrain
    const side = t.verts
    let x0 = 0, z0 = 0, x1 = side - 1, z1 = side - 1
    if (scope === 'tile') {
      const tile = this.tileUnderCamera()
      if (!tile) return null
      x0 = tile.x0
      z0 = tile.z0
      x1 = Math.min(side - 1, x0 + tile.cells)
      z1 = Math.min(side - 1, z0 + tile.cells)
    }
    let lo = Infinity, hi = -Infinity
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const h = t.heights[z * side + x]
        lo = Math.min(lo, h)
        hi = Math.max(hi, h)
      }
    }
    return [lo, hi]
  }

  cleanUpTile(what: 'height' | 'textures' | 'setBase' | 'textureDuplicates' | 'models' | 'duplicateModels' | 'shadows') {
    const t = this.terrain
    const tile = this.tileUnderCamera()
    if (!tile) {
      setStatus('The camera is not over the map.', 3000)
      return
    }
    const { tx, tz, name } = tile
    const x0 = tx * TILE_CELLS * t.cellSize, z0 = tz * TILE_CELLS * t.cellSize
    const x1 = x0 + TILE_CELLS * t.cellSize, z1 = z0 + TILE_CELLS * t.cellSize
    if (what === 'shadows') {
      // Noggit Red's Clear shadows (Assist › Clean up): the tile's baked shadows, all lit.
      const n = TILE_CELLS * SHADOW_PER_CELL
      this.clearShadowRect({ x0: tx * n, z0: tz * n, x1: (tx + 1) * n - 1, z1: (tz + 1) * n - 1 }, `on ${name}`)
      return
    }
    if (what === 'models' || what === 'duplicateModels') {
      const roots = [...this.objects.objects.values()].filter((o) => o.parent === undefined && o.x >= x0 && o.x < x1 && o.z >= z0 && o.z < z1)
      let gone: WorldObject[]
      if (what === 'models') {
        const ids = new Set<number>()
        for (const o of roots) {
          ids.add(o.id)
          for (const d of this.objects.descendantIds(o.id)) ids.add(d)
        }
        gone = [...ids].map((id) => this.objects.objects.get(id)!).filter(Boolean)
      } else {
        const seen = new Set<string>()
        gone = []
        for (const o of roots) {
          const key = [o.type, o.x, o.z, o.yOff, o.rotY, o.scale].map((v) => (typeof v === 'number' ? Math.round(v * 100) : v)).join('|')
          if (seen.has(key)) gone.push(o)
          else seen.add(key)
        }
      }
      if (!gone.length) {
        setStatus(`No ${what === 'models' ? '' : 'duplicate '}models on ${name}.`, 3000)
        return
      }
      const cmd = removeCommand(this.objects, gone)
      cmd.label = what === 'models' ? `Clear models on ${name}` : `Remove duplicate models on ${name}`
      cmd.redo()
      this.history.push(cmd)
      this.syncSelection()
      setStatus(`Removed ${gone.length} ${gone.length === 1 ? 'model' : 'models'} on ${name}. Undo restores them.`, 4000)
      return
    }
    if (what === 'height') {
      const r = { x0: tx * TILE_CELLS, z0: tz * TILE_CELLS, x1: Math.min(t.size, (tx + 1) * TILE_CELLS), z1: Math.min(t.size, (tz + 1) * TILE_CELLS) }
      const cs = t.cellSize
      const stroke = new TerrainStroke(t, `Clear height on ${name}`, { heights: true }, (q) => this.objects.markRegionDirty(q.x0 * cs, q.z0 * cs, q.x1 * cs, q.z1 * cs))
      stroke.reserveHeights(r)
      for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) t.heights[z * t.verts + x] = 0
      t.markDirty(r.x0, r.z0, r.x1, r.z1)
      stroke.touchHeights(r)
      this.objects.markRegionDirty(x0, z0, x1, z1)
      const cmd = stroke.finish()
      if (cmd) this.history.push(cmd)
      return
    }
    const side = t.paintChunksPerSide
    const chunks: number[] = []
    for (let cz = tz * TILE_PAINT_CHUNKS; cz < (tz + 1) * TILE_PAINT_CHUNKS && cz < side; cz++) {
      for (let cx = tx * TILE_PAINT_CHUNKS; cx < (tx + 1) * TILE_PAINT_CHUNKS && cx < side; cx++) chunks.push(cz * side + cx)
    }
    const per = t.splatRes / side
    const forTexels = (c: number, fn: (o: number) => void) => {
      const px = (c % side) * per, pz = Math.floor(c / side) * per
      for (let z = pz; z < pz + per; z++) for (let x = px; x < px + per; x++) fn((z * t.splatRes + x) * SLOTS)
    }
    if (what === 'textures') {
      this.editChunks(`Clear textures on ${name}`, chunks, (c) => forTexels(c, (o) => resetTexel(t.weights, o, 1)))
    } else if (what === 'setBase') {
      const tex = editor.paintLayer
      this.editChunks(`Clear textures and set base on ${name}`, chunks, (c) => {
        t.chunkSlots[c * SLOTS] = tex
        for (let k = 1; k < SLOTS; k++) t.chunkSlots[c * SLOTS + k] = NO_TEXTURE
        forTexels(c, (o) => {
          t.weights[o] = 255
          t.weights[o + 1] = t.weights[o + 2] = t.weights[o + 3] = 0
        })
      })
    } else {
      const dupes = chunks.filter((c) => {
        const s = t.chunkSlots.subarray(c * SLOTS, c * SLOTS + SLOTS)
        return s.some((tex, k) => tex !== NO_TEXTURE && s.indexOf(tex) !== k)
      })
      if (!dupes.length) {
        setStatus(`No duplicate textures on ${name}.`, 3000)
        return
      }
      let merged = 0
      this.editChunks(`Remove texture duplicates on ${name}`, dupes, (c) => (merged += mergeDuplicateSlots(side, t.splatRes, t.chunkSlots, t.weights, c)))
      setStatus(`Merged ${merged} duplicate texture layer${merged === 1 ? '' : 's'} on ${name}.`, 3000)
    }
  }

  /**
   * Deletes the selected objects as one undo step. Things attached to a deleted object stay where
   * they are, re-homed to its nearest surviving ancestor (or the ground).
   */
  deleteSelected() {
    const targets = selectedObjects(this.objects)
    if (!targets.length) return
    const objects = this.objects
    const gone = new Set(targets.map((t) => t.id))
    const kids = [...objects.objects.values()].filter((k) => k.parent !== undefined && gone.has(k.parent) && !gone.has(k.id))
    const kidsBefore = kids.map((k) => ({ ...k }))
    for (const k of kids) {
      let p = objects.objects.get(k.parent!)
      while (p && gone.has(p.id)) p = p.parent !== undefined ? objects.objects.get(p.parent) : undefined
      objects.place(k, p ? p.id : null, objects.worldPlacement(k))
    }
    const kidsAfter = kids.map((k) => ({ ...k }))
    const saved = targets.map((t) => ({ ...t }))
    for (const t of targets) objects.remove(t.id)
    const restore = (states: typeof kidsBefore) =>
      states.forEach((st) => {
        const k = objects.objects.get(st.id)
        if (!k) return
        delete k.parent
        Object.assign(k, st)
        objects.touch(k.id)
      })
    this.history.push({
      label: saved.length === 1 ? 'Delete' : `Delete ${saved.length} objects`,
      undo: () => {
        for (const o of saved) objects.add({ ...o })
        restore(kidsBefore)
      },
      redo: () => {
        restore(kidsAfter)
        for (const o of saved) objects.remove(o.id)
      },
    })
    selectObjects(objects, [])
  }

  /**
   * Shows doodad set `set` on the selected WMOs besides their global set 0, as a placement's MODF doodad
   * set does in the game; the export writes it. One undo step.
   */
  setDoodadSet(set: number) {
    const changes: Array<{ id: number; from: string; to: string }> = []
    for (const id of editor.selectedIds) {
      const o = this.objects.objects.get(id)
      if (!o || !o.type.startsWith('wmo:')) continue
      const to = withDoodadSet(o.type, set)
      if (to !== o.type) changes.push({ id, from: o.type, to })
    }
    if (!changes.length) return
    this.retype(changes, changes.length === 1 ? 'Doodad set' : `Doodad set of ${changes.length} buildings`)
  }

  /** Changes objects' types (their model, or a WMO's doodad set) as one undo step. */
  private retype(changes: Array<{ id: number; from: string; to: string }>, label: string) {
    const objects = this.objects
    const refresh = () => {
      if (editor.selected) {
        const p = objects.objects.get(editor.selected.id)
        if (p) editor.selected = { ...p }
      }
    }
    const apply = (to: boolean) => {
      for (const c of changes) objects.setType(c.id, to ? c.to : c.from)
      refresh()
    }
    apply(true)
    this.history.push({ label, undo: () => apply(false), redo: () => apply(true) })
  }

  /**
   * Puts the selected models into one new selection group (Noggit Red's Group Selected Objects), taking
   * them out of the groups they were in, so clicking any of them selects them all. One undo step.
   */
  groupSelected() {
    const ids = editor.selectedIds.filter((id) => this.objects.objects.has(id))
    if (ids.length < 2) {
      setStatus('Select two or more models to group them.')
      return
    }
    const g = this.objects.newGroup()
    this.setGroups(ids.map((id) => ({ id, from: this.objects.objects.get(id)!.group, to: g })), `Group ${ids.length} models`)
    setStatus(`Grouped ${ids.length} models: a click on one selects them all. Ctrl+Shift+G ungroups them.`, 5000)
  }

  /** Breaks up every selection group a selected model is in (Noggit Red's Ungroup). One undo step. */
  ungroupSelected() {
    const groups = new Set<number>()
    for (const id of editor.selectedIds) {
      const g = this.objects.objects.get(id)?.group
      if (g) groups.add(g)
    }
    if (!groups.size) {
      setStatus('The selected models are in no group.')
      return
    }
    const changes: Array<{ id: number; from: number | undefined; to: number | undefined }> = []
    for (const o of this.objects.objects.values()) if (o.group && groups.has(o.group)) changes.push({ id: o.id, from: o.group, to: undefined })
    this.setGroups(changes, groups.size === 1 ? 'Ungroup models' : `Ungroup ${groups.size} groups`)
    setStatus(`Ungrouped ${changes.length} models.`, 4000)
  }

  /** Sets objects' selection groups as one undo step; `to` undefined takes an object out of its group. */
  private setGroups(changes: Array<{ id: number; from: number | undefined; to: number | undefined }>, label: string) {
    const objects = this.objects
    const apply = (to: boolean) => {
      for (const c of changes) {
        const o = objects.objects.get(c.id)
        if (!o) continue
        const g = to ? c.to : c.from
        if (g) o.group = g
        else delete o.group
      }
    }
    apply(true)
    this.history.push({ label, undo: () => apply(false), redo: () => apply(true) })
  }

  /**
   * Replaces each selected model with the one copied (Ctrl+C on a single model), keeping its place,
   * turn, tilt, scale and attachments, as Noggit Red's Replace Models (By Clipboard). A doodad is only
   * replaced by a doodad and a building by a building, as Noggit Red's menu says, since a 1.12 building
   * has no scale. One undo step.
   */
  replaceSelectedWithCopied() {
    const clip = this.lastCopied === 'objects' ? this.objectClip : null
    if (!clip || clip.objects.length !== 1) {
      setStatus('Copy one model first (select it, Ctrl+C), then select the models to replace with it.', 6000)
      return
    }
    const type = clip.objects[0].type
    const kind = (t: string) => t.slice(0, t.indexOf(':'))
    const objects = this.objects
    const changed: Array<{ id: number; from: string; to: string }> = []
    let other = 0
    for (const id of editor.selectedIds) {
      const o = objects.objects.get(id)
      if (!o || o.type === type) continue
      if (kind(o.type) !== kind(type)) {
        other++
        continue
      }
      changed.push({ id, from: o.type, to: type })
    }
    const skipped = other ? ` ${other} ${kind(type) === 'wmo' ? 'doodads' : 'buildings'} left as they are (a doodad replaces doodads, a building buildings).` : ''
    if (!changed.length) {
      setStatus(editor.selectedIds.length ? `Nothing replaced.${skipped}` : 'Select the models to replace first.', 6000)
      return
    }
    this.retype(changed, changed.length === 1 ? 'Replace model' : `Replace ${changed.length} models`)
    setStatus(`Replaced ${changed.length} ${changed.length === 1 ? 'model' : 'models'} with ${displayName(type)}.${skipped}`, 6000)
  }

  /**
   * Stands the selected models upright again, as noggit's Reset rotation (Ctrl+R,
   * `moveable_object_group::reset_xz_rotation`): the tilt both ways goes, and the heading stays. One
   * undo step; nothing happens when every selected model is already upright.
   */
  resetRotation() {
    const before: WorldObject[] = []
    const after: WorldObject[] = []
    for (const id of editor.selectedIds) {
      const o = this.objects.objects.get(id)
      if (!o || (!o.tiltX && !o.tiltZ)) continue
      before.push({ ...o })
      delete o.tiltX
      delete o.tiltZ
      this.objects.touch(id)
      after.push({ ...o })
    }
    if (!after.length) {
      setStatus(editor.selectedIds.length ? 'The selected models already stand upright.' : 'Select models to reset their rotation.')
      return
    }
    if (editor.selected) {
      const p = this.objects.objects.get(editor.selected.id)
      if (p) editor.selected = { ...p }
    }
    this.history.push(groupTransformCommand(this.objects, before, after, after.length === 1 ? 'Reset rotation' : `Reset rotation of ${after.length} objects`))
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

  /**
   * File › Check Map (#176): runs the map checks (lib/check) over the open map, with what runs now in
   * the status bar. `unchecked` counts the models whose mesh hadn't loaded, which the height checks skip.
   */
  async checkMap(): Promise<{ findings: Finding[]; unchecked: number }> {
    let knownTexture: ((p: string) => boolean) | null = null
    let knownArea: ((id: number) => boolean) | null = null
    // Only the desktop app reads the client (`window.go` is its bindings).
    if ('go' in window) {
      const [tex, areas] = await Promise.all([listAssets('tileset').catch(() => [] as string[]), loadAreas()])
      if (tex.length) {
        const set = new Set(tex.map((p) => p.toLowerCase()))
        knownTexture = (p) => set.has(p.toLowerCase())
      }
      if (areas.length) {
        const ids = new Set(areas.map((a) => a.id))
        knownArea = (id) => ids.has(id)
      }
    }
    const r = await runMapChecks({
      terrain: this.terrain,
      objects: this.objects,
      spawns: this.doc.spawnLayer,
      liquids: this.doc.liquids,
      palette: editor.palette,
      sea: editor.waterEnabled ? editor.waterLevel : null,
      maxSlope: this.prefs?.climbAngle ?? 50,
      knownTexture,
      knownArea,
      progress: (what) => setStatus(`Checking the map: ${what}…`, 0),
    })
    const n = r.findings.length
    setStatus(n ? `The check found ${n} ${n === 1 ? 'thing' : 'things'} to look at.` : 'The check found nothing wrong.', 4000)
    return r
  }

  /** Moves the camera to a Check Map finding and selects what it is about. */
  focusFinding(f: Finding) {
    if (!Number.isNaN(f.x)) this.controller.focus(f.x, f.z, 40)
    const tg = f.target
    if (tg.kind === 'models') {
      const ids = tg.ids.filter((id) => this.objects.objects.has(id))
      editor.tool = 'select'
      selectObjects(this.objects, ids)
    } else if (tg.kind === 'spawn') {
      const s = this.doc.spawnLayer.get(tg.key)
      if (!s) return
      editor.tool = 'select'
      selectObjects(this.objects, [])
      selectSpawn(s)
    }
  }

  /** Applies a Check Map finding's fix as one undo step: deletes the models, puts them on the ground, or crops the chunk's water. */
  fixFinding(f: Finding) {
    const tg = f.target
    if ((f.fix === 'deleteModels' || f.fix === 'groundModels') && tg.kind === 'models') {
      const ids = tg.ids.filter((id) => this.objects.objects.has(id))
      if (!ids.length) return
      selectObjects(this.objects, ids)
      if (f.fix === 'deleteModels') this.deleteSelected()
      else this.snapSelectedToGround()
    } else if (f.fix === 'cropWater' && tg.kind === 'chunk') {
      const side = this.doc.liquids.side
      const cx = tg.chunk % side
      const cz = Math.floor(tg.chunk / side)
      const stroke = new LiquidStroke(this.doc.liquids, 'Crop water')
      const r = { x0: cx * CHUNK_CELLS, z0: cz * CHUNK_CELLS, x1: cx * CHUNK_CELLS + CHUNK_CELLS - 1, z1: cz * CHUNK_CELLS + CHUNK_CELLS - 1 }
      cropLiquids(this.doc.liquids, this.terrain, r, stroke.reserve)
      const cmd = stroke.finish()
      if (cmd) this.history.push(cmd)
      setStatus(cmd ? 'Cropped the water under the ground in that chunk.' : 'There was no water under the ground to crop there.', 3000)
    }
  }

  /** Moves the camera to the selection: its primary object, or the middle of the selected objects. */
  focusSelected() {
    const sel = selectedObjects(this.objects)
    if (!sel.length) return
    if (editor.selected) {
      const p = this.objects.worldPosition(sel[0], this.tmpV)
      this.controller.focus(p.x, p.z, 30)
      return
    }
    let x = 0, z = 0
    for (const o of sel) {
      const p = this.objects.worldPosition(o, this.tmpV)
      x += p.x
      z += p.z
    }
    this.controller.focus(x / sel.length, z / sel.length, 30 + sel.length * 2)
  }

  /** Share of the painted map each palette entry takes (sampled, 0..1). */
  layerCoverage(): number[] {
    const t = this.terrain
    return paletteCoverage(t.weights, t.chunkSlots, t.splatRes, t.paintChunksPerSide, editor.palette.length)
  }

  /**
   * Tracks the paint chunk under the cursor for the Layers panel and tints it. `editor.hoverChunk` only
   * changes when the cursor crosses into another chunk, so this writes no reactive state per frame.
   */
  private updateHoverChunk(rect: THREE.Vector4) {
    const t = this.terrain
    const side = t.paintChunksPerSide
    const size = CHUNK_CELLS * t.cellSize
    if (this.hit && this.pointerInside) {
      const cx = Math.min(side - 1, Math.max(0, Math.floor(this.hit.x / size)))
      const cz = Math.min(side - 1, Math.max(0, Math.floor(this.hit.z / size)))
      const c = cz * side + cx
      if (c !== editor.hoverChunk) editor.hoverChunk = c
    }
    const c = editor.hoverChunk
    if (c < 0 || c >= side * side || !editor.chunkLines) rect.set(0, 0, 0, 0)
    else rect.set((c % side) * size, Math.floor(c / side) * size, ((c % side) + 1) * size, (Math.floor(c / side) + 1) * size)
  }

  /** The Detail info readout for the ground under the cursor (noggit's detail window), or null off the map. */
  /** The zone of the chunk under the cursor, named with its ID, or '' for none or no ground. */
  private hoverArea(): string {
    const hit = this.hit
    if (!hit || !this.pointerInside) return ''
    const id = this.areaAt(hit.x, hit.z)
    return id ? `${areaName(id)} (${id})` : ''
  }

  /** The AreaTable.dbc ID of the active map's chunk at (x, z), or 0 for none or off the map. */
  areaAt(x: number, z: number): number {
    const t = this.terrain
    if (!t.contains(x, z)) return 0
    const step = CHUNK_CELLS * t.cellSize
    const side = t.paintChunksPerSide
    const gx = Math.min(side - 1, Math.floor(x / step))
    const gz = Math.min(side - 1, Math.floor(z / step))
    return t.areaIds[gz * side + gx]
  }

  private detailInfo(): DetailInfo | null {
    const hit = this.hit
    const t = this.terrain
    if (!hit || !this.pointerInside || !t.contains(hit.x, hit.z)) return null
    const cx = Math.min(t.size - 1, Math.max(0, Math.floor(hit.x / t.cellSize)))
    const cz = Math.min(t.size - 1, Math.max(0, Math.floor(hit.z / t.cellSize)))
    const gx = Math.floor(cx / CHUNK_CELLS)
    const gz = Math.floor(cz / CHUNK_CELLS)
    const side = t.paintChunksPerSide
    const chunk = gz * side + gx
    const block = editor.regionBlock
    // The share of each slot over the cell's texels.
    const sums = [0, 0, 0, 0]
    for (let v = 0; v < SPLAT_PER_CELL; v++) {
      let i = ((cz * SPLAT_PER_CELL + v) * t.splatRes + cx * SPLAT_PER_CELL) * SLOTS
      for (let u = 0; u < SPLAT_PER_CELL; u++, i += SLOTS) for (let k = 0; k < SLOTS; k++) sums[k] += t.weights[i + k]
    }
    const tables = groundEffectTables()
    const textures: DetailInfo['textures'] = []
    for (let k = 0; k < SLOTS; k++) {
      const idx = t.chunkSlots[chunk * SLOTS + k]
      if (idx === NO_TEXTURE) continue
      const path = editor.palette[idx] ?? ''
      const name = path.startsWith('#') ? path : path.slice(path.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
      textures.push({ name, weight: Math.round((sums[k] / (SPLAT_PER_CELL * SPLAT_PER_CELL * 255)) * 100), effect: effectFor(path, editor.textureEffects, tables) })
    }
    const lc = (cz % CHUNK_CELLS) * CHUNK_CELLS + (cx % CHUNK_CELLS)
    const liquids = this.doc.liquids
      .layers(chunk)
      .filter((l) => l.cells[lc])
      .map((l) => `${liquidType(l.id).name} at ${l.heights[(cz % CHUNK_CELLS) * (CHUNK_CELLS + 1) + (cx % CHUNK_CELLS)].toFixed(1)}`)
    const chunkSize = CHUNK_CELLS * t.cellSize
    let models = 0
    for (const o of this.objects.objects.values()) {
      if (o.parent === undefined && Math.floor(o.x / chunkSize) === gx && Math.floor(o.z / chunkSize) === gz) models++
    }
    return {
      tile: block ? `${block.x + Math.floor(gx / TILE_PAINT_CHUNKS)}, ${block.y + Math.floor(gz / TILE_PAINT_CHUNKS)}` : '—',
      chunk: `${gx % TILE_PAINT_CHUNKS}, ${gz % TILE_PAINT_CHUNKS}`,
      cell: `${cx}, ${cz}`,
      height: t.heightAt(hit.x, hit.z),
      slope: groundSlopeDeg((px, pz) => t.heightAt(px, pz), hit.x, hit.z, t.cellSize),
      hole: t.isHole(hit.x, hit.z),
      noTufts: t.noEffect[cz * t.size + cx] !== 0,
      impassable: (t.chunkFlags[chunk] & CHUNK_IMPASSABLE) !== 0,
      area: t.areaIds[chunk] ? `${areaName(t.areaIds[chunk])} (${t.areaIds[chunk]})` : '',
      room: this.roomName(),
      textures,
      liquids,
      models,
    }
  }

  /**
   * Runs the portal flood of the WMO the camera is in and hands the gate its groups, and fades the
   * room's fog in or out over the scene's.
   */
  private updateRoomGate(dt: number) {
    const r = this.rooms.current
    beginRoomGates()
    if (!this.topDown) {
      this.camera.updateMatrixWorld()
      this.viewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
      this.viewFrustum.setFromProjectionMatrix(this.viewProj)
      if (r) {
        this.roomClip.copy(this.viewProj).multiply(r.matrix)
        const pvs = this.roomFlood.run(r.nav, r.seeds, r.eye, this.roomClip)
        addRoomGate(r.origin, pvs.visible, pvs.fog)
        this.roomAdmit.set(r.nav, r.matrix, pvs.visible, this.roomGround)
      }
      // The other buildings in view are flooded from outside (#116): an interior shows only where a
      // doorway does.
      for (const w of this.rooms.outside(this.objects, this.viewFrustum, this.camera.position, ROOM_MAX_GATED - 1)) {
        this.roomEyeLocal.copy(this.camera.position).applyMatrix4(this.roomInv.copy(w.matrix).invert())
        toModel(this.roomEyeLocal, this.roomEyeModel)
        this.roomClip.copy(this.viewProj).multiply(w.matrix)
        const pvs = this.outsideFlood.run(w.nav, NO_SEEDS, this.roomEyeModel, this.roomClip)
        addRoomGate(w.origin, pvs.visible, pvs.fog)
      }
    }
    endRoomGates()
    const fog = this.scene.fog as THREE.Fog | null
    if (!fog) return
    fog.color.getRGB(this.roomSceneFog, THREE.SRGBColorSpace)
    const rgb = this.roomSceneRgb
    rgb[0] = this.roomSceneFog.r
    rgb[1] = this.roomSceneFog.g
    rgb[2] = this.roomSceneFog.b
    this.roomFog.update(r?.fog ?? null, rgb, fog.near, fog.far, this.persp.far, dt)
    setRoomFog(this.roomFog.color, this.roomFog.near, this.roomFog.far)
  }

  /** Hands Client Lighting's terrain the pooled M2 lights it sums per vertex (#117). */
  private updateClientPoints() {
    const u = this.terrain.material.uniforms
    const fx = this.effects
    u.clientPointCount.value = fx.clientCount
    const pos = u.clientPointPos.value as THREE.Vector3[]
    const col = u.clientPointColor.value as THREE.Vector3[]
    for (let i = 0; i < fx.clientCount; i++) {
      pos[i].fromArray(fx.clientPos, i * 3)
      col[i].fromArray(fx.clientColor, i * 3)
    }
  }

  /** The WMO room the camera is in, named for the detail readout, or '' outside. */
  private roomName(): string {
    const r = this.rooms.current
    if (!r) return ''
    const name = (g: number) => r.nav.groups[g]?.name || `group ${g}`
    const file = r.path.slice(r.path.lastIndexOf('\\') + 1)
    return `${file} › ${name(r.group)} (${r.group})${r.across !== null ? `, across ${name(r.across)} (${r.across})` : ''}`
  }

  /** The paint chunks the selected area touches, or none without a selection. */
  selectedChunks(): number[] {
    const s = editor.selection
    if (!s || s.x1 <= s.x0 || s.z1 <= s.z0) return []
    const side = this.terrain.paintChunksPerSide
    const cx0 = Math.max(0, Math.floor(s.x0 / CHUNK_CELLS))
    const cz0 = Math.max(0, Math.floor(s.z0 / CHUNK_CELLS))
    const cx1 = Math.min(side - 1, Math.floor((s.x1 - 1) / CHUNK_CELLS))
    const cz1 = Math.min(side - 1, Math.floor((s.z1 - 1) / CHUNK_CELLS))
    const out: number[] = []
    const shape = areaShape(this.terrain, this.terrain.size)
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) if (!shape || chunkInShape(shape, this.terrain.size, cx, cz)) out.push(cz * side + cx)
    }
    return out
  }

  /** The textures of `chunks` together, each with how many of the chunks hold it, most first. */
  chunksContents(chunks: number[]): Array<{ tex: number; chunks: number }> {
    const counts = new Map<number, number>()
    for (const c of chunks) for (const t of this.chunkContents(c)) counts.set(t.tex, (counts.get(t.tex) ?? 0) + 1)
    return [...counts].map(([tex, n]) => ({ tex, chunks: n })).sort((a, b) => b.chunks - a.chunks || a.tex - b.tex)
  }

  /** Edits the splat of each chunk in `chunks` through `edit(c)`, as one undo step named `label`. */
  private editChunks(label: string, chunks: number[], edit: (c: number) => void) {
    const t = this.terrain
    const side = t.paintChunksPerSide
    const per = t.splatRes / side
    const stroke = new TerrainStroke(t, label, { splat: true })
    for (const c of chunks) {
      if (c < 0 || c >= side * side) continue
      const x0 = (c % side) * per
      const z0 = Math.floor(c / side) * per
      const rect = { x0, z0, x1: x0 + per - 1, z1: z0 + per - 1 }
      stroke.reserveSplat(rect)
      edit(c)
      stroke.touchSplat(rect)
      t.markSplatDirty(rect)
    }
    const cmd = stroke.finish()
    if (cmd) this.history.push(cmd)
  }

  /** Replaces palette texture `tex` with `path` in `chunks` only (undoable). */
  replaceTextureInChunks(chunks: number[], tex: number, path: string) {
    const t = this.terrain
    const index = this.useTexture(path)
    if (index < 0) return
    this.editChunks(chunks.length === 1 ? 'Replace texture here' : `Replace texture in ${chunks.length} chunks`, chunks, (c) => {
      const slot = findSlot(t.chunkSlots, c, tex)
      if (slot >= 0) replaceInChunk(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, c, slot, index)
    })
  }

  /**
   * Frees the texture layers whose weight is 0 everywhere in their chunk (Noggit Red's "remove unused
   * textures"), in the selected area's chunks or across the map, as one undo step. Each chunk keeps
   * its look; it only gets its free slots back for other textures.
   */
  removeEmptyLayers() {
    const t = this.terrain
    const side = t.paintChunksPerSide
    const scope = editor.selection ? this.selectedChunks() : Array.from({ length: side * side }, (_, c) => c)
    const chunks = scope.filter((c) => hasEmptySlot(side, t.splatRes, t.chunkSlots, t.weights, c))
    if (!chunks.length) {
      setStatus(`No empty texture layers ${editor.selection ? 'in the selected area' : 'on the map'}.`, 3000)
      return
    }
    let layers = 0
    this.editChunks(`Remove empty layers in ${chunks.length} chunk${chunks.length === 1 ? '' : 's'}`, chunks, (c) => {
      for (let k = 0; k < SLOTS; k++) if (t.chunkSlots[c * SLOTS + k] !== NO_TEXTURE) layers++
      compactChunk(side, t.splatRes, t.chunkSlots, t.weights, c)
      for (let k = 0; k < SLOTS; k++) if (t.chunkSlots[c * SLOTS + k] !== NO_TEXTURE) layers--
    })
    setStatus(`Removed ${layers} empty texture layer${layers === 1 ? '' : 's'} in ${chunks.length} chunk${chunks.length === 1 ? '' : 's'}.`, 4000)
  }

  /**
   * Lays an alphamap (splatRes squared values, 0 to 1) into palette texture `tex` over the whole map as
   * one undo step (terrain/alphamap.ts). Returns how many chunks refused it for want of a free slot.
   */
  importAlphamap(tex: number, values: Float32Array): number {
    const t = this.terrain
    const side = t.paintChunksPerSide
    let refused = 0
    const all = Array.from({ length: side * side }, (_, c) => c)
    this.editChunks(`Import alphamap of ${editor.palette[tex] ?? 'a texture'}`, all, (c) => {
      if (layAlphamapChunk(t, c, tex, values)) refused++
    })
    return refused
  }

  /** Palette texture `tex`'s weight at every splat texel, 0 to 1 (for the alphamap export). */
  alphamapOf(tex: number): Float32Array {
    return textureWeights(this.terrain, tex)
  }

  /** Removes palette texture `tex` from `chunks`: its layer there is empty afterwards (undoable). */
  deleteTextureInChunks(chunks: number[], tex: number) {
    const t = this.terrain
    this.editChunks(chunks.length === 1 ? 'Delete texture here' : `Delete texture in ${chunks.length} chunks`, chunks, (c) => {
      const slot = findSlot(t.chunkSlots, c, tex)
      if (slot >= 0) removeSlot(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, c, slot)
    })
  }

  /** Empties every layer of `chunks`, so they have no textures at all (undoable). */
  clearChunks(chunks: number[]) {
    const t = this.terrain
    this.editChunks(chunks.length === 1 ? 'Delete all textures here' : `Delete all textures in ${chunks.length} chunks`, chunks, (c) => {
      for (let k = SLOTS - 1; k >= 0; k--) removeSlot(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, c, k)
    })
  }

  /** The textures chunk c uses, with their shares (see chunkTextures). */
  chunkContents(c: number) {
    const t = this.terrain
    return chunkTextures(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, c, editor.palette.length)
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
    stroke.reserveSplat({ x0: 0, z0: 0, x1: t.splatRes - 1, z1: t.splatRes - 1 })
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
    stroke.reserveSplat({ x0: 0, z0: 0, x1: t.splatRes - 1, z1: t.splatRes - 1 })
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

/** Sets (`value` 1) or clears the holes of every 2x2 block of `r` (inclusive) that has a cell of `shape`. Returns the cells changed. */
function fillShapeHoles(holes: Uint8Array, size: number, shape: Uint8Array, r: { x0: number; z0: number; x1: number; z1: number }, value: 0 | 1): number {
  let n = 0
  for (let bz = r.z0; bz <= r.z1; bz += 2) {
    for (let bx = r.x0; bx <= r.x1; bx += 2) {
      let any = false
      for (let z = bz; z < Math.min(size, bz + 2) && !any; z++) for (let x = bx; x < Math.min(size, bx + 2); x++) if (shape[z * size + x] === INSIDE) any = true
      if (!any) continue
      for (let z = bz; z < Math.min(size, bz + 2); z++) {
        for (let x = bx; x < Math.min(size, bx + 2); x++) {
          if (holes[z * size + x] === value) continue
          holes[z * size + x] = value
          n++
        }
      }
    }
  }
  return n
}

/** Whether paint chunk (cx, cz) has a cell of `shape`. */
function chunkInShape(shape: Uint8Array, size: number, cx: number, cz: number): boolean {
  for (let z = cz * CHUNK_CELLS; z < Math.min(size, (cz + 1) * CHUNK_CELLS); z++) {
    for (let x = cx * CHUNK_CELLS; x < Math.min(size, (cx + 1) * CHUNK_CELLS); x++) if (shape[z * size + x]) return true
  }
  return false
}

/** A copy of the shadow texels of the inclusive rect `r`, row by row. */
function shadowTexels(data: Uint8Array, side: number, r: { x0: number; z0: number; x1: number; z1: number }): Uint8Array {
  const w = r.x1 - r.x0 + 1
  const out = new Uint8Array(w * (r.z1 - r.z0 + 1))
  for (let z = r.z0; z <= r.z1; z++) out.set(data.subarray(z * side + r.x0, z * side + r.x1 + 1), (z - r.z0) * w)
  return out
}

/**
 * Puts back, from `kept` (shadowTexels' copy of `r`), every texel of `r` outside the cells of `shape`
 * (`perCell` texels a cell side). Returns how many texels inside the shape differ from `kept`.
 */
function restoreOutsideShape(data: Uint8Array, side: number, r: { x0: number; z0: number; x1: number; z1: number }, kept: Uint8Array, shape: Uint8Array, size: number, perCell: number): number {
  const w = r.x1 - r.x0 + 1
  let changed = 0
  for (let z = r.z0; z <= r.z1; z++) {
    for (let x = r.x0; x <= r.x1; x++) {
      const before = kept[(z - r.z0) * w + (x - r.x0)]
      const i = z * side + x
      if (!shape[Math.floor(z / perCell) * size + Math.floor(x / perCell)]) data[i] = before
      else if (data[i] !== before) changed++
    }
  }
  return changed
}
