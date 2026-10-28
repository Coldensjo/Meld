import { LAYERS } from '../terrain/layers'
import type { FalloffCurve } from '../tools/brush'
import { noRoles, type TextureRoles } from '../terrain/roles'
import type { ScopedEffects, TextureEffects } from '../world/groundEffects'
import type { TextureLooks } from '../world/textureLooks'
import type { ReferenceImage } from '../terrain/referenceImage'
import type { MapPath, PathKind } from '../terrain/paths'
import type { PasteHeightMode } from '../world/pasteHeight'
import type { MaskPick } from '../terrain/maskSelect'
import type { AreaShapeMode } from '../terrain/smoothArea'
import type { Bookmark } from '../engine/MapDocument'
import type { PerfReport } from '../engine/perfMeter'
import type { vmangos } from '../../../wailsjs/go/models'

// Moved out of this file (#459); re-exported so the older imports keep working. New code imports them
// from their own modules.
export { prefs, defaultPrefs, stepCameraSpeed, type Prefs } from './prefs.svelte'
export { appLog, logLine, flushLog, startLogFile, clearLog, logFile } from './log.svelte'
export { setStatus, setViewportHint, queueViewportHint, publishViewportHint } from './status.svelte'

// Reactive editor state (Svelte 5 runes). The engine reads these values each
// frame; it never stores per-frame data here (that would trigger re-renders).

export type ToolId = 'select' | 'sculpt' | 'paint' | 'road' | 'water' | 'place' | 'clear' | 'doodad' | 'mapdata' | 'stamp' | 'path' | 'script'
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
	 * `passes` thermal passes at `talus`, from the random `seed`; with `mask` it then puts where the
	 * ground settled into the paint mask (#242).
	 */
	erode: { kind: 'hydraulic' as 'hydraulic' | 'thermal', talus: 40, density: 0.5, passes: 5, seed: 1, mask: false },
	/**
	 * Terrain › Smooth Selection (#713, terrain/smoothArea.ts): `passes` passes of Sculpt › Smooth's kernel
	 * at `strength` (0 to 1 of the way to the neighbours' average a pass), faded in from the area's edge over
	 * `width` yards with `falloff`. `mode` (#721) runs Raise or Lower by `amount` yards, Flatten to the area's
	 * mean or to `height` (`flatten`), or Roughen by `amount` yards of noise with bumps `scale` yards across
	 * from `seed`, in one pass over the same area, instead; `shape` is the last of those picked.
	 */
	smoothArea: {
		mode: 'smooth' as AreaShapeMode,
		/** The shape the Raise, Lower, Flatten or Roughen menu entry opens the dialog on: the last one picked. */
		shape: 'raise' as Exclude<AreaShapeMode, 'smooth'>,
		strength: 0.5,
		passes: 10,
		falloff: true,
		width: 12,
		amount: 5,
		flatten: 'average' as 'average' | 'height',
		height: 0,
		scale: 12,
		seed: 1,
	},
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
	/** The map's reference image (terrain/referenceImage.ts, View › Reference Image): its path and where it lies; saved with the map. */
	reference: null as ReferenceImage | null,
	/** The map's paths (terrain/paths.ts, the Path tool, #167): roads drawn along a curve; saved with the map, never exported. */
	paths: [] as MapPath[],
	/** The Path tool's picked path (its id) and point (its index); -1 for none. Not saved. */
	pathId: -1,
	pathPoint: -1,
	/** What a new path does. */
	pathKind: 'road' as PathKind,
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
	/** The map the open tab is a world view of (its folder name, #15), or '' for any other tab. */
	worldMap: '',
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

/**
 * The editor fields the brush tools of TerrainTools.ts read their settings from (`ToolSettings`). A new
 * setting read there fails to compile until it is listed here, so the Stamp tool's per-brush copy has it.
 */
export const TOOL_SETTING_KEYS = [
	'brush',
	'brushImage',
	'sculptMode',
	'sculptLimit',
	'sculptPaint',
	'sculptPaintLayer',
	'paintMode',
	'paintSpray',
	'paintLayer',
	'flattenTarget',
	'flattenDir',
	'flattenAngled',
	'flattenLock',
	'terrace',
	'mountain',
	'crevice',
	'erode',
	'slopePaint',
	'roles',
	'spray',
	'swap',
	'maskSelect',
	'maskErase',
	'holeFill',
	'palette',
	'roadFlatten',
	'water',
	'waterMode',
	'waterLevel',
	'vertexAngle',
	'vertexDir',
	'vertexRef',
] as const satisfies ReadonlyArray<keyof typeof editor>

/** The editor state the brush tools read their settings from. */
export type ToolSettings = Pick<typeof editor, (typeof TOOL_SETTING_KEYS)[number]>

/** A plain deep copy of just the tool settings (not the region's spawns, paths and the rest), for the Stamp tool's per-brush settings. */
export function copyToolSettings(): ToolSettings {
	const out: Record<string, unknown> = {}
	for (const k of TOOL_SETTING_KEYS) out[k] = structuredClone($state.snapshot(editor[k]))
	return out as ToolSettings
}

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
	/** `size` is the map's cells a side, 0 for a world view (#15). */
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

/** An entry of the viewport's right-click menu: an action, or a separator. */
export interface ContextItem {
	label?: string
	shortcut?: string
	disabled?: boolean
	danger?: boolean
	separator?: boolean
	run?: () => void
}

/** A project (#48): its name, its folder and the client folder it edits. */
export interface ProjectInfo {
	name: string
	path: string
	clientPath: string
}

/** The dialogs `ui.dialog` opens (components/AppDialogs.svelte); null when none is open. */
export type DialogId =
	| 'stack'
	| 'about'
	| 'help'
	| 'log'
	| 'shortcuts'
	| 'hotkeys'
	| 'quit'
	| 'closeDoc'
	| 'revert'
	| 'publish'
	| 'textures'
	| 'effects'
	| 'zones'
	| 'portals'
	| 'lights'
	| 'looks'
	| 'heightmap'
	| 'watermap'
	| 'gameLogin'
	| 'saveSpawns'
	| 'mapProps'
	| 'weapon'
	| 'recovery'
	| 'fitGround'
	| 'spawnRules'
	| 'worldMap'
	| 'erode'
	| 'smoothArea'
	| 'compileBeforeLaunch'
	| 'soapOff'
	| 'project'
	| 'folderSetup'
	| 'preferences'

/** The Preferences dialog's pages (components/PreferencesDialog.svelte, #752). */
export type PrefsPage = 'general' | 'folders' | 'camera' | 'graphics' | 'compile' | 'game'

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
	/** The open project (a project folder and the client it edits, #48), null for none; opening a part of Azeroth needs one. */
	project: null as ProjectInfo | null,
	/** The recent projects, newest first, the open one included. */
	recentProjects: [] as ProjectInfo[],
	/** A copied map region is available / being placed. */
	hasClip: false,
	/** The active map's paint mask has something in it. */
	maskActive: false,
	pasting: false,
	dialog: null as DialogId | null,
	/** The page the Preferences dialog (Edit › Preferences…, #752) shows; kept between openings. */
	prefsPage: 'general' as PrefsPage,
	/** Tab hides every panel but the menu bar (the toolbar, options bar, asset browser, dock and status bar), as noggit's Tab does. */
	hidePanels: false,
	/** U: the top-down 2D view, as noggit's tile mode: straight down, no perspective, the wheel zooms. */
	topDown: false,
	/** View › Reference Image: the window that lays the author's plan over the map (#184). */
	referenceWindow: false,
	/** The reference image's corners are dragged in the top-down view (Engine.referencePress). */
	referenceAdjust: false,
	/** The active map's reference image as a blob URL, for the top-down view's screen overlay; '' for none. */
	referenceUrl: '',
	/** Bumped when the active map's reference image is read or the tab changes, for the window that shows its colours. */
	referenceVersion: 0,
	/** The viewport's right-click menu: where it opens (CSS pixels) and what it offers; null when closed. */
	contextMenu: null as { x: number; y: number; title?: string; items: ContextItem[] } | null,
	/** The area trigger (ID) picked in the viewport or the Portals dialog (#307); each follows the other. */
	pickedTrigger: null as number | null,
	/** World › Flight Paths: the window that edits the open map's flight stops and routes (#180). */
	flightPaths: false,
	/** A route's fly-along preview is moving the camera (Engine.flyTaxi); Esc or Stop ends it. */
	taxiFlying: false,
	/** The spawn (key) and equipment slot (0 main hand, 1 off hand, 2 ranged) the weapon dialog fills. */
	weaponPick: null as { key: string; slot: number } | null,
	/** The yes/no prompt open over everything else (`lib/state/confirm.ts` askConfirm, #581); null when none. */
	confirm: null as { text: string; title: string; ok: string; danger: boolean } | null,
	/** Tab awaiting "close with unsaved changes?" confirmation. */
	closeDocId: 0,
	/** Which palette the left panel shows. */
	palette: 'models' as 'models' | 'textures',
	/** An asset the browser should show and scroll to (the pipette's pick); `seq` makes every pick a new request. */
	revealAsset: null as { key: string; seq: number } | null,
	busy: false,
	/** The save running now, in words ("Saving map"), for the Saving bar (#343); '' when none. Set through `lib/state/saving.ts` only. */
	saving: '',
	/** The save's latest progress line (a publish's log), shown under the Saving bar; '' for none. */
	savingDetail: '',
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
	/** The region Launch found with edits the client lacks, for its Compile and Launch dialog (#214); '' for none. */
	uncompiledRegion: '',
	/** Clicks in the Select tool edit the selected creature's path: add, pick and drag its points. */
	pathEdit: false,
	/**
	 * Clicks on spawns in the Select tool build the selected spawn's formation or pool (#172) instead
	 * of selecting: `lead` makes each clicked creature follow it (or leave, if it does), `follow` makes
	 * it follow the clicked one's leader, `pool` puts each clicked spawn into its pool (or takes it
	 * out), `joinPool` puts it into the clicked one's pool, and `joinMother` puts its pool into the
	 * clicked one's mother pool (#261). `key` is the selected spawn's.
	 */
	spawnPick: null as { mode: 'lead' | 'follow' | 'pool' | 'joinPool' | 'joinMother'; key: string } | null,
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
	/** Camera › Walking View (#21, #750): the FPS camera, 3 yd above the ground; off returns to the camera it started from. */
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
	/**
	 * The item editor, full screen (#353, Tools › Items…): the item `entry` open, 0 for none (find one),
	 * -1 for a new item.
	 */
	itemEditor: null as { entry: number } | null,
	/** The spell editor (#294, Tools › Spells…): the spell open (0 for none yet, -1 while making one). */
	spellEditor: null as { entry: number } | null,
	/** The Icons tool (#683, Tools › Icons…), open on `icon` ('' for none picked yet). */
	iconsTool: null as { icon: string } | null,
	/** The doodad brush editor, full screen (components/DoodadBrushEditor.svelte). */
	brushEditor: false,
	/** The game Meld closes and opens around an export (Preferences › Game): Wow.exe or Benilla. */
	gameClient: 'wow' as 'wow' | 'benilla',
	/** How the game's window opens when Meld starts it (Preferences › Game): '' the game's own setting. */
	gameWindow: '' as '' | 'windowed' | 'fullscreen',
	gameResolution: '1280x720',
	/** The floating quick texture palette (components/TexturePaletteWindow.svelte): the map's textures to paint with. */
	texturePalette: false,
	/** The floating History window (components/HistoryWindow.svelte): the undo stack, a click goes to any step. */
	history: false,
	/** The floating Scripts window (components/ScriptWindow.svelte, #28, Tools › Scripts…): Lua scripts to write and run on the map. */
	scripts: false,
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
