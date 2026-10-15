import type { SessionTab } from '../io/session'
import { LAYERS } from '../terrain/layers'
import type { FalloffCurve } from '../tools/brush'
import type { DoodadBrush } from '../tools/doodadBrush'
import { noRoles, type TextureRoles } from '../terrain/roles'
import type { TextureEffects } from '../world/groundEffects'
import type { Bookmark } from '../engine/MapDocument'
import type { vmangos } from '../../../wailsjs/go/models'

// Reactive editor state (Svelte 5 runes). The engine reads these values each
// frame; it never stores per-frame data here (that would trigger re-renders).

export type ToolId = 'select' | 'sculpt' | 'paint' | 'road' | 'water' | 'place' | 'clear' | 'doodad' | 'mapdata'
/** What the Map data tool paints into the chunk headers: the zone (an AreaTable.dbc ID). */
export type MapDataMode = 'area'
export type ClearMode = 'models' | 'textures' | 'heights' | 'liquids' | 'holes'
export type SculptMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise' | 'mountain' | 'crevice' | 'vertex' | 'hole'
/** Flatten target: the height under the first click, or the average height under the brush. */
export type FlattenTarget = 'origin' | 'average'
/** Flatten direction: move ground both ways, or only up or only down toward the target. */
export type FlattenDir = 'both' | 'raise' | 'lower'
/** Sculpt edit limit: change ground everywhere, or only the ground above or below the cursor's height. */
export type SculptLimit = 'none' | 'above' | 'below'
/** What the Sculpt tool paints while it shapes the ground: nothing, one texture, or the rock and dirt roles by slope. */
export type SculptPaint = 'off' | 'texture' | 'slope'
/** Water tool: paint liquids (noggit's water brush), or shape the ground around the sea level. */
export type WaterMode = 'paint' | 'dig' | 'shore'
/** The depth factor a water stroke uses: by the liquid, a river's, an ocean's, or `customOpacity`. */
export type WaterOpacity = 'auto' | 'river' | 'ocean' | 'custom'

export interface SelectedInfo {
  id: number
  type: string
  parent?: number
  x: number
  z: number
  yOff: number
  rotY: number
  tiltX?: number
  tiltZ?: number
  scale: number
}

/** Largest brush radius in world units: wide enough for a mountain or a lake in one stroke. */
export const MAX_BRUSH_RADIUS = 200

export const editor = $state({
  tool: 'sculpt' as ToolId,
  brush: {
    radius: 10,
    strength: 0.5,
    falloff: 0.6,
    curve: 'smooth' as FalloffCurve,
    shape: 'circle' as 'circle' | 'square',
    snap: true,
  },
  sculptMode: 'raise' as SculptMode,
  /** Hole mode fills (restores) the triangle under the cursor instead of cutting it. Shift inverts it for a stroke. */
  holeFill: false,
  flattenTarget: 'origin' as FlattenTarget,
  flattenDir: 'both' as FlattenDir,
  /**
   * Flatten's angled mode (noggit3's): instead of one height, the brush levels the ground to a plane
   * through the stroke's start that rises at `angle` degrees toward `orientation` degrees (0 is +x,
   * 90 is +z).
   */
  flattenAngled: { on: false, angle: 20, orientation: 0 },
  /**
   * Crevice digs the brush's solid centre into a trench and piles the ground onto both sides, in the
   * falloff band. `ridge` scales the pile: 1 keeps the dug volume, 0 only digs.
   */
  crevice: { ridge: 1 },
  /** Mountain: how much of the peak its ridges carve away (0 a smooth hill, 1 all ridges). */
  mountain: { ridges: 0.7 },
  sculptLimit: 'none' as SculptLimit,
  /**
   * Sculpting also paints under the brush: 'texture' paints `sculptPaintLayer` (a palette index, per
   * map); 'slope' paints the map's rock role on the steep ground and its dirt role on the moderate
   * slopes below it, so a raised hill comes up as rock rimmed with dirt, the way Blizzard's zones are
   * painted. 'off' keeps the paint.
   */
  sculptPaint: 'off' as SculptPaint,
  sculptPaintLayer: 0,
  /** By-slope painting: the slope in degrees from which the ground is rock, and from which it is dirt. */
  slopePaint: { rockDeg: 40, dirtDeg: 22 },
  /** The map's texture roles (terrain/roles.ts): the palette entries that are its rock and dirt. */
  roles: noRoles() as TextureRoles,
  /** The map's own ground effect per texture path (world/groundEffects.ts), over what the client's tiles give. */
  textureEffects: {} as TextureEffects,
  /**
   * Sculpt's Vertex mode lays the selected vertices onto a plane through the selection centre or the
   * cursor, rising at vertexAngle degrees (-89 to 89) toward vertexDir degrees (0 is +x, 90 is +z).
   */
  vertexRef: 'center' as 'center' | 'cursor',
  vertexAngle: 0,
  vertexDir: 0,
  paintLayer: 0,
  /**
   * Paint tool: paint textures, swap the texture under the stroke's start for the active one, or paint
   * the mask that texture fills apply to.
   */
  paintMode: 'texture' as 'texture' | 'swap' | 'mask',
  maskErase: false,
  /** Paint mode sprays random dabs over the brush instead of painting it solid (T toggles). */
  paintSpray: false,
  /** Spray: dab Size (1 to 40), Pressure as the dab density (0 to 10), and Inner radius, which also paints the brush's solid centre. */
  spray: { size: 1, pressure: 2, inner: false },
  roadFlatten: true,
  waterMode: 'paint' as WaterMode,
  /**
   * The water brush, after noggit's Water tool. LMB adds `liquid` (a LiquidType.dbc ID), Ctrl+LMB
   * removes liquid. With `lock`, the surface is at `lockPos` (Alt+click sets it), else at the cursor;
   * angled mode tilts it by `angle` degrees toward `orientation` degrees (0 is +x). The overrides let a
   * stroke reset the height of water already there and replace other liquids. `onLiquids` makes the
   * cursor stop on liquid surfaces.
   */
  water: {
    liquid: 1,
    lock: true,
    lockPos: { x: 0, y: 0, z: 0 },
    angled: false,
    angle: 10,
    orientation: 0,
    overrideHeight: true,
    overrideId: true,
    opacity: 'auto' as WaterOpacity,
    customOpacity: 0.0337,
    onLiquids: true,
  },
  /** The sea: ocean at this level wherever the ground lies below it. */
  waterLevel: 0,
  waterEnabled: true,
  /** Selected model type to place ("m2:<path>" / "wmo:<path>"), or ''. */
  prefab: '',
  placeRandomRot: true,
  placeRandomScale: true,
  /** Placed models tilt a little at random (up to 8 degrees each way) when on. */
  placeRandomTilt: false,
  placeScatter: false,
  /**
   * Spinning two or more selected models (R, Alt+arrows, the gizmo ring) turns them about the mean of
   * their positions, so the group keeps its shape (noggit's "Rotate around pivot point"); off, each
   * turns about its own origin. A single model always turns about itself.
   */
  rotatePivot: true,
  /**
   * noggit's two mouse-move checkboxes. A single dragged model follows the cursor's ground point (on,
   * the default), or moves across a level plane at its own height (off). A dragged group is set on the
   * ground where it lands (on), or keeps every model's height (off, the default).
   */
  moveFollowCursor: true,
  moveSnapGroup: false,
  /** Dragging a model along the ground tilts it to the ground's slope; smooth blends the slope over a cell each way. */
  followGround: false,
  followGroundSmooth: true,
  /** Extra height above the surface for new placements (PgUp / PgDn in the Place tool). */
  placeHeight: 0,
  /** World x/z offset of new placements from the cursor (the arrow keys in the Place tool, camera-relative). */
  placeOffset: { x: 0, z: 0 },
  /**
   * The Doodad brush tool: each model turned at random, no placements on ground under the sea, none on
   * ground steeper than `maxSlope` degrees (90 allows any), and placements onto props (attached, as
   * the Place tool does) when `onProps` is on. The brushes themselves are `prefs.doodadBrushes`.
   */
  doodad: { randomRot: true, avoidWater: true, maxSlope: 90, onProps: false },
  /** The primary selected object: the one the gizmo and the Properties panel work on. */
  selected: null as SelectedInfo | null,
  /** Every selected object (see lib/state/selection.ts). The primary is one of them when there is one. */
  selectedIds: [] as number[],
  /** The selected area in cells (vertex corners), or null. The Select tool's drag on the ground makes it. */
  selection: null as { x0: number; z0: number; x1: number; z1: number } | null,
  paste: { terrain: true, textures: true, objects: true, blend: 2, heightOffset: 0 },
  grid: false,
  /** Draws the 8x8-cell paint chunk edges, where the 1.12 four-texture limit applies. */
  chunkLines: false,
  /** The paint chunk under the cursor (index into the chunk grid), or -1. The Layers panel shows its textures. */
  hoverChunk: -1,
  autoCliff: true,
  /** The map's texture palette: a WoW tileset path, or a '#rrggbb' colour, per index. */
  palette: LAYERS.map((l) => l.swatch) as string[],
  /** The open map's camera bookmarks. */
  bookmarks: [] as Bookmark[],
  texScale: 8,
  mapName: 'Untitled',
  /** Terrain cells per side of the open map. */
  mapSize: 256,
  /** The client tiles the open map is a block of, described for the status bar; '' when it isn't one. */
  region: '',
  /** The tile block the open map is, for the minimap; null when it isn't a client region. */
  regionBlock: null as { x: number; y: number; size: number } | null,
  /** The continent the open region is a part of (its folder name), or ''. */
  regionMap: '',
  /** The creatures and game objects of the open region, for the Spawns panel. */
  spawns: [] as vmangos.WorldSpawn[],
  /** The spawn picked in the viewport or the Spawns panel, shown in the panel's details. */
  selectedSpawn: null as vmangos.WorldSpawn | null,
  /** The picked point of the selected creature's path, or -1. */
  selectedWaypoint: -1,
  /** Why the open region's spawns could not be read (the database down, no server folder), or ''. */
  spawnsError: '',
  /** What the Clear tool erases: placed models, or the paint (back to each chunk's base texture). */
  clearMode: 'models' as ClearMode,
  /** What the Map data tool paints, and whether it sets it or clears it. */
  mapDataMode: 'area' as MapDataMode,
  mapDataClear: false,
  /** The zone (AreaTable.dbc ID) the Map data tool paints; 0 before one is picked. */
  mapDataArea: 0,
  filePath: '',
  dirty: false,
})

/** What the Detail info readout says about the ground under the cursor (Graphics › Detail info). */
export interface DetailInfo {
  /** The client tile ("x, y"), or a dash on a map that isn't a region. */
  tile: string
  /** The paint chunk in its tile ("x, y"). */
  chunk: string
  /** The cell on the map ("x, z"). */
  cell: string
  height: number
  /** The ground's steepness in degrees. */
  slope: number
  hole: boolean
  /** The client's own no-doodad bit (no grass tufts) on the cell. */
  noTufts: boolean
  /** The chunk's zone, named with its AreaTable.dbc ID, or '' for none. */
  area: string
  /** The chunk's texture layers: a short name, the share at the cell (percent) and the ground effect ID. */
  textures: Array<{ name: string; weight: number; effect: number }>
  /** The liquid layers covering the cell, named with their surface height. */
  liquids: string[]
  /** Root models standing in the chunk. */
  models: number
}

export const stats = $state({
  fps: 0,
  drawCalls: 0,
  triangles: 0,
  objects: 0,
  cursor: null as { x: number; y: number; z: number } | null,
  /** The ground under the cursor, while Graphics › Detail info is on (refreshed at 2 Hz like the rest). */
  detail: null as DetailInfo | null,
  /** The zone of the chunk under the cursor while the Map data tool is active ('' for none). */
  hoverArea: '',
  /** Where the camera is for the Minimap window, while it is open: the target, its yaw, and the map's size in cells and yards. */
  view: null as { x: number; z: number; yaw: number; cells: number; world: number } | null,
})

/** Open map tabs (the active tab's live name/dirty come from `editor`). */
export const docs = $state({
  tabs: [] as Array<{ id: number; name: string; dirty: boolean; size: number }>,
  active: 0,
})

/** Local WoW client used as an asset source (read live from its MPQs). */
export const wow = $state({
  path: '',
  loaded: false,
  loading: false,
  error: '',
  files: 0,
  /** Bumped whenever the client changes so lists refetch. */
  revision: 0,
  /** Bumped when the client's liquid list (LIQUID_TYPES) was read, so the Water tool's select refreshes. */
  liquidsRevision: 0,
})

/** User preferences, persisted in the app config (see lib/state/prefs.ts). */
/** Camera speed steps: the preference is kept between a quarter and four times its normal speed. */
export function stepCameraSpeed(faster: boolean) {
  const next = prefs.cameraSpeed * (faster ? 1.25 : 0.8)
  prefs.cameraSpeed = Math.min(4, Math.max(0.25, next))
}

export const prefs = $state({
  /** Draw the terrain as a wireframe (for checking its triangles). */
  wireframe: false,
  /** Show each kind of layer; hiding one doesn't change the map. */
  showTerrain: true,
  showWater: true,
  showObjects: true,
  /** The creatures and game objects the world database places in a region, by kind. */
  showMonsters: true,
  showNpcs: true,
  showGameObjects: true,
  /** Draw every creature's waypoint path, not only the selected one's. */
  showAllPaths: false,
  /** A click on a creature in the Select tool opens it in the creature editor. */
  renderScale: 1,
  viewDistance: 1,
  fog: true,
  cameraSpeed: 1,
  mouseSensitivity: 1,
  invertY: false,
  /** The camera's target rides the ground and the camera stays above it; off, the camera flies anywhere (caves included). */
  cameraFollowGround: false,
  /** A pen's pressure scales sculpt speed and paint strength (a mouse is unchanged). */
  tabletSupport: false,
  /** Hour of day 0-24 (sun/moon position, lighting, sky). */
  timeOfDay: 13,
  /** Animate a full day/night cycle (one day ≈ cycleMinutes). */
  dayCycle: false,
  cycleMinutes: 10,
  clouds: true,
  shadows: 'medium' as 'off' | 'medium' | 'high',
  /** Flames + dynamic lights on torches, braziers, lamps… */
  propEffects: true,
  /** Play props' idle animations (windmills, flags, flames…). */
  animations: true,
  /** Leave out models too small on screen to see (a pixel or two), which dense zones have thousands of. */
  cullSmallModels: true,
  /** Draw the ground effects: the grass tufts, flowers and pebbles the game grows on each texture. */
  showGroundEffects: true,
  /** The Detail info readout in the viewport's corner: tile, chunk, cell, height, layers and liquids under the cursor. */
  detailInfo: false,
  /** Every file read from the client (models, textures, lists) goes into the Log window too, with its time (noggit's "additional file loading log"). */
  logFileLoading: false,
  /** How many tufts a cell grows: a quarter, half or all of the game's amount (world/groundEffects.ts). */
  groundEffectDensity: 'normal' as 'sparse' | 'normal' | 'full',
  /** Right dock width in px and collapsed panel ids (Photoshop-style dock). */
  dockWidth: 320,
  collapsedPanels: ['properties'] as string[],
  /** The asset browser along the bottom: its height in px, whether it is folded away, and its tile size. */
  browserHeight: 300,
  browserCollapsed: false,
  browserTile: 112,
  /** Recently picked assets (catalog keys), newest first. */
  recentAssets: [] as string[],
  /** The doodad brushes (tools/doodadBrush.ts) and the name of the one the Doodad brush tool paints with. */
  doodadBrushes: [] as DoodadBrush[],
  doodadBrush: '',
  /** The tabs open at the last close, reopened at the next start (io/session.ts). */
  session: { tabs: [] as SessionTab[], active: 0 },
})
export type Prefs = typeof prefs

/** An entry of the viewport's right-click menu: an action, or a separator. */
export interface ContextItem {
  label?: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  run?: () => void
}

export const ui = $state({
  status: 'Ready',
  /** A short-lived notice drawn big over the viewport (e.g. the placement scale while Shift+scrolling); '' when none. */
  viewportHint: '',
  /** Bumped with every hint, so the view can restart its fade even when the text is unchanged. */
  viewportHintSeq: 0,
  canUndo: false,
  canRedo: false,
  showNewDialog: false,
  /** Which page the Start dialog shows: a new world, or a part of a continent. */
  newMapMode: 'new' as 'new' | 'open',
  /** A copied map region is available / being placed. */
  hasClip: false,
  /** The active map's paint mask has something in it. */
  maskActive: false,
  pasting: false,
  dialog: null as 'about' | 'help' | 'log' | 'shortcuts' | 'quit' | 'closeDoc' | 'revert' | 'publish' | 'textures' | 'effects' | 'gameLogin' | 'saveSpawns' | 'mapProps' | 'weapon' | null,
  /** Tab hides every panel but the menu bar (the toolbar, options bar, asset browser, dock and status bar), as noggit's Tab does. */
  hidePanels: false,
  /** U: the top-down 2D view, as noggit's tile mode: straight down, no perspective, the wheel zooms. */
  topDown: false,
  /** The viewport's right-click menu: where it opens (CSS pixels) and what it offers; null when closed. */
  contextMenu: null as { x: number; y: number; title?: string; items: ContextItem[] } | null,
  /** The spawn (key) and equipment slot (0 main hand, 1 off hand, 2 ranged) the weapon dialog fills. */
  weaponPick: null as { key: string; slot: number } | null,
  /** Tab awaiting "close with unsaved changes?" confirmation. */
  closeDocId: 0,
  /** Which palette the left panel shows. */
  palette: 'models' as 'models' | 'textures',
  /** An asset the browser should show and scroll to (the pipette's pick); `seq` makes every pick a new request. */
  revealAsset: null as { key: string; seq: number } | null,
  busy: false,
  /** Vertices selected in Sculpt's Vertex mode (updated when a stroke ends). */
  vertexCount: 0,
  /** A texture waiting to be replaced in these paint chunks: the next texture picked in the browser takes its place. */
  replaceSlot: null as { chunks: number[]; tex: number } | null,
  /** Draw objects hidden with H. */
  showHiddenModels: false,
  /** How many objects the active map has hidden. */
  hiddenModels: 0,
  /** How many of the active region's spawns were changed, added or deleted since they were saved. */
  spawnChanges: 0,
  /** Clicks in the Select tool edit the selected creature's path: add, pick and drag its points. */
  pathEdit: false,
  /**
   * The creature editor, full screen: the creature template `entry`, and the spawn `key` it was
   * opened from (null for a template alone, such as a new creature).
   */
  creatureEditor: null as { key: string | null; entry: number } | null,
  /** The doodad brush editor, full screen (components/DoodadBrushEditor.svelte). */
  brushEditor: false,
  /** The floating inspector over the viewport (components/Inspector.svelte): the selection's numbers and actions. I toggles it. */
  inspector: false,
  /** The floating Minimap window (M): the map from above with the camera's spot; a click moves the camera. */
  minimap: false,
  /** A creature template being placed: the next click on the ground in the Select tool spawns it. */
  placeCreature: null as vmangos.CreatureTemplate | null,
  /** The game object template the Place tool puts down (see placeCreature). */
  placeObject: null as vmangos.ObjectTemplate | null,
})

let hintTimer: ReturnType<typeof setTimeout> | undefined
/** Show `msg` over the viewport for `timeout` ms. Another call restarts the clock. */
export function setViewportHint(msg: string, timeout = 1500) {
  ui.viewportHint = msg
  ui.viewportHintSeq++
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => (ui.viewportHint = ''), timeout)
}

let statusTimer: ReturnType<typeof setTimeout> | undefined
/**
 * The Log window's lines (Help › Log…): every status message, the Go side's progress lines (which
 * arrive as status messages) and, with Log file loading on, every file read from the client. The
 * newest is last; at most LOG_LINES are kept.
 */
export const appLog = $state({ lines: [] as Array<{ time: string; text: string }> })
const LOG_LINES = 500

export function logLine(text: string) {
  const d = new Date()
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  appLog.lines.push({ time, text })
  if (appLog.lines.length > LOG_LINES) appLog.lines.splice(0, appLog.lines.length - LOG_LINES)
}

export function clearLog() {
  appLog.lines = []
}

/** Logs a file read from the client (its kind, path, time taken and any error) when Log file loading is on. */
export function logFile(kind: string, path: string, ms: number, err?: unknown) {
  if (!prefs.logFileLoading) return
  logLine(err ? `${kind} ${path}: failed after ${Math.round(ms)} ms: ${err instanceof Error ? err.message : err}` : `${kind} ${path} (${Math.round(ms)} ms)`)
}

export function setStatus(msg: string, timeout = 4000) {
  if (msg && msg !== 'Ready' && msg !== ui.status) logLine(msg)
  ui.status = msg
  clearTimeout(statusTimer)
  if (timeout > 0) statusTimer = setTimeout(() => (ui.status = 'Ready'), timeout)
}
