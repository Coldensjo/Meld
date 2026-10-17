import type { SessionTab } from '../io/session'
import { LAYERS } from '../terrain/layers'
import type { FalloffCurve } from '../tools/brush'
import type { DoodadBrush } from '../tools/doodadBrush'
import type { FitMode } from '../terrain/fitGround'
import type { BrushStack } from '../tools/brushStack'
import { noRoles, type TextureRoles } from '../terrain/roles'
import type { ScopedEffects, TextureEffects } from '../world/groundEffects'
import type { TextureLooks } from '../world/textureLooks'
import type { PasteHeightMode } from '../world/pasteHeight'
import type { MaskPick } from '../terrain/maskSelect'
import { newSpawnBrush, type SpawnBrush } from '../tools/spawnBrush'
import type { Bookmark } from '../engine/MapDocument'
import type { PerfReport } from '../engine/perfMeter'
import type { BrowserView } from '../wow/browserViews'
import type { ModelSet } from '../wow/modelSets'
import type { vmangos } from '../../../wailsjs/go/models'

// Reactive editor state (Svelte 5 runes). The engine reads these values each
// frame; it never stores per-frame data here (that would trigger re-renders).

export type ToolId = 'select' | 'sculpt' | 'paint' | 'road' | 'water' | 'place' | 'clear' | 'doodad' | 'mapdata' | 'stamp'
/**
 * What the Map data tool paints into the chunk headers: the zone (an AreaTable.dbc ID), the
 * impassable flag, or the cells that grow no ground effect doodads.
 */
export type MapDataMode = 'area' | 'impassable' | 'noTufts' | 'shadow'
export type ClearMode = 'models' | 'textures' | 'faint' | 'heights' | 'liquids' | 'holes'
export type SculptMode = 'raise' | 'lower' | 'smooth' | 'blur' | 'flatten' | 'noise' | 'mountain' | 'crevice' | 'terrace' | 'erode' | 'vertex' | 'hole'
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
   * Flatten's lock mode (Noggit Red's): with it on, every stroke levels to the locked point's height
   * `y` (and Angled pivots its plane on the point) instead of the height under each stroke's start,
   * so several strokes meet at one level. Alt+click in Flatten locks the point under the cursor.
   */
  flattenLock: { on: false, x: 0, y: 0, z: 0 },
  /**
   * Crevice digs the brush's solid centre into a trench and piles the ground onto both sides, in the
   * falloff band. `ridge` scales the pile: 1 keeps the dug volume, 0 only digs.
   */
  crevice: { ridge: 1 },
  /** Sculpt › Terrace (#166): yards between the levels, the height a level sits at, and how much of a step is flat (1 cliffs, 0 smooth stairs). */
  terrace: { step: 6, offset: 0, sharpness: 0.8 },
  /** Mountain: how much of the peak its ridges carve away (0 a smooth hill, 1 all ridges). */
  mountain: { ridges: 0.7 },
  /**
   * Sculpt › Erode and Terrain › Erode (#165, terrain/erosion.ts). The brush runs water drops
   * ('hydraulic', which carve gullies and leave fans at their feet) or lets the ground slide where it
   * is steeper than `talus` degrees ('thermal'). Erode over an area runs `density` drops a cell, then
   * `passes` thermal passes at `talus`, from the random `seed`.
   */
  erode: { kind: 'hydraulic' as 'hydraulic' | 'thermal', talus: 40, density: 0.5, passes: 5, seed: 1 },
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
  slopePaint: { rockDeg: 40, dirtDeg: 22, restoreBase: false },
  /** The map's texture roles (terrain/roles.ts): the palette entries that are its rock and dirt. */
  roles: noRoles() as TextureRoles,
  /** The map's own ground effect per texture path (world/groundEffects.ts), over what the client's tiles give. */
  textureEffects: {} as TextureEffects,
  /** The map's own look flags (animation, overbright) per texture path (world/textureLooks.ts); saved with the map. */
  textureLooks: {} as TextureLooks,
  /** The map's ground effect choices per zone and per tile (world/groundEffects.ts); saved with the map. */
  scopedEffects: { zones: {}, tiles: {} } as ScopedEffects,
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
  /**
   * Swap mode, after Noggit Red's swapper: with `keep` on, the texture the first stroke swapped away
   * (`from`, a texture path, so it holds across maps) stays the one to swap until unkept; `scope` swaps
   * by the brush's weight, or the whole layer in every chunk the brush touches, or in the tile under it.
   */
  swap: { keep: false, from: '', scope: 'brush' as 'brush' | 'chunk' | 'tile' },
  maskErase: false,
  /**
   * Paint › Mask's Select by (#183): a click with `by` other than 'brush' is the magic wand. It takes the
   * texels whose texture under the click weighs at least `minWeight`, whose height is within `height`
   * yards of the click's, whose slope is `slopeMin` to `slopeMax` degrees, or that are under a liquid or
   * the sea; only those joined to the click with `contiguous`. `feather` softens the new edge (yards).
   * `step` is how far Grow, Shrink and Feather Mask go (yards).
   */
  maskSelect: {
    by: 'brush' as MaskPick,
    contiguous: true,
    minWeight: 0.5,
    height: 2,
    slopeMin: 30,
    slopeMax: 90,
    feather: 0,
    step: 2,
  },
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
   * cursor stop on liquid surfaces. With `allLayers` off, the Water tool draws only each chunk's
   * layer number `layer` (counted from 0 in the chunk's own order), as Noggit Red's Current layer does.
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
    allLayers: true,
    layer: 0,
  },
  /** The sea: ocean at this level wherever the ground lies below it. */
  waterLevel: 0,
  waterEnabled: true,
  /** Selected model type to place ("m2:<path>" / "wmo:<path>"), or ''. */
  prefab: '',
  /** Placed models turned and sized at random; off at the start, so a model goes down as it is (#212). */
  placeRandomRot: false,
  placeRandomScale: false,
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
  /**
   * The image brush (Noggit Red's image mask): the name of an image in `prefs.brushImageDir` that shapes
   * the Sculpt and Paint brushes ('' for none), its rotation in degrees, and whether each stroke turns
   * it to a new random rotation when it ends.
   */
  brushImage: { name: '', rotation: 0, random: false },
  /**
   * The Select tool's selection brush (Noggit Red's): a drag on the ground selects the models under the
   * brush instead of an area. Shift adds to the selection, Ctrl takes models out of it.
   */
  selectBrush: false,
  /**
   * The shape a drag on the ground selects in the Select tool (#183; L cycles): a rect, a lasso drawn
   * freehand, or a polygon clicked point by point (Enter or a click on the first point closes it).
   * Shift adds to the area, Ctrl takes away from it.
   */
  selectShape: 'rect' as 'rect' | 'lasso' | 'polygon',
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
  /** The Doodad tool paints models (its doodad brushes) or creatures (the spawn brush, `prefs.spawnBrush`, #171). */
  doodadMode: 'models' as 'models' | 'creatures',
  /** The primary selected object: the one the gizmo and the Properties panel work on. */
  selected: null as SelectedInfo | null,
  /** Every selected object (see lib/state/selection.ts). The primary is one of them when there is one. */
  selectedIds: [] as number[],
  /** The selected area in cells (vertex corners), or null. The Select tool's drag on the ground makes it. */
  selection: null as { x0: number; z0: number; x1: number; z1: number } | null,
  /** The gizmo's move arrows follow the selected model's own turn (local space) instead of the map's x and z. */
  gizmoLocal: false,
  paste: { terrain: true, textures: true, objects: true, blend: 2, heightOffset: 0, heightMode: 'set' as PasteHeightMode },
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
  mapName: 'Untitled',
  /** Terrain cells per side of the open map. */
  mapSize: 256,
  /** The client tiles the open map is a block of, described for the status bar; '' when it isn't one. */
  region: '',
  /** The tile block the open map is, for the minimap; null when it isn't a client region. */
  regionBlock: null as { x: number; y: number; size: number } | null,
  /** The continent the open region is a part of (its folder name), or ''. */
  regionMap: '',
  /** The creatures and game objects of the open region. */
  spawns: [] as vmangos.WorldSpawn[],
  /** The spawn picked in the viewport, shown in the Inspector and the editors. */
  selectedSpawn: null as vmangos.WorldSpawn | null,
  /** The picked point of the selected creature's path, or -1. */
  selectedWaypoint: -1,
  /** Why the open region's spawns could not be read (the database down, no server folder), or ''. */
  spawnsError: '',
  /** What the Clear tool erases: placed models, or the paint (back to each chunk's base texture). */
  clearMode: 'models' as ClearMode,
  /** The Clear tool's faint-layer threshold, in percent: a chunk's painted layer weaker than this everywhere goes (#41). */
  clearThreshold: 10,
  /** What the Map data tool paints, and whether it sets it or clears it. */
  mapDataMode: 'area' as MapDataMode,
  mapDataClear: false,
  /** The zone (AreaTable.dbc ID) the Map data tool paints; 0 before one is picked. */
  mapDataArea: 0,
  filePath: '',
  dirty: false,
})

/** What the Detail info readout says about the ground under the cursor (View › Detail info). */
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
  /** The cell's no-doodad bit (no grass tufts): the client's own, or painted with the Map data tool. */
  noTufts: boolean
  /** The chunk's header flags it as impassable. */
  impassable: boolean
  /** The chunk's zone, named with its AreaTable.dbc ID, or '' for none. */
  area: string
  /** The WMO room the camera is in (file, group name and index, and the group across a portal it stands in), or ''. */
  room: string
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
  /** The ground under the cursor, while View › Detail info is on (refreshed at 2 Hz like the rest). */
  detail: null as DetailInfo | null,
  /** The zone of the chunk under the cursor while the Map data tool is active ('' for none). */
  hoverArea: '',
  /** Where the camera is for the Minimap window, while it is open: the target, its yaw, and the map's size in cells and yards. */
  view: null as { x: number; z: number; yaw: number; cells: number; world: number } | null,
  /** The performance overlay's numbers (#179), refreshed once a second while it is on. */
  perf: null as PerfReport | null,
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
  /** Paint's "Show unpaintable chunks": tint the chunks full with four other textures, which refuse the paint texture. */
  showUnpaintable: false,
  /** Lighting › Client Lighting: the sun, sky light, fog and water colours follow the client's lights where the camera is. */
  clientLighting: false,
  /** Lighting › Baked Shadows: a region's ground darkened where the client's tiles bake shadow (MCSH), as the game draws it. */
  bakedShadows: true,
  /** Import/Export › Minimap Tiles with All Models: the trees too, not only the buildings the client's own tiles show. */
  minimapAllModels: false,
  /** View › Far Horizon: past an open region, the map's coarse WDL ground in the fog colour, as the client draws it. */
  showHorizon: true,
  /** View › Bounding boxes: draw a box around every model (Noggit Red's model boxes). */
  showBoxes: false,
  /** View › Area triggers: draw the map's AreaTrigger.dbc volumes (dungeon portals and the like, #141). */
  showAreaTriggers: false,
  /** The climb view: tint the ground too steep for a character to walk up (Noggit Red's View › Climb; Meld's Terrain › Climb). */
  climbView: false,
  /**
   * View › Walkable ground (#175): the navmesh the server's MoveMapGenerator would build, drawn over
   * the ground around the camera (world/nav/NavPreview.ts).
   */
  navView: false,
  /** View › Height contours (#22, Noggit Red's): dark lines along the ground every contourStep yards of height. */
  showContours: false,
  /** The minimap window's Light zones (#26): the map's Light.dbc spheres, the radius each is full at and fades out by. */
  minimapLights: false,
  contourStep: 4,
  /** The climb view's steepest walkable slope, in degrees (Noggit Red's default is 49). */
  climbAngle: 49,
  /** Show each kind of layer; hiding one doesn't change the map. */
  showTerrain: true,
  showWater: true,
  showObjects: true,
  /** Camera › Locked cursor (#19, Noggit Red's): a brush stays on its ground point while the camera moves; only the mouse moves it. */
  lockedCursor: false,
  /** Graphics › FPS limit (#24): frames a second at most, 0 for the screen's rate. */
  fpsLimit: 0,
  /** The client maps pinned to the top of the Start dialog's map list (#47), by Map.dbc ID. */
  pinnedMaps: [] as number[],
  /** Models › Fit Ground to Selection (#168): yards under the floor, the blend ring's width, which way the ground may move, cutting holes, and how far from the ground a floor counts. */
  fitGround: { margin: 0.2, falloff: 6, mode: 'both' as FitMode, holes: false, reach: 4 },
  /** The Place tool's Fit ground (#207): a model placed on open ground has the ground fitted under it with `fitGround`'s settings. */
  placeFitGround: false,
  /** Preferences › Autosave (#177): minutes between recovery copies of the maps with unsaved changes, 0 for none. */
  autosaveMinutes: 3,
  /** Preferences › Theme (#49): the editor's colours, or the desktop's light or dark setting. */
  theme: 'dark' as 'dark' | 'light' | 'system',
  /** Graphics › Anti-aliasing (#24), mirrored to localStorage by display.ts and applied at the next start. */
  antialias: true,
  /** View › Layers › Doodads (m2 models) and Buildings (wmo), each on its own under Objects (#43). */
  showDoodads: true,
  showBuildings: true,
  /** The creatures and game objects the world database places in a region, by kind. */
  showMonsters: true,
  showNpcs: true,
  showGameObjects: true,
  /**
   * The world events (game_event IDs) whose spawns are shown (#143): a spawn of an event appears only
   * while its event is shown, and one an event takes away leaves while it is. None by default, so a
   * town shows its everyday spawns.
   */
  shownEvents: [] as number[],
  /** Draw every creature's waypoint path, not only the selected one's. */
  showAllPaths: false,
  /** View › Spawn pools (#172): a ring in its pool's colour round every pooled spawn, and the region's pools drawn in the viewport legend. */
  showPools: false,
  /** Names over the creatures and game objects, with a creature's level and rank (#125). */
  spawnNames: true,
  /** View › Names seen as Alliance or Horde (#134): a creature's name is red, yellow or green by how its faction treats that side. */
  namesSide: 'alliance' as 'alliance' | 'horde',
  /**
   * Creatures and game objects stay drawn with the camera in a building, where the rest of the world
   * shows only through its doorways (#150).
   */
  spawnsThroughWalls: true,
  /** A click on a creature in the Select tool opens it in the creature editor. */
  renderScale: 1,
  viewDistance: 1,
  fog: true,
  cameraSpeed: 1,
  mouseSensitivity: 1,
  invertY: false,
  /** The camera's target rides the ground and the camera stays above it; off, the camera flies anywhere (caves included). */
  cameraFollowGround: false,
  /** The flying camera stays at least 3 yards above the ground (camera collision); off, it enters caves. */
  cameraCollision: false,
  /** A pen's pressure scales sculpt speed and paint strength (a mouse is unchanged). */
  tabletSupport: false,
  /** With Tablet support, a pen's pressure also sizes the brush tools' radius (Noggit Red's Use Tablet on the radius slider). */
  tabletRadius: false,
  /** Hour of day 0-24 (sun/moon position, lighting, sky). */
  timeOfDay: 13,
  /** Animate a full day/night cycle (one day ≈ cycleMinutes). */
  dayCycle: false,
  cycleMinutes: 10,
  clouds: true,
  shadows: 'medium' as 'off' | 'medium' | 'high',
  /** Flames + dynamic lights on torches, braziers, lamps… */
  propEffects: true,
  /** The models' particles (flames, smoke, sparks, spray) as the client emits them; off, a torch shows a drawn flame instead. */
  particles: true,
  /** Play props' idle animations (windmills, flags, flames…). */
  animations: true,
  /** Leave out models too small on screen to see (a pixel or two), which dense zones have thousands of. */
  cullSmallModels: true,
  /** Draw the ground effects: the grass tufts, flowers and pebbles the game grows on each texture. */
  showGroundEffects: true,
  /** The Detail info readout in the viewport's corner: tile, chunk, cell, height, layers and liquids under the cursor. */
  detailInfo: false,
  /** Run File › Check Map when Compile Region to Client starts, and stop it on an error finding (#195). */
  checkBeforeCompile: false,
  /** Rebuild the server's map data for the compiled tiles after Compile Region to Client, when a VMaNGOS folder is set (#211). It restarts the world server. */
  updateServerAfterCompile: true,
  /** View › Performance Overlay (#179): where the frame's time goes, by subsystem and GPU pass, in the viewport's corner. */
  perfOverlay: false,
  /** Every file read from the client (models, textures, lists) goes into the Log window too, with its time (noggit's "additional file loading log"). */
  logFileLoading: false,
  /** How many cells of a chunk grow tufts: the client's Ground Clutter stops Low, Medium and High, 16, 32 and 48 (`frillDensity` in world/groundEffects.ts). */
  groundEffectDensity: 'normal' as 'sparse' | 'normal' | 'full',
  /** Right dock width in px and collapsed panel ids (Photoshop-style dock). */
  dockWidth: 320,
  collapsedPanels: ['properties'] as string[],
  /** The asset browser along the bottom: its height in px, whether it is folded away, and its tile size. */
  browserHeight: 300,
  browserCollapsed: false,
  browserTile: 112,
  /** The toolbar's icon size in px (Preferences › Toolbar icons), from TOOLBAR_ICON_MIN to TOOLBAR_ICON_MAX (#128). */
  toolbarIcon: 22,
  /** The asset browser's tab (a catalog kind, 'all' or a spawn kind) and where each tab was (wow/browserViews.ts). */
  browserKind: 'm2',
  browserViews: {} as Record<string, BrowserView>,
  /** Recently picked assets (catalog keys), newest first. */
  recentAssets: [] as string[],
  /** The favourite assets (catalog keys), starred with a right-click in the asset browser, shown first there. */
  favoriteAssets: [] as string[],
  /** The author's model sets (wow/modelSets.ts), shown in the asset browser's Sets tab, and the name of the one shown. */
  modelSets: [] as ModelSet[],
  modelSet: '',
  /** The doodad brushes (tools/doodadBrush.ts) and the name of the one the Doodad brush tool paints with. */
  doodadBrushes: [] as DoodadBrush[],
  /** The Doodad tool's spawn brush (Creatures mode, #171): its creature templates with weights and its settings. */
  spawnBrush: newSpawnBrush() as SpawnBrush,
  /** The Stamp tool's brush stacks (tools/brushStack.ts) and the name of the one it applies. */
  brushStacks: [] as BrushStack[],
  brushStack: '',
  doodadBrush: '',
  /** The folder of the user's own greyscale images that shape the image brushes (editor.brushImage). */
  brushImageDir: '',
  /** The folder the author's prefabs are kept in (#170), listed by the asset browser's Prefabs tab. */
  prefabDir: '',
  /** How a placed prefab varies (#170): `on`, each root turned up to `turn` degrees, scaled by up to `scale`, dropped with the chance `drop`. */
  prefabVary: { on: false, turn: 15, scale: 0.1, drop: 0 },
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
  dialog: null as 'stack' | 'about' | 'help' | 'log' | 'shortcuts' | 'quit' | 'closeDoc' | 'revert' | 'publish' | 'textures' | 'effects' | 'zones' | 'portals' | 'lights' | 'looks' | 'heightmap' | 'watermap' | 'gameLogin' | 'saveSpawns' | 'mapProps' | 'weapon' | 'recovery' | 'fitGround' | 'spawnRules' | 'worldMap' | 'erode' | null,
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
   * Clicks on spawns in the Select tool build the selected spawn's formation or pool (#172) instead
   * of selecting: `lead` makes each clicked creature follow it (or leave, if it does), `follow` makes
   * it follow the clicked one's leader, `pool` puts each clicked spawn into its pool (or takes it
   * out), and `joinPool` puts it into the clicked one's pool. `key` is the selected spawn's.
   */
  spawnPick: null as { mode: 'lead' | 'follow' | 'pool' | 'joinPool'; key: string } | null,
  /**
   * The creature editor, full screen: the creature template `entry`, and the spawn `key` it was
   * opened from (null for a template alone, such as a new creature).
   */
  creatureEditor: null as { key: string | null; entry: number } | null,
  /**
   * The game object editor, full screen (#136): the game object template `entry`, and the spawn `key`
   * it was opened from (null for a template alone, such as a new object).
   */
  objectEditor: null as { key: string | null; entry: number } | null,
  /**
   * The large preview window (#197, the right-click menu's Preview): a model type (`m2:`, `wmo:` with
   * its set, `helper:`, or a spawn's dressed type), its name and its scale; null while closed.
   */
  modelPreview: null as { title: string; type: string; scale: number } | null,
  /** Camera › Walk (#21): the FPS camera, 3 yd above the ground; off returns to the camera it started from. */
  walkCamera: false,
  /**
   * Lighting › Weather Preview (#185): the client's rain, snow or sandstorm around the camera at a
   * grade, with the storm light under Client Lighting (world/weather.ts). Not saved: the app starts clear.
   */
  weather: 'clear' as 'clear' | 'rain' | 'snow' | 'sand',
  weatherGrade: 'medium' as 'light' | 'medium' | 'heavy',
  /** The Creatures workspace (World › Creatures…, #132): find creatures and make a new one with the guide. */
  creatures: false,
  /**
   * The quest editor, full screen (#259, World › Quests…): the quest `entry` open, 0 for none (find
   * one), -1 for a new quest; `giver`, the creature or object it was opened for (the creature
   * editor's Quests tab), which a new quest is given and taken in by.
   */
  questEditor: null as { entry: number; giver?: { kind: 'creature' | 'object'; id: number; name: string; ready: boolean } } | null,
  /** Bumped when the quest editor saves, so the creature editor's Quests tab reads its quests again. */
  questsVersion: 0,
  /** The doodad brush editor, full screen (components/DoodadBrushEditor.svelte). */
  brushEditor: false,
  /** The game Meld closes and opens around an export (Game › Game Client): Wow.exe or Benilla. */
  gameClient: 'wow' as 'wow' | 'benilla',
  /** How the game's window opens when Meld starts it (Game › Game Window): '' the game's own setting. */
  gameWindow: '' as '' | 'windowed' | 'fullscreen',
  gameResolution: '1280x720',
  /** The floating quick texture palette (components/TexturePaletteWindow.svelte): the map's textures to paint with. */
  texturePalette: false,
  /** The floating History window (components/HistoryWindow.svelte): the undo stack, a click goes to any step. */
  history: false,
  /** Bumped whenever the active map's undo stack changes or another map's becomes active, so the History window re-reads it. */
  historyVersion: 0,
  /** Bumped when a prefab is saved, so the Prefabs tab reads its folder again. */
  prefabsVersion: 0,
  /** The floating Check Map window (components/CheckMapWindow.svelte, #176): what may show wrong in the game. */
  checkMap: false,
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
