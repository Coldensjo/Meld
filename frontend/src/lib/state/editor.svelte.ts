import { LAYERS } from '../terrain/layers'
import type { FalloffCurve } from '../tools/brush'
import type { Bookmark } from '../engine/MapDocument'
import type { vmangos } from '../../../wailsjs/go/models'

// Reactive editor state (Svelte 5 runes). The engine reads these values each
// frame; it never stores per-frame data here (that would trigger re-renders).

export type ToolId = 'select' | 'sculpt' | 'paint' | 'road' | 'water' | 'place' | 'clear'
export type ClearMode = 'models' | 'textures'
export type SculptMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise' | 'mountain' | 'vertex'
/** Flatten target: the height under the first click, or the average height under the brush. */
export type FlattenTarget = 'origin' | 'average'
/** Flatten direction: move ground both ways, or only up or only down toward the target. */
export type FlattenDir = 'both' | 'raise' | 'lower'
/** Sculpt edit limit: change ground everywhere, or only the ground above or below the cursor's height. */
export type SculptLimit = 'none' | 'above' | 'below'
export type WaterMode = 'dig' | 'shore'

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
  flattenTarget: 'origin' as FlattenTarget,
  flattenDir: 'both' as FlattenDir,
  sculptLimit: 'none' as SculptLimit,
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
  waterMode: 'dig' as WaterMode,
  waterLevel: 0,
  waterEnabled: true,
  /** Selected model type to place ("m2:<path>" / "wmo:<path>"), or ''. */
  prefab: '',
  placeRandomRot: true,
  placeRandomScale: true,
  /** Placed models tilt a little at random (up to 8 degrees each way) when on. */
  placeRandomTilt: false,
  placeScatter: false,
  /** Dragging a model along the ground tilts it to the ground's slope; smooth blends the slope over a cell each way. */
  followGround: false,
  followGroundSmooth: true,
  /** Extra height above the surface for new placements (Alt+scroll). */
  placeHeight: 0,
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
  /** The paint chunk under the cursor (index into the chunk grid), or -1. The Layers panel shows it. */
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
  /** Why the open region's spawns could not be read (the database down, no server folder), or ''. */
  spawnsError: '',
  /** What the Clear tool erases: placed models, or the paint (back to each chunk's base texture). */
  clearMode: 'models' as ClearMode,
  filePath: '',
  dirty: false,
})

export const stats = $state({
  fps: 0,
  drawCalls: 0,
  triangles: 0,
  objects: 0,
  cursor: null as { x: number; y: number; z: number } | null,
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
  /** Right dock width in px and collapsed panel ids (Photoshop-style dock). */
  dockWidth: 320,
  collapsedPanels: ['properties'] as string[],
  /** The asset browser along the bottom: its height in px, whether it is folded away, and its tile size. */
  browserHeight: 300,
  browserCollapsed: false,
  browserTile: 112,
  /** Recently picked assets (catalog keys), newest first. */
  recentAssets: [] as string[],
})
export type Prefs = typeof prefs

export const ui = $state({
  status: 'Ready',
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
  dialog: null as 'about' | 'shortcuts' | 'quit' | 'closeDoc' | 'revert' | 'publish' | 'textures' | 'gameLogin' | null,
  /** Tab awaiting "close with unsaved changes?" confirmation. */
  closeDocId: 0,
  /** Which palette the left panel shows. */
  palette: 'models' as 'models' | 'textures',
  busy: false,
  /** Vertices selected in Sculpt's Vertex mode (updated when a stroke ends). */
  vertexCount: 0,
  /** A chunk texture waiting to be replaced: the next texture picked in the palette takes its place. */
  replaceSlot: null as { chunk: number; slot: number } | null,
  /** Draw objects hidden with H. */
  showHiddenModels: false,
  /** How many objects the active map has hidden. */
  hiddenModels: 0,
})

let statusTimer: ReturnType<typeof setTimeout> | undefined
export function setStatus(msg: string, timeout = 4000) {
  ui.status = msg
  clearTimeout(statusTimer)
  if (timeout > 0) statusTimer = setTimeout(() => (ui.status = 'Ready'), timeout)
}
