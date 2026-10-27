import * as THREE from 'three'
import type { GenerateKind, Terrain } from '../terrain/Terrain'
import { CoastShape, presetById, snowLine, type ShapeOptions, type WorldWater } from '../terrain/presets'
import { LAKE_RULES, fillLakes, findLakes, shoreLevels } from '../water/lakes'
import { fbm } from './noise'
import { worldRules, type ZoneScatter } from '../wow/zoneTrees'
import type { ImageGround } from '../terrain/generate'
import { maskBytes, type TileSquare } from '../terrain/tileMask'
import { growSnapshot } from '../io/worldGrow'
import type { Command } from '../state/history'
import { MAX_BRUSH_RADIUS, docs, editor, logLine, setStatus, queueViewportHint, publishViewportHint, setViewportHint, stats, type ContextItem, type DetailInfo, type Prefs, type ToolId, ui, wow } from '../state/editor.svelte'
import { GLOBAL_UID, MapDocument, regionLabel, type Bookmark, type RegionRef, type VmangosRef } from './MapDocument'
import type { ExportInput } from '../io/vmangosExport'
import { type adt, type main, vmangos } from '../../../wailsjs/go/models'
import {
	cropLiquids,
	decodeLiquids,
	encodeLiquids,
	layLiquidCells,
	liquidKindsOf,
	liquidsFromAdt,
	liquidsToAdt,
	liquidType,
	raycastLiquids,
	regenOpacity,
	rememberLiquidKinds,
	type AdtLiquid,
	type LiquidClass,
	type LiquidClipCell,
} from '../water/liquids'
import { groundSlopeDeg } from '../world/groundTilt'
import { resetLiquidFrames, setLiquidFailHandler, setLiquidLight, updateLiquids, wmoLiquidMaterial } from '../water/liquidMaterial'
import { BAND, lightAt, newLightAt, sceneFog, type ClientLights } from '../wow/clientLight'
import { celestialSunDir, lightingSunDir, moonDir, skyWarp, starAlpha, sunDiscScale } from '../wow/dayNight'
import { MAP_TILES, TILE_CELLS, TILE_CHUNKS, TILE_YARDS } from '../wow/format'
import { LiquidStroke } from '../water/liquidStroke'
import { CameraController } from './CameraController'
import { cornerFactor, nearPlane, roomFloor } from './cameraMove'
import { Environment, SHADOW_FAR, SHADOW_NEAR, type ClientSky } from './Environment'
import { HorizonLayer } from '../world/HorizonLayer'
import { WorldStream } from '../world/WorldStream'
import { marchGround, streamReach } from '../world/worldGround'
import { worldCellDetail } from '../world/worldDetail'
import type { Tool, ToolContext } from '../tools/Tool'
import { brushImage } from '../tools/brushImage'
import { BrushTool, PaintTool, RoadTool, SculptTool, WaterTool, waterOpacityFactor } from '../tools/TerrainTools'
import { StampTool } from '../tools/StampTool'
import { pickLayer, pickModel, pickSpawn } from '../tools/PipetteTool'
import { TerrainStroke, brushCenter, paintPixel, type Rect } from '../tools/brush'
import { editWholeMask, modifyMask } from '../tools/maskWand'
import { ChunkDataStroke } from '../tools/chunkDataStroke'
import { copyPaths, type MapPath } from '../terrain/paths'
import { PathTool } from '../tools/PathTool'
import {
	areasFromImage,
	colourIndices,
	copyReference,
	dragCorner,
	dragTurn,
	fitPlace,
	heightsFromImage,
	maskFromImage,
	refHit,
	sameReference,
	texturesFromImage,
	type RefColour,
	type RefHeightMode,
	type ReferenceImage,
	type ReferencePlace,
} from '../terrain/referenceImage'
import { readReferenceFile, type LoadedReference } from '../io/referenceLoad'
import { areaCells, areaShape, objectsInArea, setAreaCells } from '../state/areaSelection'
import { INSIDE, cellsInRect } from '../terrain/areaShape'
import { growMask, shrinkMask } from '../terrain/maskSelect'
import { ShadowStroke } from '../tools/shadowStroke'
import { areaVertexWeights, erodePatch, settledMask, SETTLED_FULL, type ErodeSettings } from '../terrain/erodeArea'
import { fadeFromEdge, shapePatch, smoothPatch, type SmoothAreaSettings } from '../terrain/smoothArea'
import { modelCasters } from '../world/shadowCasters'
import { SHADOW_PER_CELL, packShadowBits, shadowBaker } from '../terrain/bakedShadows'
import { PlaceTool, SelectTool, groupTransformCommand, tiltDeg, transformCommand } from '../tools/ObjectTools'
import { addedCommand, removedCommand } from '../world/objectCommands'
import { EngineScriptHost } from './ScriptRun'
import type { ScriptResult } from '../script/scriptApi'
import { ScriptBrushes } from './ScriptBrushes'
import { ScriptBrushTool } from '../tools/ScriptBrushTool'
import { scriptSay } from '../script/scriptBrush.svelte'
import { loadScriptImage } from '../io/scriptImages'
import { HoleWalls } from '../tools/HoleWalls'
import { stepTilt } from '../world/placement'
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
import { copyObjects, copyRegion, pasteObjects, pasteRegion, type MapClip, type ObjectClip } from '../world/clipboard'
import { turnObjectClip } from '../world/clipTurn'
import { mirrorClip, rotateClip } from '../world/clipRotate'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import { LAYERS } from '../terrain/layers'
import { planRestore, restoreChunk } from '../terrain/restorePaint'
import {
	CHUNK_CELLS,
	MAX_PALETTE,
	NO_TEXTURE,
	SLOTS,
	SPLAT_PER_CELL,
	chunkTextures,
	clearPalette,
	compactChunk,
	convertGlobalLayers,
	findSlot,
	hasEmptySlot,
	mergeDuplicateSlots,
	paletteCoverage,
	paletteIndex,
	removeSlot,
	replaceInChunk,
	replacePalette,
	resetTexel,
} from '../terrain/chunkPaint'
import { isColor, retryFailedPalettes, setPaletteFailHandler } from '../terrain/paletteArray'
import { listAssets, setCompressedTextures, setMaxAnisotropy } from '../wow/api'
import { runMapChecks } from '../check/run'
import type { Finding } from '../check/findings'
import type { EdgeSegment } from '../check/terrainChecks'
import { loadAreas } from '../wow/areas'
import { animatedAssets, displayName, getAsset, type ModelAsset, releaseAssets, texturesBoundCount, updateMaterialAnimations, withParticleModels } from '../models/assets'
import { baseType, withDoodadSet } from '../models/wmoSet'
import { PropEffects } from '../world/PropEffects'
import { castsNear, clearNearCasters, materialsNear, setFarCascade, setNearCascade } from '../world/shadowReach'
import { PosedShadows } from './posedShadows'
import { drawFarLayers, farLayersLost, isFarLayerScene, setFarRenderer } from '../models/farLayers'
import { WmoRooms } from '../world/WmoRooms'
import { RETRY_MS } from '../wow/loadCache'
import { GROUND_SNAP_REACH } from '../world/particles'
import { RoomFlood, SKY_GROUP } from '../world/wmoFlood'
import { RoomFogFade } from '../world/wmoFog'
import { RoomAdmit } from '../world/roomAdmit'
import { addRoomGate, beginRoomGates, endRoomGates, ROOM_MAX_GATED, setRoomFog } from '../world/roomGate'
import { toModel } from '../world/wmoRoom'
import { ParticleLayer } from '../world/ParticleLayer'
import { CloudDome } from './CloudDome'
import { stormBlend, WEATHER_GRADE } from '../wow/weather'
import { WeatherLayer, type SplashGround } from '../world/WeatherLayer'
import { editorPoint, serverSpot, teleportCommand, wmoOnlyTiles, type ServerSpot } from '../io/portCoords'
import { AreaTriggerLayer, type TriggerShape } from '../world/areaTriggers'
import type { TaxiHooks, TaxiPick, TaxiRouteShape, TaxiStopShape } from '../world/TaxiLayer'
import type { Vec3 } from '../world/taxiRoute'
import { antialiasAtStart } from './display'
import { frameDue } from './frameLimit'
import { GPU_PASSES, PerfMeter, SECTION, topModels, type ModelCost, type PerfReport } from './perfMeter'
import { GpuTimer } from './gpuTimer'
import { GroupBoxes, ModelBoxes } from '../world/ModelBoxes'
import { isHelper } from '../models/helpers'
import { NavPreview, RANGE as NAV_RANGE, type PathResult, type ServerSource } from '../world/nav/NavPreview'
import type { MapInfo } from './MapDocument'
import { SelectionOutline, type OutlineTarget } from './SelectionOutline'
import { movableSelection, objectsInRect, publishMoved, selectObjects, selectedObjects, withGroups } from '../state/selection'
import { meanPivot, turnAbout } from '../world/pivot'
import { countHoles, fillHoles, snapToBlocks } from '../terrain/holes'
import { fitHeights, type FitOptions } from '../terrain/fitGround'

import { nearScreenBox } from '../world/screenBox'
import { TransformGizmo } from './TransformGizmo'
import type { CullView } from '../world/instanceCull'
import { spawnKey, spawnMatrix } from '../world/SpawnLayer'
import { pickNearest } from '../world/pickNearest'
import { InputsKey } from '../tools/inputsKey'
import { pickTrigger, triggerWins } from '../world/teleport'
import { teleportTo } from '../io/region'
import { SpawnActions } from './SpawnActions'
import { TaxiEditing } from './TaxiEditing'
import { GizmoDrag } from './GizmoDrag'
import { DocOverlay } from './docOverlay'
import { SpawnPaths } from '../world/SpawnPaths'
import { SpawnLinks } from '../world/SpawnLinks'
import type { SpawnChange } from '../world/formations'
import { poolMates } from '../world/pools'
import { selectSpawn, type SpawnFields } from '../world/spawnEdits'
import { AreaTriggers, CheckSpawnIDs, Factions, MapEntries, MapLights, RegionEdges, RegionHorizon, RegionInner, RegionShadows } from '../../../wailsjs/go/main/App'
import { base64ToBytes } from '../io/base64'
import { regionKey as regionKeyOf } from '../io/regionKey'
import { clampUiScale } from '../ui/uiScale'
import { copyItems, copyValue } from '../ui/copyId'
import { firstKeyOf, keysOf } from '../ui/commands'
import { yieldToFrame } from './yieldToFrame'

/** A world view's side (#15): the whole map, 64 tiles. */
const WORLD_SIDE = MAP_TILES * TILE_YARDS
/** How far the camera may back off the ground in a world view, in yards. */
const WORLD_MAX_DISTANCE = 2000
/** The cells a side of a world view's hidden stand-in terrain, which nothing reads but the tools' picking. */
const WORLD_STAND_IN = 8
/** The fewest frames between two redraws of a world view's far shadow map for a scene change (`markShadows`). */
const WORLD_FAR_FRAMES = 30
/** How far off the ground a world view opened without a view looks from, in yards. */
const WORLD_FOCUS_DISTANCE = 400

/** How many cells of level ground Fit ground keeps around a building before its ring (#210). */
const FIT_APRON_CELLS = 2

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
	/**
	 * A WMO-only map (#271): one building and no tiles. The heights are flat ground under it, which is
	 * hidden, `objects` is the building, and `bounds` its box (lowest corner, then highest).
	 */
	wmoOnly?: boolean
	bounds?: number[]
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

const NO_OBJECTS: readonly WorldObject[] = []

/** How far above the ground the top-down view's camera stands: over any building or mountain a map holds. */
const ORTHO_HEIGHT = 1500

/** The 3D camera's near plane (yd), and how far in it is pulled for a WMO wall closer than it reaches (#304). */
const NEAR = 0.5
const NEAR_MIN = 0.05

/** Straight down, for finding the ground below a point. */
const DOWN = new THREE.Vector3(0, -1, 0)
/** The dark earth below the ground with the sea off (the floor's colour in daylight), and what a map with no sky shows behind it at every hour (#339). */
const EARTH = new THREE.Color(0.05, 0.042, 0.035)
/** The portal flood's seeds for a building the camera is not in: its outside leg. */
const NO_SEEDS = { inGroup: null, across: null } as const
/** How far above an orbit target `playerSpot` looks down from, in yards: a floor up to this high over the terrain is stood on. */
const PLAYER_PROBE = 3
/** How far above the ground a launched character is put, in yards, so it never starts inside the surface. */
const PLAYER_LIFT = 0.5
/** How far, in screen pixels, around the selected spawn's box a right-click still opens its menu (#205). */
const CONTEXT_MARGIN = 24

/** A client tile's paint chunks a side (TILE_CELLS, a tile's cells, is the editor's map size for one tile). */
const TILE_PAINT_CHUNKS = TILE_CHUNKS

/** Models whose bounds cover fewer pixels than this are not drawn, with the preference on. */
const SMALL_MODEL_PX = 1.5
/** Props whose bounds cover fewer pixels than this are drawn with their LOD (see models/lod.ts), whose error is about 1% of that. */
const LOD_PX = 100

/** The world settings of Map Properties (`Engine.setWorldSettings`): any of them. */
export interface WorldSettings {
	waterEnabled?: boolean
	waterLevel?: number
	rock?: number
	dirt?: number
}

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
	/** The map's reference image (terrain/referenceImage.ts): its path and where it lies; null for none. */
	reference: ReferenceImage | null
	/** The map's paths (terrain/paths.ts), kept so they can be moved and applied again. */
	paths: MapPath[]
	heights: Uint8Array
	/** Four weights per splat texel (format 2). */
	weights: Uint8Array
	/** Four palette indices per paint chunk (format 2). */
	chunkSlots: Uint8Array
	/** One byte per cell, 1 for a hole (format 3). Empty for an older map. */
	holes: Uint8Array
	/** Whether `holes` is all of the region's holes (`MapDocument.holesKnown`), as `liquidsKnown` for the liquids. */
	holesKnown: boolean
	/** The liquids blob (format 4, see liquids.ts); null for an older map, which has none. */
	liquids: Uint8Array | null
	/**
	 * Whether `liquids` is all of the region's liquids (`MapDocument.liquidsKnown`). False for a map
	 * saved before format 4, and kept false across later saves (#525), when it holds only what was drawn.
	 */
	liquidsKnown: boolean
	/** The kind of each liquid ID past the base four that `liquids` uses (liquids.ts `liquidKindsOf`, #540). */
	liquidKinds?: Record<number, LiquidClass>
	/**
	 * Each chunk's AreaTable.dbc ID and flags, and a byte per cell where no tufts grow (format 5);
	 * null for an older map, which has none.
	 */
	chunkData: { areaIds: Uint32Array; chunkFlags: Uint8Array; noEffect: Uint8Array } | null
	/** Whether `chunkData` is the map's own (`MapDocument.chunkDataKnown`), as `liquidsKnown` for the liquids. */
	chunkDataKnown: boolean
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
	/** Redraws only the posed models into the near shadow map when nothing else in it changed (#346). */
	private posedShadows: PosedShadows
	private effects = new PropEffects()
	/** The WMO room the camera is in (`world/wmoRoom.ts`). */
	private rooms = new WmoRooms()
	private roomGround = (x: number, z: number): number | null => (this.terrain.contains(x, z) && !this.terrain.isHole(x, z) ? this.terrain.heightAt(x, z) : null)
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
	/** Lighting › Weather Preview's drops around the camera. */
	private weather = new WeatherLayer()
	/**
	 * Where the weather's drops land (#315: their roofs, the splashes, the settled flakes): the terrain,
	 * and the models' surfaces from a height down, each ray tested against only the models whose reach
	 * (a circle round each, kept by `near`) takes in its column, drawn or not, so a roof behind the
	 * camera still counts. Helpers are left out: the client never has them.
	 */
	private splashRay = new THREE.Ray()
	private splashNear: number[] = []
	private splashReach = new Float32Array(0)
	private splashIds: number[] = []
	private splashPos = new THREE.Vector3()
	private splashGround: SplashGround = {
		terrain: (x, z) => (this.terrain.contains(x, z) && !this.terrain.isHole(x, z) ? this.terrain.heightAt(x, z) : -Infinity),
		near: (x0, z0, x1, z1) => {
			const ids = this.splashNear
			ids.length = 0
			let reach = this.splashReach
			for (const o of this.objects.objects.values()) {
				if (isHelper(o.type)) continue
				const a = getAsset(o.type)
				if (!a.ready) continue
				const b = a.bbox
				// The farthest a corner reaches from the origin, however the model is turned.
				const r = Math.hypot(Math.max(-b.min.x, b.max.x), Math.max(-b.min.y, b.max.y), Math.max(-b.min.z, b.max.z)) * this.objects.worldScale(o)
				const p = this.objects.worldPosition(o, this.splashPos)
				if (p.x + r < x0 || p.x - r > x1 || p.z + r < z0 || p.z - r > z1) continue
				const k = ids.length * 3
				if (k + 3 > reach.length) {
					const grown = new Float32Array(Math.max(64, reach.length * 2))
					grown.set(reach)
					reach = this.splashReach = grown
				}
				reach[k] = p.x
				reach[k + 1] = p.z
				reach[k + 2] = r * r
				ids.push(o.id)
			}
		},
		models: (x, fromY, z) => {
			const near = this.splashNear
			const reach = this.splashReach
			const ids = this.splashIds
			let n = 0
			for (let i = 0; i < near.length; i++) {
				const dx = x - reach[i * 3]
				const dz = z - reach[i * 3 + 1]
				if (dx * dx + dz * dz <= reach[i * 3 + 2]) ids[n++] = near[i]
			}
			if (!n) return -Infinity
			this.splashRay.origin.set(x, fromY, z)
			this.splashRay.direction.copy(DOWN)
			return this.objects.raycastAmong(this.splashRay, ids, n)?.point.y ?? -Infinity
		},
		source: () => this.objects,
	}
	/** View › Bounding boxes: a box around every model. */
	private boxes = new ModelBoxes()
	/** The box around each selection group a selected model is in. */
	private groupBoxes = new GroupBoxes()
	/** The creatures' waypoint paths, for the active region. */
	readonly paths = new SpawnPaths()
	/** The selected creature's formation and, with View › Spawn pools, the pooled spawns' rings (#172). */
	readonly links = new SpawnLinks()
	/** The other spawns of the selected spawn's pool, outlined in the pool colour (#172). */
	private poolOutline = new SelectionOutline({ color: new THREE.Color(0.3, 0.75, 1) })
	private poolTargets: OutlineTarget[] = []
	private poolMatrices: THREE.Matrix4[] = []
	private poolBuiltFor: { layer: unknown; version: number; sel: unknown } = { layer: null, version: -1, sel: null }
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
	/**
	 * The frame clock: `frame()` advances it once (`update`), then reads the frame's delta and elapsed
	 * seconds. Not connected to the page's visibility, so a probe driving `frame()` in a hidden tab still
	 * sees time pass; `setTimescale(0)` holds it (the probes' frozen clock).
	 */
	readonly timer = new THREE.Timer()
	private raf = 0
	private frames = 0
	private statTime = 0
	/** View › Performance Overlay (#179): the frame's CPU time by subsystem, and its GPU passes. */
	private readonly meter = new PerfMeter()
	private gpu: GpuTimer
	/**
	 * Whether the browser took the viewport's WebGL context away (#209: a driver reset, the GPU process
	 * restarting, too many contexts). The frame loop idles and the offscreen renders wait or refuse
	 * until it is restored; three re-uploads geometry, textures and programs then by itself.
	 */
	contextLost = false
	private contextWaiters: Array<() => void> = []
	/** Help › Copy Performance Report waiting for the next window, with the overlay off. */
	private perfWaiters: Array<(r: PerfReport) => void> = []
	private resizeObs: ResizeObserver
	private outline = new SelectionOutline()
	/** Red marks (outline and tint) on the models the Clear tool's brush would delete (#131). */
	private doomOutline = new SelectionOutline({ color: new THREE.Color(1, 0.18, 0.15), fill: 0.32 })
	private doomTargets: OutlineTarget[] = []
	private doomMatrices: THREE.Matrix4[] = []
	/** View › Hover outline (#641): a faint white stroke round the model or spawn a Select click would pick. */
	private hoverOutline = new SelectionOutline({ color: new THREE.Color(1, 1, 1), opacity: 0.45 })
	/** The hover outline's target list: empty, or `hoverTarget`. */
	private hoverTargets: OutlineTarget[] = []
	private hoverTarget: OutlineTarget | null = null
	private hoverMatrix = new THREE.Matrix4()
	/** What the hover outline shows: a placed model's id or a spawn, both null for nothing (read by probe `hover-outline`). */
	readonly hovered: { id: number | null; spawn: vmangos.WorldSpawn | null } = { id: null, spawn: null }
	/** What the hover pick was last made for: the pointer, the camera, the objects, the spawns and the selection. */
	private hoverKey = new InputsKey()
	private clearTool = new ClearTool()
	/** The Path tool (#167), which the options bar reaches through `path`. */
	private pathTool = new PathTool()
	private spawnLabels: SpawnLabels
	private gizmo = new TransformGizmo()
	/** The drag of the selection's handles (GizmoDrag.ts). */
	private gizmoDrag: GizmoDrag
	/** Where a selected spawn's handles stand (updateSelectionVisuals). */
	private spawnGizmoAt = new THREE.Vector3()
	private tmpBox = new THREE.Box3()
	private otherBox = new THREE.Box3()
	private tmpV = new THREE.Vector3()
	private tmpM = new THREE.Matrix4()
	/** Merges a burst of key nudges on the same selection into a single undo step. */
	private nudgeSession: { key: string; before: WorldObject[]; cmd: Command; time: number } | null = null
	private selectTool: SelectTool
	/** Scratch for the outline: one target and matrix per selected model, reused each time it is built. */
	private outlineTargets: OutlineTarget[] = []
	private outlinePool: OutlineTarget[] = []
	private outlineMatrices: THREE.Matrix4[] = []
	/**
	 * What the selection's outline and handles were last built for (#551): `updateSelectionVisuals`
	 * builds them again only when one of these moved.
	 */
	private selBuiltFor = {
		layer: null as ObjectLayer | null,
		version: -1,
		terrain: null as Terrain | null,
		heights: -1,
		ids: null as readonly number[] | null,
		primary: undefined as number | undefined,
		nudge: false,
	}
	/** Where the handles of the selected models stand, kept between builds; `on` is false with no model selected. */
	private selGizmo = { on: false, group: false, at: new THREE.Vector3(), radius: 0, top: 0, scalable: true, yaw: 0 }
	private placeTool = new PlaceTool({ placeSpawn: (at, rotY) => this.spawnActions.placeSpawnAt(at, rotY), fitGround: (id, fit) => this.fitGroundUnder(id, fit) })
	private doodadTool = new DoodadBrushTool()
	/** The spawn editing (#557): placing, fields, paths, formations, pools, the spawn menu and keys. */
	private spawnActions: SpawnActions
	/** Accumulated Ctrl+wheel delta, so smooth trackpads rotate in steps too. */
	private wheelAcc = 0
	/** Which modifier the accumulated wheel delta belongs to, so a remainder never carries over to the other. */
	private wheelMod = ''
	/** Z is held: the wheel tilts the selected models or the placement preview (Shift: rolls), #344. */
	private tiltHeld = false
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
	/** The two shadowed sun lights `cullInstances` walks, set once the environment is built. */
	private shadowLights: THREE.DirectionalLight[] = []
	/** The water brush's ring for `updateLiquids`, filled each frame rather than built. */
	private liquidRing = { x: 0, y: 0, z: 0, radius: 0 }
	/** The selected spawn whose key `spawnKeyOf` keeps, so a held selection doesn't build its string each frame. */
	private keyedSpawn: { kind: string; guid: number } | null = null
	private keyedSpawnKey = ''

	constructor(
		private canvas: HTMLCanvasElement,
		private container: HTMLElement,
	) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: antialiasAtStart(), powerPreference: 'high-performance' })
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
		this.renderer.toneMapping = THREE.NoToneMapping
		this.renderer.outputColorSpace = THREE.SRGBColorSpace

		this.persp = new THREE.PerspectiveCamera(55, 1, NEAR, 5000)
		this.scene.background = new THREE.Color()
		this.renderer.shadowMap.enabled = true
		this.renderer.shadowMap.type = THREE.PCFShadowMap
		// Far WMOs' textures are drawn into a layer array with it (#691).
		setFarRenderer(this.renderer)
		this.gpu = new GpuTimer(this.renderer.getContext())
		// three's own listeners (added in its constructor, so run first) keep the context restorable and
		// rebuild its state; these pause the editor around it.
		canvas.addEventListener('webglcontextlost', () => this.onContextLost(), { signal: this.abort.signal })
		canvas.addEventListener('webglcontextrestored', () => this.onContextRestored(), { signal: this.abort.signal })
		this.env = new Environment(this.scene)
		this.shadowLights = [this.env.key, this.env.far]
		this.posedShadows = new PosedShadows(this.renderer, this.env.key)
		// After PosedShadows, so the timing wraps its passes and copies too.
		this.timeShadowMaps()
		this.scene.add(this.horizon.mesh)
		this.scene.add(this.effects.group)
		this.scene.add(this.particles.group)
		this.scene.add(this.clouds.mesh)
		this.scene.add(this.weather.group)
		this.scene.add(this.boxes.lines, this.groupBoxes.lines)
		this.scene.add(this.paths.group)
		this.scene.add(this.links.group)
		this.scene.add(this.triggerLayer.group)
		this.scene.add(this.nav.group)

		const aniso = this.renderer.capabilities.getMaxAnisotropy()
		setMaxAnisotropy(aniso)
		// The client's DXT textures go to the GPU compressed where it samples S3TC, sRGB included (#178);
		// the dev page opened with `?nodxt` keeps them RGBA, to compare.
		const ext = this.renderer.extensions
		const noDxt = /[?&]nodxt(?:[&=]|$)/.test(location.search)
		setCompressedTextures(!noDxt && ext.has('WEBGL_compressed_texture_s3tc') && ext.has('WEBGL_compressed_texture_s3tc_srgb'))
		// The camera rides on the water surface where the ground is submerged.
		this.controller = new CameraController(this.persp, canvas, (x, z) => {
			// A world view's ground is its streamed tiles; where none is loaded yet the camera keeps its height.
			const world = this.doc?.world
			if (world) {
				const g = world.heightAt(x, z)
				return Number.isNaN(g) ? this.controller.target.y : g
			}
			const h = this.terrain.heightAt(x, z)
			return editor.waterEnabled ? Math.max(h, editor.waterLevel) : h
		})
		// Camera collision keeps the eye off the WMOs' faces by the near plane's reach to a corner, so no
		// wall is ever clipped away (#305).
		this.controller.collideWalls = (from, to) => this.rooms.collide(this.objects, from, to, NEAR * this.cornerFactor())
		// In a WMO's room (last frame's probe) it stays above the WMO's floor instead of the terrain, which
		// in Stormwind runs both above and below the streets; elsewhere above the higher of the two, so a
		// roof is a floor too (#310). After a jump (a scene, a teleport) the probe runs for the new eye first.
		this.controller.collisionFloor = (at, ground, jumped) => {
			if (jumped) this.rooms.update(this.objects, at, this.roomGround)
			return roomFloor(!!this.rooms.current, this.rooms.floorAt(this.objects, at), ground)
		}
		// A WMO whose room data failed has no rooms, walls or floor until its retry (#515): say so, and log it.
		this.rooms.navs.onFail = (path, err) => setStatus(`Building rooms: ${path} didn't load, so the camera passes through its walls (tried again in ${RETRY_MS / 1000} s): ${err instanceof Error ? err.message : err}`, 8000)
		// A palette texture the client could not serve stays grey: say so, and ask again on a reconnect (#544).
		setPaletteFailHandler((path, err) => setStatus(`Paint texture ${path} didn't load, so its layer stays grey: ${err instanceof Error ? err.message : err}`, 8000))
		// A liquid frame that failed leaves its water black; asked again on a reconnect (#726).
		setLiquidFailHandler((path, err) => setStatus(`Liquid frame ${path} didn't load, so that liquid draws black: ${err instanceof Error ? err.message : err}`, 8000))
		// A model whose collision failed is left out of the walkable ground; the status line counts them.
		this.nav.collisions.onFail = (path, err) => logLine(`Walkable ground: the collision of ${path} didn't load: ${err instanceof Error ? err.message : err}`)

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this
		this.spawnActions = new SpawnActions({
			get documents() {
				return self.documents
			},
			get doc() {
				return self.doc
			},
			get cameraPos() {
				return self.camera.position
			},
			get menuSeq() {
				return self.menuSeq
			},
			focus: (x, z, distance) => self.controller.focus(x, z, distance),
			deselect: () => self.deselect(),
			teleport: (dest, what) => void teleportTo(self, dest, what),
		})
		this.taxi = new TaxiEditing({
			get doc() {
				return self.doc
			},
			get camera() {
				return self.camera
			},
			get persp() {
				return self.persp
			},
			get raycaster() {
				return self.raycaster
			},
			get ndc() {
				return self.ndc
			},
			get controller() {
				return self.controller
			},
			get timer() {
				return self.timer
			},
			openMapId: () => self.openMapId(),
			surfaceHit: () => self.surfaceHit(),
			sceneView: () => self.sceneView(),
			setSceneView: (v) => self.setSceneView(v),
		})
		this.gizmoDrag = new GizmoDrag({
			gizmo: self.gizmo,
			get raycaster() {
				return self.raycaster
			},
			get camera() {
				return self.camera
			},
			get ndc() {
				return self.ndc
			},
			get ortho() {
				return self.ortho
			},
			get topDown() {
				return self.topDown
			},
			get objects() {
				return self.objects
			},
			get spawnLayer() {
				return self.doc.spawnLayer
			},
			get terrain() {
				return self.terrain
			},
			get history() {
				return self.history
			},
			setCursor: (cursor) => {
				self.canvas.style.cursor = cursor
			},
			canNudge: () => self.canNudge(),
			selectedObject: () => self.selectedObject(),
			selectionPivot: (targets) => self.selectionPivot(targets),
		})
		this.scene.add(this.taxi.layer.group)
		this.ctx = {
			get terrain() {
				return self.terrain
			},
			get spawns() {
				return self.doc.spawnLayer
			},
			get paths() {
				return self.paths
			},
			get objects() {
				return self.objects
			},
			get history() {
				return self.history
			},
			get liquids() {
				return self.doc.liquids
			},
			get scene() {
				return self.scene
			},
			get raycaster() {
				return self.raycaster
			},
			holeWalls: new HoleWalls(),
			surface: (exclude?: Set<number>) => self.surfaceHit(exclude),
			floor: (exclude?: Set<number>) => self.floorHit(exclude),
			pressure: () => (self.prefs?.tabletSupport ? self.penPressure : 1),
			radiusPressure: () => self.radiusPressure(),
			cameraYaw: () => self.controller.yaw,
		}

		this.selectTool = new SelectTool({
			clipSize: () => (this.clip && this.lastCopied === 'area' ? { w: this.clip.w, h: this.clip.h } : null),
			objectClip: () => (this.lastCopied === 'objects' ? this.objectClip : null),
			commitPaste: () => this.commitPaste(),
			cancelPaste: () => this.cancelPaste(),
			placeSpawn: (at) => this.spawnActions.placeSpawnAt(at),
			pickSpawn: (o) => this.spawnActions.pickSpawn(o),
		})
		this.doodadTool.spawns = new SpawnBrushTool({
			newCreature: (e, x, y, z, o) => this.spawnActions.brushCreature(e, x, y, z, o),
			ghostType: (e) => {
				const look = this.spawnActions.brushLook(e)
				return look ? spawnType({ model: look.model, look: look.look, anim: look.anim }) : ''
			},
			ghostScale: (e) => e.scale * (this.spawnActions.brushLook(e)?.displayScale || 1),
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
			path: this.pathTool,
			script: new ScriptBrushTool(this.scriptBrushes),
		}

		// The arrows nudge the selection, or in the Place tool offset the preview from the cursor.
		this.controller.arrowsBlocked = () => this.canNudge() || (editor.tool === 'place' && !!editor.prefab && !editor.placeScatter)
		this.controller.wheelBlocked = (e) =>
			this.tiltScrolls() || (editor.tool === 'place' && (e.ctrlKey || e.shiftKey)) || (editor.tool === 'doodad' && e.ctrlKey) || (this.brushSizable() && e.ctrlKey) || (ui.pasting && this.lastCopied === 'objects' && e.ctrlKey)
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
			.catch((err) => console.warn('faction reactions not read', err))
		this.resize()
		this.newDocument(256, 'ocean', 0)
	}

	// ---------------------------------------------------------------- lifecycle

	start() {
		this.timer.reset()
		let last = -Infinity
		const loop = (now: number) => {
			this.raf = requestAnimationFrame(loop)
			// Graphics › FPS limit (#24): a frame waits for its interval; the timer's next delta covers the skipped ones.
			if (!frameDue(now, last, this.prefs?.fpsLimit ?? 0)) return
			last = now
			if (!this.contextLost) this.frame()
		}
		loop(performance.now())
	}

	/** Stops the loop `start` began; `frame()` still draws when called. The probes' page drives its own frames (#233). */
	stopLoop() {
		cancelAnimationFrame(this.raf)
	}

	private onContextLost() {
		this.contextLost = true
		setStatus('The graphics card dropped the viewport (a driver reset or too many 3D views). Waiting for it to come back…', 0)
	}

	/** Redraws what is drawn once and kept: the shadow maps, and the GPU timer's queries on the new context. */
	private onContextRestored() {
		this.contextLost = false
		// The old timer's queries died with the context, so it is dropped rather than disposed.
		this.gpu = new GpuTimer(this.renderer.getContext())
		// Every shadow map is redrawn at once: a point light's cube map that has no texture on the new
		// context fails every draw that samples it (GL_INVALID_OPERATION), and the light pool redraws only
		// one a frame, and never a light no source holds.
		this.scene.traverse((o) => {
			if ((o as THREE.Light).isLight && o.castShadow) (o as THREE.PointLight).shadow.needsUpdate = true
		})
		for (const d of this.documents) d.terrain.contextRestored()
		farLayersLost()
		// The time the context was lost advances `elapsed` but is not the next frame's delta.
		this.timer.update()
		setStatus('The viewport is back.', 4000)
		for (const w of this.contextWaiters.splice(0)) w()
	}

	/** Resolves once the viewport has a WebGL context, at once unless it is lost. */
	contextReady(): Promise<void> {
		if (!this.contextLost) return Promise.resolve()
		return new Promise((res) => this.contextWaiters.push(res))
	}

	dispose() {
		cancelAnimationFrame(this.raf)
		this.abort.abort()
		this.resizeObs.disconnect()
		this.controller.dispose()
		this.outline.dispose()
		this.doomOutline.dispose()
		this.hoverOutline.dispose()
		this.spawnLabels.dispose()
		this.env.dispose()
		this.posedShadows.dispose()
		this.horizon.dispose()
		this.effects.dispose()
		this.particles.dispose()
		this.clouds.dispose()
		this.weather.dispose()
		this.boxes.dispose()
		this.groupBoxes.dispose()
		this.paths.dispose()
		this.links.dispose()
		this.poolOutline.dispose()
		for (const d of this.documents) d.dispose()
		this.triggerLayer.dispose()
		this.taxi.dispose()
		this.nav.dispose()
		this.gpu.dispose()
		setFarRenderer(null)
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
		this.hoverOutline.setSize(buf.x, buf.y)
		this.poolOutline.setSize(buf.x, buf.y)
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
			o.left = -shot.halfX
			o.right = shot.halfX
			o.top = shot.halfZ
			o.bottom = -shot.halfZ
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
		// The spawn brush stands its creatures on the floor under the cursor, a cave's or a dungeon's too (#660).
		if (editor.tool === 'doodad' && editor.doodadMode === 'creatures') {
			const f = this.floorHit()
			this.hit = f ? this.hitVec.copy(f.point) : null
		}
		// Under the ground the march meets the ground at the camera itself, so the Place tool aims at the
		// model surface (or floor) under the cursor instead, a cave's or a dungeon's.
		if (editor.tool === 'place' && this.hit && this.terrainSeeThrough()) {
			const s = ui.placeCreature || ui.placeObject ? this.floorHit() : this.surfaceHit()
			this.hit = s ? this.hitVec.copy(s.point) : null
		}
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
		window.addEventListener('blur', () => (this.altHeld = this.tiltHeld = false), sig)
		// Z held turns the wheel into tilt; not while typing (a z in a text field) or with Ctrl (undo).
		window.addEventListener(
			'keydown',
			(e) => {
				if (e.code !== 'KeyZ' || e.ctrlKey || e.metaKey || e.altKey) return
				const t = e.target as HTMLElement | null
				if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
				this.tiltHeld = true
			},
			sig,
		)
		window.addEventListener('keyup', (e) => e.code === 'KeyZ' && (this.tiltHeld = false), sig)
		// Z+scroll tilts the selected models, or the placement preview, 5° per notch (Shift+Z+scroll rolls them).
		// Ctrl+scroll rotates the placement preview (15° per notch), Shift+scroll scales it. Its height is
		// PgUp / PgDn and its offset the arrows (PlaceTool.onKey): Alt is the pipette, so Alt+scroll clashed.
		c.addEventListener(
			'wheel',
			(e) => {
				if (this.tiltScrolls()) {
					if (this.wheelMod !== 'tilt') {
						this.wheelMod = 'tilt'
						this.wheelAcc = 0
					}
					// Shift+wheel may arrive as a sideways scroll (deltaX).
					const d = e.deltaY || e.deltaX
					this.wheelAcc += e.deltaMode === 1 ? d * 33 : d
					while (Math.abs(this.wheelAcc) >= 100) {
						const dir = Math.sign(this.wheelAcc)
						this.wheelAcc -= dir * 100
						if (this.canNudge()) this.tiltSelected(-dir * 5, e.shiftKey)
						else this.placeTool.tiltPreview(-dir * 5, e.shiftKey)
					}
					return
				}
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
				// A world view is looked at, not edited (#15): Edit Here opens a block for the tools.
				if (this.doc.world) return
				// The path test (View › Test a Path) takes the clicks before any tool.
				if (this.navPick) {
					const s = this.surfaceHit()
					if (s) this.navPathPoint(s.point)
					return
				}
				try {
					c.setPointerCapture(e.pointerId)
				} catch {
					// A synthetic event (the probes' P.click) has no pointer to capture.
				}
				// The Flight Paths window takes a click on a stop or a route point, or one that draws a point.
				if (this.taxi.press(e)) return
				// While the reference image is being placed, the top-down view's presses drag it (#184).
				if (this.referencePress(e)) return
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
				this.trigDown = editor.tool === 'select' ? { id: this.triggerUnderPointer(), x: e.clientX, y: e.clientY } : null
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
				if (this.gizmoDrag.active) {
					this.updateGizmoDrag(e.shiftKey)
					return
				}
				if (this.taxi.dragging) {
					this.taxi.moveDrag()
					return
				}
				if (this.refDrag) {
					this.moveReferenceDrag(e)
					return
				}
				this.referenceHover()
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
				if (e.button === 0 && this.gizmoDrag.active) {
					this.endGizmoDrag()
					return
				}
				if (e.button === 0 && this.taxi.dragging) {
					this.taxi.endDrag()
					return
				}
				if (e.button === 0 && this.refDrag) {
					this.endReferenceDrag()
					return
				}
				if (e.button !== 0 || !this.leftDown) return
				this.leftDown = false
				this.updatePointer(e)
				this.pick()
				this.activeTool?.onUp?.(this.ctx, this.hit, e)
				if (editor.tool === 'paint') this.refreshMaskState()
				this.finishTriggerClick(e)
			},
			sig,
		)
	}

	/** The Select tool's press: the trigger under it (null when none) and where, to tell a click from a drag (#307). */
	private trigDown: { id: number | null; x: number; y: number } | null = null

	/** The area trigger a ray from the pointer picks while they are drawn, by the right-click's rule (#307). */
	private triggerUnderPointer(): number | null {
		const layer = this.triggerLayer
		if (!layer.group.visible) return null
		this.raycaster.setFromCamera(this.ndc, this.camera)
		const ray = this.raycaster.ray
		const trig = pickTrigger(layer.triggers, ray.origin, ray.direction, layer.tileX, layer.tileY)
		if (!trig) return null
		const picked = pickNearest(this.objects, this.doc.spawnLayer, this.raycaster)
		return triggerWins(trig, picked.spawn ? 'spawn' : picked.id !== null ? 'model' : null, picked.distance) ? trig.trigger.id : null
	}

	/** Selects an area trigger (null for none) in the layer and for the Portals dialog, which follows ui.pickedTrigger. */
	selectTrigger(id: number | null) {
		this.triggerLayer.select(id)
		ui.pickedTrigger = id
	}

	/** A Select-tool click that did not drag picks the trigger under it, or lets go of the picked one. */
	private finishTriggerClick(e: PointerEvent) {
		const d = this.trigDown
		this.trigDown = null
		if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || !this.triggerLayer.group.visible) return
		if (d.id !== null) {
			selectObjects(this.objects, [])
			selectSpawn(null)
		}
		if (d.id !== this.triggerLayer.selected) this.selectTrigger(d.id)
	}

	/** Forward a key to the active tool. Returns true if handled. */
	handleToolKey(e: KeyboardEvent): boolean {
		if (this.doc.world) return false
		return this.activeTool?.onKey?.(this.ctx, e) ?? false
	}

	// ---------------------------------------------------------------- frame

	private syncTool() {
		if (this.activeToolId === editor.tool) return
		if (this.leftDown) {
			this.activeTool?.onUp?.(this.ctx, this.hit)
			this.leftDown = false
		}
		this.activeTool?.deactivate?.(this.ctx)
		if (editor.tool !== 'select' && editor.tool !== 'place') selectObjects(this.objects, [])
		this.activeToolId = editor.tool
		this.activeTool = this.tools[editor.tool]
		this.activeTool.activate?.(this.ctx)
	}

	/** One frame of the loop: `simulate` readies the scene for the view, `draw` draws it, and the stats are published. */
	private frame() {
		this.timer.update()
		const dt = Math.min(this.timer.getDelta(), 0.1)
		const time = this.timer.getElapsed()
		const m = this.meter
		m.setOn(!!this.prefs?.perfOverlay || this.perfWaiters.length > 0)
		// The overlay starts on "Measuring…" the next time, not on old numbers.
		if (!this.prefs?.perfOverlay && stats.perf) stats.perf = null
		m.begin()
		if (m.on) this.gpu.poll()
		this.simulate(dt, time)
		this.draw(dt)
		const calls = this.drawnCalls
		const triangles = this.drawnTriangles
		if (m.end()) this.publishPerf(calls, triangles)

		this.frames++
		if (time - this.statTime >= 0.5) {
			stats.fps = Math.round(this.frames / (time - this.statTime))
			stats.drawCalls = calls
			stats.triangles = triangles
			stats.objects = this.objects.objects.size
			// A world view's pick aims at its hidden stand-in, so its streamed ground under the cursor is found here.
			const world = this.doc.world
			const at = world ? this.worldCursor() : this.hit
			stats.cursor = at ? { x: at.x, y: at.y, z: at.z } : null
			stats.detail = !this.prefs?.detailInfo ? null : world ? this.worldDetailInfo(at) : this.detailInfo()
			const hoverArea = editor.tool === 'mapdata' ? this.hoverArea() : ''
			if (stats.hoverArea !== hoverArea) stats.hoverArea = hoverArea
			const c = this.controller
			stats.view = ui.minimap ? { x: c.target.x, z: c.target.z, yaw: c.yaw, cells: this.terrain.size, world: this.terrain.worldSize } : null
			this.frames = 0
			this.statTime = time
		}
	}

	/** `spawnKey(s)`, kept while the same spawn object stays selected (a held selection asks every frame). */
	private spawnKeyOf(s: { kind: string; guid: number }) {
		if (s !== this.keyedSpawn) {
			this.keyedSpawn = s
			this.keyedSpawnKey = spawnKey(s)
		}
		return this.keyedSpawnKey
	}

	/** The scene's draw calls and triangles of the last `draw`, before its outline passes. */
	private drawnCalls = 0
	private drawnTriangles = 0

	/**
	 * Readies everything the next draw shows from `this.camera`: the camera and sky, picking and the
	 * tool, the uniforms, the terrain, objects, lights and rooms, culling, animation and particles, the
	 * selection visuals and which shadow maps to redraw. It draws nothing, so `renderTopDown` runs it for
	 * a shot's ortho camera and then draws only the shot (#554). `dt` 0 leaves what moves where it is.
	 */
	private simulate(dt: number, time: number) {
		const m = this.meter
		this.syncTool()
		this.controller.setWalk(ui.walkCamera && !this.topDown)
		this.controller.update(dt)
		this.updateWorld()
		this.taxi.updateFlight()
		this.updateTopDown()
		this.updateEnvironment(dt, time)
		m.mark(SECTION['Camera and sky'])

		if (this.sizeDrag) this.hit = this.hitVec.copy(this.sizeDrag.hit)
		else if (this.pointerInside && !this.controller.isDragging) {
			// Locked cursor (Noggit Red's): a brush's ground point stays put while the camera moves, and
			// follows only the mouse. The other tools still pick under the cursor every frame.
			if (!(this.prefs?.lockedCursor && this.activeTool?.usesBrush && this.hit && !this.pointerMoved)) this.pick()
			this.pointerMoved = false
		} else if (!this.leftDown) this.hit = null
		this.updatePipetteCursor()
		m.mark(SECTION.Picking)

		const tool = this.activeTool!
		if (this.leftDown) tool.tick?.(this.ctx, dt, this.hit)
		this.placeTool.hidePreview = this.altHeld
		tool.frame?.(this.ctx, this.hit)
		// A drag moves models on every pointer move; the Inspector's copy follows once a frame.
		publishMoved(this.objects)
		publishViewportHint()
		m.mark(SECTION.Tool)

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
		this.updateNav()
		u.contourStep.value = this.prefs?.showContours ? this.prefs.contourStep : 0
		u.chunkLineWorld.value = editor.chunkLines ? CHUNK_CELLS * this.terrain.cellSize : 0
		this.updateHoverChunk(u.chunkHover.value as THREE.Vector4)
		const md = editor.mapDataMode
		this.terrain.setMapDataOverlay(editor.tool !== 'mapdata' ? 0 : md === 'area' ? 1 : md === 'impassable' ? 2 : md === 'noTufts' ? 3 : 4)
		this.terrain.setMapDataZone(editor.mapDataClear ? 0 : editor.mapDataArea)
		// Strong red while editing the mask; faint while painting so results stay visible.
		const painting = editor.tool === 'paint' || editor.tool === 'road'
		u.maskVisible.value = !painting ? 0 : editor.tool === 'paint' && editor.paintMode === 'mask' ? 0.45 : ui.maskActive ? 0.15 : 0
		this.updateSelectionUniforms(time)
		this.updateReference()
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
			retryFailedPalettes()
		}
		let ring: typeof this.liquidRing | null = null
		if (editor.tool === 'water' && editor.waterMode === 'paint' && this.hit) {
			ring = this.liquidRing
			ring.x = this.hit.x
			ring.y = this.hit.y
			ring.z = this.hit.z
			ring.radius = editor.brush.radius
		}
		updateLiquids(time * 1000, this.hour, wow.loaded, ring, this.env.state.keyDir)
		m.mark(SECTION['Uniforms and water'])

		this.terrain.update(this.renderer)
		m.mark(SECTION.Terrain)
		// A hidden object can't stay selected once hidden objects stop being drawn.
		if (this.objects.setShowHidden(ui.showHiddenModels) && editor.selectedIds.some((id) => this.objects.isHidden(id))) {
			selectObjects(
				this.objects,
				editor.selectedIds.filter((id) => !this.objects.isHidden(id)),
				editor.selected?.id,
			)
		}
		this.objects.update()
		this.boxes.update(this.objects, this.prefs?.showBoxes === true, this.terrain.heightsVersion)
		this.updateTriggers()
		this.taxi.update(this.prefs?.showFlightPaths === true, this.topDown)
		this.groupBoxes.update(this.objects, editor.selectedIds, this.terrain.heightsVersion, ui.historyVersion)
		m.mark(SECTION.Objects)
		// Lights first: culling keeps what can throw the shadowed lights' shadows.
		this.effects.enabled = this.prefs?.propEffects !== false
		this.effects.particles = this.prefs?.particles !== false
		this.effects.update(this.objects, time, this.controller.target, this.env.state.night, this.terrain.heightsVersion)
		this.updateClientPoints()
		m.mark(SECTION['Lights and flames'])
		this.rooms.update(this.objects, this.camera.position, this.roomGround)
		this.updateNear()
		// The room gate and the culling both read this frame's view-projection; the camera has stopped moving.
		this.camera.updateMatrixWorld()
		this.viewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
		this.viewFrustum.setFromProjectionMatrix(this.viewProj)
		this.updateRoomGate(dt)
		m.mark(SECTION['WMO rooms'])
		this.cullInstances()
		m.mark(SECTION.Culling)
		this.updateGroundEffects()
		// The water and the tufts show through a room's doorways only, as the rest of the world (#119).
		const gate = this.cullView.gate ?? null
		this.doc.groundEffects.gate(gate)
		this.doc.liquidRenderer.gate(gate)
		this.water.gate(gate)
		m.mark(SECTION['Ground effects'])
		this.updateBakedShadows()
		const sel = editor.selectedSpawn
		this.paths.update(this.doc.spawnLayer, sel ? this.spawnKeyOf(sel) : null, editor.selectedWaypoint, !!this.prefs?.showAllPaths)
		this.links.update(this.doc.spawnLayer, sel, !!this.prefs?.showPools)
		m.mark(SECTION['Paths and baked shadows'])
		this.animateModels(time)
		m.mark(SECTION.Animation)
		this.updateParticles(dt, time)
		this.updateWeather(time)
		m.mark(SECTION.Particles)
		this.updateSelectionVisuals()
		this.updateDoomVisuals()
		this.updatePoolVisuals()
		this.updateHoverVisuals()
		m.mark(SECTION['Selection visuals'])
		this.markShadows()
	}

	/** Draws what `simulate` readied to the canvas: the scene, the spawn labels and the outline passes. */
	private draw(dt: number) {
		const m = this.meter
		// The far WMOs' texture layers that came in since the last frame (#691).
		drawFarLayers()
		if (m.on) this.gpu.begin(1)
		this.renderer.render(this.scene, this.camera)
		m.mark(SECTION['Render (CPU)'])
		this.spawnLabels.update(this.doc.spawnLayer, this.camera, this.camera.position, this.container.clientWidth, this.container.clientHeight, dt)
		m.mark(SECTION['Spawn labels'])
		// The counters describe the last render call, so read the scene's before the outline passes.
		this.drawnCalls = this.renderer.info.render.calls
		this.drawnTriangles = this.renderer.info.render.triangles
		if (m.on) this.gpu.begin(2)
		this.hoverOutline.render(this.renderer, this.camera)
		this.outline.render(this.renderer, this.camera)
		this.doomOutline.render(this.renderer, this.camera)
		this.poolOutline.render(this.renderer, this.camera)
		if (m.on) this.gpu.endFrame()
		m.mark(SECTION.Outlines)
	}

	/**
	 * Draws only the models and spawns in view: inside the camera's frustum, or the shadow camera's so
	 * what is just off screen still throws its shadow into view, and (by preference) large enough on
	 * screen to see.
	 */
	private cullInstances() {
		const v = this.cullView
		v.frustums.length = 0
		v.frustums.push(this.viewFrustum)
		v.camera = this.camera
		v.shadowCamera = null
		v.shadowFrustum = null
		for (const light of this.shadowLights) {
			if (!light.castShadow) continue
			light.updateMatrixWorld()
			// The cull wants the frustum of the live light, but the lookup matrix must stay the one its map
			// was drawn with (#366): the light follows the sun's live direction between redraws, and three
			// sets the matrix again only when it redraws the map.
			const shadow = light.shadow
			this.drawnShadowMatrix.copy(shadow.matrix)
			shadow.updateMatrices(light)
			shadow.matrix.copy(this.drawnShadowMatrix)
			v.frustums.push(shadow.getFrustum())
		}
		// The near cascade (the key light's own map) is redrawn on most changes, so a big WMO culls its groups for it too.
		if (this.env.key.castShadow) {
			v.shadowCamera = this.env.key.shadow.camera
			v.shadowFrustum = this.env.key.shadow.getFrustum()
		}
		// The near pass draws a batch only with a drawn instance in its box (#325); the far pass draws
		// every batch with one packed, and the scene pass only those with one in view (#15).
		setNearCascade(v.shadowFrustum)
		setFarCascade(this.env.far.castShadow ? this.env.far.shadow.getFrustum() : null)
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
				const x0 = w[i * 4],
					y0 = w[i * 4 + 1],
					x1 = w[i * 4 + 2],
					y1 = w[i * 4 + 3]
				const sx = x1 - x0,
					sy = y1 - y0
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
		// A world view draws the doodads as far as the game does (#15); a region keeps every one in sight to edit.
		v.doodadReach = !!this.doc.world
		this.objects.cull(v)
		// Spawns show through a room's walls by preference (#150): the camera often sits inside a building
		// while the author works on the creatures around it.
		const gate = v.gate
		if (this.prefs?.spawnsThroughWalls !== false) v.gate = null
		this.doc.spawnLayer.cull(v)
		v.gate = gate
	}

	/**
	 * Plays the idle animations of the model types in view: those with a placed or spawned instance the
	 * cull drew (in the camera's or a shadow camera's frustum), the placement and brush previews, and
	 * (while pasting) the paste's previews. Posing runs on the CPU per model type, so types off screen,
	 * loaded for other tabs or drawn nowhere cost nothing; one coming into view is posed on that frame (#328).
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
		// A pose, or a moving material whose shadow changed, of a model in the near cascade's box redraws
		// the moving models into that map (#326, #346).
		if (updateMaterialAnimations(ms) && materialsNear()) this.nearPosed = true
		for (const [type, a] of animatedAssets) {
			if (still && a.anim!.posedAt === 0) continue
			if (ui.pasting || type === prefab || (doodads && this.doodadTool.previewing(type)) || this.objects.hasVisible(type) || spawns.drawsType(type)) {
				a.anim!.update(ms)
				if (a.skeleton && castsNear(a.skeleton)) this.nearPosed = true
			}
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
		p.update(
			this.objects,
			this.doc.spawnLayer,
			dt,
			this.prefs?.animations === false ? 0 : time * 1000,
			this.camera,
			this.viewFrustum,
			this.cullView.gate ?? null,
			this.rooms.current?.id ?? -1,
			this.prefs?.spawnsThroughWalls !== false,
			this.cullView.gateAdmits ?? null,
		)
	}

	/**
	 * Pulls the near plane in while the eye is closer to a WMO's wall than it reaches (#304), so the
	 * wall is not clipped away: with the room gate on, the flood rightly draws nothing behind a wall
	 * with no portal, so the clipped part showed the sky. Every point in the view frustum at depth z
	 * lies within z·k of the eye, so a near plane at the wall's distance over k clips none of it. The
	 * client never meets this, as its camera collides with the WMO, and nor does Meld's with Camera
	 * collision on (#305, `cameraRadius`). Far off, the closer plane costs depth precision, so it is used
	 * only while a wall is that close.
	 */
	/** How much further than its depth a point in the view frustum can lie from the eye: at a corner of the near plane. */
	private cornerFactor() {
		return cornerFactor(this.persp.fov, this.persp.aspect)
	}

	private updateNear() {
		const p = this.persp
		const near = nearPlane(this.rooms.wallDist, this.cornerFactor(), NEAR, NEAR_MIN)
		if (Math.abs(near - p.near) < 1e-3) return
		p.near = near
		p.updateProjectionMatrix()
	}

	private applyViewDistance() {
		const w = this.terrain.worldSize
		const d = this.viewDistance
		this.fogNear = w * 0.5 * d
		this.fogFar = w * 2.2 * d
		if (this.doc?.world) {
			// A world view's ground ends at the reach it streams to (#15): the fog closes in on it there.
			this.fogFar = streamReach(d)
			this.fogNear = this.fogFar * 0.35
			this.persp.far = this.fogFar * 1.5
			this.scene.fog = this.fogEnabled && !this.topDown ? new THREE.Fog(this.env.state.horizon.clone(), this.fogNear, this.fogFar) : null
			this.persp.updateProjectionMatrix()
			return
		}
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
		// A map with no sky (#339) shows the earth's colour behind it instead of the dome, at every pitch and
		// hour, and the editor's fog fades into it; the client's light keeps its own fog colour.
		const skyless = this.noSky()
		this.env.sky.visible = !skyless
		this.applyClientLight(time, skyless)
		;(this.scene.background as THREE.Color).copy(skyless ? EARTH : s.horizon)
		if (fog) fog.color.copy(skyless && !this.terrain.material.uniforms.clientLit.value ? EARTH : s.horizon)
		this.horizon.update(this.doc.id, this.doc.meta.region, !!this.prefs?.showHorizon && wow.loaded && !this.topDown, s.horizon)
		// A world view's horizon is its own, past the tiles it streams (#15).
		this.doc.world?.showHorizon(!!this.prefs?.showHorizon && !this.topDown, s.horizon)

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
		else floor.color.copy(EARTH).multiplyScalar(skyless ? 1 : light)

		this.meter.mark(SECTION['Camera and sky'])
		if (env.key.castShadow) this.fitShadows()
		else env.aimKey(this.camera.position)
		this.meter.mark(SECTION['Shadow fit'])
	}

	/**
	 * Times the shadow maps apart from the scene for the performance overlay: three renders them inside
	 * `renderer.render`, so its shadow map's `render` is wrapped to book its CPU time to Shadow maps and
	 * its GPU time to the Shadow maps pass, going back to the pass that was running after.
	 */
	private timeShadowMaps() {
		const sm = this.renderer.shadowMap
		const render = sm.render.bind(sm)
		sm.render = (lights, scene, camera) => {
			// The far layers' copies (#691) have no shadows to time.
			if (!this.meter.on || isFarLayerScene(scene)) return render(lights, scene, camera)
			const timing = this.gpu.active
			const pass = this.gpu.pass
			this.meter.mark(SECTION['Render (CPU)'])
			if (timing) this.gpu.begin(0)
			render(lights, scene, camera)
			if (timing) this.gpu.begin(pass)
			this.meter.mark(SECTION['Shadow maps (CPU)'])
		}
	}

	/** The window's numbers into `stats.perf`, once a second, and to whoever waits for a report. */
	private publishPerf(calls: number, triangles: number) {
		const w = this.meter.take()
		const costs: ModelCost[] = []
		const meshes = this.objects.drawnCosts(costs) + this.doc.spawnLayer.drawnCosts(costs)
		const info = this.renderer.info
		const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
		const r: PerfReport = {
			...w,
			gpu: this.gpu.take(),
			calls,
			triangles,
			geometries: info.memory.geometries,
			textures: info.memory.textures,
			programs: info.programs?.length ?? 0,
			instancedMeshes: meshes,
			heapMB: heap ? heap.usedJSHeapSize / 1048576 : null,
			models: topModels(costs, 5),
		}
		if (this.prefs?.perfOverlay) stats.perf = r
		const waiters = this.perfWaiters
		this.perfWaiters = []
		for (const f of waiters) f(r)
	}

	/** The next second's performance numbers (Help › Copy Performance Report), measured even with the overlay off. */
	measurePerf(): Promise<PerfReport> {
		return new Promise((resolve) => this.perfWaiters.push(resolve))
	}

	/** Whether this browser times the GPU passes (the overlay shows n/a otherwise). */
	get gpuTimed() {
		return this.gpu.supported
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

	// ---------------------------------------------------------------- flight paths (#180)

	/** View › Flight paths and the Flight Paths window's editing in the viewport (TaxiEditing.ts). */
	readonly taxi: TaxiEditing
	/** The flight stops and routes drawn over the map (the probes read it). */
	get taxiLayer() {
		return this.taxi.layer
	}

	/** Draws the Flight Paths window's stops and routes (server coordinates), `pick` highlighted, and lets `hooks` take its clicks until endTaxiEdit. */
	showTaxi(stops: TaxiStopShape[], routes: TaxiRouteShape[], pick: TaxiPick, hooks: TaxiHooks) {
		this.taxi.show(stops, routes, pick, hooks)
	}

	/** The Flight Paths window closed: View › Flight paths reads the map's stops again (they may have been saved). */
	endTaxiEdit() {
		this.taxi.endEdit()
	}

	/** Flies the camera along a route's points (server coordinates) at a flight's speed, then puts the view back; Esc or stopTaxiFlight ends it early. */
	flyTaxi(points: readonly Vec3[]) {
		this.taxi.fly(points)
	}

	/** Ends a fly-along preview and puts the camera back where it was. */
	stopTaxiFlight() {
		this.taxi.stopFlight()
	}

	// ---------------------------------------------------------------- walkable ground (#175)

	/** View › Walkable ground: the server's navmesh around the camera, built while the view is on. */
	readonly nav = new NavPreview()
	private navOn = false
	/** View › Test a Path is waiting for its clicks. */
	private navPick = false
	private navStatusAt = 0
	/** The progress line last shown while building, '' when none is up. */
	private navStatus = ''
	/** View › Server's mmaps (#240): the open map the server's tiles are read for, reused each frame. */
	private navSource: ServerSource = { mapId: 0, tileX: 0, tileY: 0 }

	/** Builds the walkable-ground view's tiles while it is on, and frees them when it goes off. */
	private updateNav() {
		if (!this.prefs?.navView) {
			if (this.navOn) {
				this.navOn = false
				this.navPick = false
				this.navStatus = ''
				this.nav.clear()
			}
			return
		}
		this.navOn = true
		const now = performance.now()
		const id = this.openMapId()
		this.nav.group.visible = !this.topDown
		let source: ServerSource | null = null
		if (this.prefs.navServer) {
			// The map's ID is still being read: wait for it rather than build the browser's tiles first.
			if (id === null) return
			// Per frame, so the map's corner (tileOrigin) is read without an object.
			const m = this.doc.meta
			source = this.navSource
			source.mapId = id
			source.tileX = m.region ? m.region.x : (m.vmangos?.tileX ?? 0)
			source.tileY = m.region ? m.region.y : (m.vmangos?.tileY ?? 0)
		}
		if (!this.prefs.navServer) this.updateInnerLift()
		this.nav.update(this.terrain, this.objects, this.doc.liquids, editor.waterEnabled ? editor.waterLevel : null, this.controller.target, id === null || id <= 1, now, source)
		if (now - this.navStatusAt < 500 || this.navPick) return
		this.navStatusAt = now
		const c = this.nav.counts
		const busy = c.loading > 0 || c.done < c.total
		// While building, its progress; once done, a line on what the colours mean (and nothing more, so a
		// path test's result stays).
		if (!busy && (c.settling || !this.navStatus)) return
		const colours = 'Green is ground, orange slopes only creatures take, cyan shallow water, blue water only swimmers cross, red magma, yellow slime.'
		const text = this.nav.serverMode
			? this.nav.serverError
				? `Walkable ground: the server's movement maps didn't load: ${this.nav.serverError}`
				: busy
					? `Walkable ground: reading the server's movement maps, ${c.done} of ${c.total} tiles…`
					: c.missing === c.total
						? "Walkable ground: the server has no movement maps (mmaps) here. Build them with VMaNGOS's MoveMapGenerator."
						: `Walkable ground: the server's own navmesh (its mmaps) within ${NAV_RANGE} yd${c.missing ? `, ${c.missing} of ${c.total} tiles have none` : ''}. A tile edited since they were built shows the old ground. ${colours}`
			: !busy
				? `Walkable ground: the navmesh within ${NAV_RANGE} yd.${c.failed ? ` ${c.failed} model${c.failed === 1 ? "'s" : "s'"} collision didn't load and is left out (Help > Log).` : ''} ${colours}`
				: c.loading
					? "Walkable ground: loading the models' collision…"
					: `Walkable ground: building the navmesh, ${c.done} of ${c.total} tiles…`
		this.navStatus = busy ? text : ''
		setStatus(text, busy ? 0 : 5000)
	}

	/**
	 * A region's inner heights for the walkable-ground view (#284): read from the client once per
	 * terrain, the first time the view builds it. A map of its own has none (its export writes the
	 * corners' mean), nor has a WMO-only map's hidden ground.
	 */
	private updateInnerLift() {
		const t = this.terrain
		const region = this.doc.meta.region
		const doc = this.doc
		if (t.innerRequested || !region || region.wmoOnly || !wow.loaded) return
		t.innerRequested = true
		t.innerPending = true
		RegionInner(region.mapName, region.x, region.y, region.size)
			.then((r) => {
				if (!this.documents.includes(doc)) return
				if (r?.lifts && r.base && r.side === t.size) {
					const b = base64ToBytes(r.lifts)
					const c = base64ToBytes(r.base)
					t.innerBase = new Float32Array(c.buffer, c.byteOffset, c.byteLength / 4)
					t.innerLift = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
				}
			})
			.catch((err) => console.warn('inner heights not read', err))
			.finally(() => (t.innerPending = false))
	}

	/** View › Test a Path: the next two clicks in the viewport are the path's start and end. */
	startPathTest() {
		this.navPick = true
		this.navStatus = '' // no build line over the test's own
		this.nav.clearPath()
		setStatus('Path test: click where the path starts (Esc to stop).', 0)
	}

	private navPathPoint(p: THREE.Vector3) {
		const r: PathResult = this.nav.pathPoint(p)
		if (r.kind === 'start') {
			setStatus('Path test: now click where it ends.', 0)
			return
		}
		this.navPick = false
		const msg =
			r.kind === 'path'
				? `A creature walks ${Math.round(r.yards)} yd from there to there (${Math.round(r.straight)} yd as the crow flies).`
				: r.kind === 'swim'
					? `Only a creature that swims gets from there to there, in ${Math.round(r.yards)} yd (${Math.round(r.straight)} yd as the crow flies); one that can't swim stops at deep water.`
					: r.kind === 'short'
						? `A creature can't reach that point: its path ends ${r.short.toFixed(1)} yd short, after ${Math.round(r.yards)} yd.`
						: r.reason === 'unreached'
							? "A creature can't walk from there to there: the two points aren't connected."
							: `There is no walkable ground at the ${r.reason === 'start' ? 'start' : 'end'} (or its tile isn't built yet).`
		setStatus(msg, 8000)
	}

	/** The client's area triggers of the open map, read once per document; `edited` while the Portals dialog draws its own list. */
	private readonly triggers = new DocOverlay<MapDocument, main.AreaTriggerList>({
		what: 'area triggers',
		current: () => this.doc,
		load: () => {
			const id = this.openMapId()
			return id === null ? null : AreaTriggers(id)
		},
		apply: (doc, r) => {
			const o = this.serverTiles(doc)
			this.triggerLayer.set(r?.triggers ?? [], o.x, o.y, null)
		},
		failed: (err) => setStatus(`View › Area triggers: the map's area triggers could not be read: ${err instanceof Error ? err.message : err}`, 8000),
	})

	/** Draws the Portals dialog's triggers, `selected` highlighted, until endTriggerEdit. */
	showTriggers(list: readonly TriggerShape[], selected: number | null) {
		this.triggers.edited = true
		const o = this.serverTiles(this.doc)
		this.triggerLayer.set(list, o.x, o.y, selected)
	}

	/** The Portals dialog closed: View › Area triggers reads the map's triggers again (they may have been saved). */
	endTriggerEdit() {
		this.triggers.edited = false
		this.triggers.reset()
		ui.pickedTrigger = null
	}

	/** Shows the triggers while asked for, reading the open map's once per document. */
	private updateTriggers() {
		const on = this.triggers.edited || this.prefs?.showAreaTriggers === true
		this.triggerLayer.group.visible = on && !this.topDown
		this.triggers.update(on)
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
		// A region's or a world view's (#756) map by its folder.
		const folder = m.region?.mapName ?? d.world?.mapName
		if (!m.vmangos && folder === undefined) return null
		if (!m.vmangos) await this.loadMapIds()
		const mapId = m.vmangos ? m.vmangos.mapId : this.mapIds?.get(folder!.toLowerCase())
		if (mapId === undefined) return null
		const c = d.camera
		if (!c) return null
		const t = this.serverTiles(d)
		return serverSpot(c.target.clone().setY(c.target.y + PLAYER_LIFT), mapId, t.x, t.y, c.yaw)
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
			this.zoneLights = {
				id,
				lights: MapLights(id)
					.then((l) => (l?.lights ?? []).map((x) => ({ id: x.id, x: x.x, z: x.z, inner: x.inner, outer: x.outer, global: x.global })))
					.catch((err) => {
						console.warn('map lights not read', err)
						return []
					}),
			}
		}
		const o = this.tileOrigin(this.doc)
		const dx = o.x * TILE_YARDS,
			dz = o.y * TILE_YARDS
		return (await this.zoneLights.lights).map((l) => ({ ...l, x: l.x - dx, z: l.z - dz }))
	}

	private mapIds: Map<string, number> | null = null
	/** The client's maps' instance types (Map.dbc: 0 a continent, 1 a dungeon, 2 a raid, 3 a battleground), by folder. */
	private mapTypes: Map<string, number> | null = null
	/** The client's map list being read, once asked for. */
	private mapIdsLoading: Promise<void> | null = null

	/** Reads the client's map list (folder to map ID) once. */
	private loadMapIds(): Promise<void> {
		if (this.mapIds) return Promise.resolve()
		this.mapIdsLoading ??= MapEntries()
			.then((rows) => {
				this.mapTypes = new Map((rows ?? []).map((r) => [r.Dir.toLowerCase(), r.Type]))
				this.mapIds = new Map((rows ?? []).map((r) => [r.Dir.toLowerCase(), r.ID]))
			})
			.catch((e) => {
				// Leave the list unknown (never an empty one, which would read as map 0), and retry later.
				console.warn('The client’s map list could not be read', e)
				setStatus('The client’s map list could not be read, so this map’s ID is unknown.', 6000)
				this.mapIdsFailedAt = performance.now()
			})
			.finally(() => void (this.mapIdsLoading = null))
		return this.mapIdsLoading
	}
	/** When the last read of the map list failed, so the per-frame callers retry only every few seconds. */
	private mapIdsFailedAt = -Infinity

	/** Whether the open document's map has no sky, and the document it was worked out for (`docId` -1: not yet). */
	private skyless = { docId: -1, value: false, asking: -1 }

	/**
	 * Whether the open map has no sky (#339): a client dungeon or raid (Map.dbc) with no far terrain in its
	 * WDL around the open region, as Uldaman, whose halls lie far below the sea's floor. Such a map shows
	 * the steady `SKYLESS` colour behind it instead of the sky dome, which a camera below the floor saw
	 * turn white at the horizon. A dungeon with land around it (Zul'Farrak, the Deadmines' cove) keeps its
	 * sky. False while unknown and for a map of Meld's own.
	 */
	private noSky(): boolean {
		const d = this.doc
		const r = d.meta.region
		if (!r || d.meta.vmangos || !wow.loaded) return false
		const k = this.skyless
		if (k.docId === d.id) return k.value
		if (!this.mapTypes) {
			if (performance.now() - this.mapIdsFailedAt > 10000) void this.loadMapIds()
			return false
		}
		const type = this.mapTypes.get(r.mapName.toLowerCase())
		if (type !== 1 && type !== 2) {
			k.docId = d.id
			k.value = false
			return false
		}
		if (k.asking === d.id) return false
		k.asking = d.id
		const id = d.id
		RegionHorizon(r.mapName, r.x, r.y, r.size)
			.then((tiles) => {
				k.docId = id
				k.value = !tiles?.length
			})
			.catch((err) => {
				console.warn('far terrain not read', err)
				k.docId = id
				k.value = false
			})
			.finally(() => {
				if (k.asking === id) k.asking = -1
			})
		return false
	}

	/**
	 * The open map's Map.dbc ID: a map made for the client's own, a region's or a world view's (#754) by
	 * its folder; 0 for a map of Meld's own not yet in the client; null while the client's map list is
	 * read, when it cannot be read or the folder is not in it.
	 */
	private openMapId(): number | null {
		const d = this.doc
		const m = d.meta
		if (m.vmangos) return m.vmangos.mapId
		const folder = m.region?.mapName ?? d.world?.mapName
		if (folder === undefined) return 0
		if (!this.mapIds) {
			if (performance.now() - this.mapIdsFailedAt > 10000) void this.loadMapIds()
			return null
		}
		return this.mapIds.get(folder.toLowerCase()) ?? null
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

	/**
	 * Sets the open map's world settings (Map Properties: sea on/off, sea level, rock and dirt roles);
	 * one undo step. `before` is the values from before a live drag that already wrote `editor`.
	 * Undo and redo write through `editor` at call time, since a tab switch replaces `editor.roles`.
	 */
	setWorldSettings(label: string, patch: WorldSettings, before?: WorldSettings) {
		const read = (): WorldSettings => ({
			waterEnabled: editor.waterEnabled,
			waterLevel: editor.waterLevel,
			rock: editor.roles.rock,
			dirt: editor.roles.dirt,
		})
		const write = (w: WorldSettings) => {
			if (w.waterEnabled !== undefined) editor.waterEnabled = w.waterEnabled
			if (w.waterLevel !== undefined) editor.waterLevel = w.waterLevel
			if (w.rock !== undefined) editor.roles.rock = w.rock
			if (w.dirt !== undefined) editor.roles.dirt = w.dirt
		}
		const now = read()
		const prior: WorldSettings = {}
		const after: WorldSettings = {}
		for (const k of Object.keys(patch) as (keyof WorldSettings)[]) {
			;(prior as Record<string, unknown>)[k] = before?.[k] ?? now[k]
			;(after as Record<string, unknown>)[k] = patch[k]
		}
		write(after)
		this.history.push({ label, undo: () => write(prior), redo: () => write(after) })
	}

	/** The open map's Map.dbc ID for the light editor: waits for the map table when a region needs it. */
	async lightsMapId(): Promise<number> {
		await this.loadMapIds()
		const id = this.openMapId()
		if (id === null) throw new Error('The client’s map list could not be read, so this map’s ID is unknown.')
		return id
	}

	/** Where the camera is in the tiles' placement frame (yards), which the client's lights are placed in. */
	cameraInFileFrame(): { x: number; y: number; z: number } {
		const cam = this.camera.position
		const o = this.tileOrigin(this.doc)
		return { x: cam.x + o.x * TILE_YARDS, y: cam.y, z: cam.z + o.y * TILE_YARDS }
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
	private applyClientLight(time: number, skyless: boolean) {
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
		// Per frame, so the origin is read without tileOrigin's object.
		const m = this.doc.meta
		const x = cam.x + (m.region ? m.region.x : (m.vmangos?.tileX ?? 0)) * TILE_YARDS
		const z = cam.z + (m.region ? m.region.y : (m.vmangos?.tileY ?? 0)) * TILE_YARDS
		const grade = WEATHER_GRADE[ui.weatherGrade]
		if (!lights || !lightAt(lights, x, cam.y, z, this.hour, this.lightOut, stormBlend(ui.weather, grade))) {
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
		this.clouds.update(dt, this.lightOut, minute, this.celestialOut, this.moonOut, this.camera.position, this.prefs?.clouds !== false && !this.topDown && !skyless, stormBlend(ui.weather, grade))
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
	 * Lighting › Weather Preview: the drops, splashes and mist around the camera, the mist in the fog's
	 * colour. Hidden in the top-down view. With the camera in a WMO room it shows as the client's does
	 * (#244): whole in a group open to the sky (0x8, 0x40 or 0x100, as Stormwind's streets), and from a
	 * true interior only through the doorways onto one, the portal flood's sky windows (so it runs after
	 * updateRoomGate, on this frame's windows); a room with none in view hides it. The storm light is
	 * applyClientLight's.
	 */
	private updateWeather(time: number) {
		const kind = ui.weather
		const show = kind !== 'clear' && !this.topDown
		const r = this.rooms.current
		const open = !r || this.topDown || (r.nav.groups[r.group]?.flags ?? 0) & SKY_GROUP || (r.across !== null && (r.nav.groups[r.across]?.flags ?? 0) & SKY_GROUP)
		this.weather.gate(open ? null : this.roomFlood.skyWindows)
		const c = this.renderer.domElement
		this.weather.update(kind, WEATHER_GRADE[ui.weatherGrade], this.camera.position, time, this.env.state.horizon, c.width, c.height, this.splashGround, show)
	}

	/**
	 * Fits the shadow cascades to the view: the sharp near one around where the camera looks (the
	 * ground point ahead, kept within its own reach of the camera), the far one around the distance.
	 * Which fits changed is kept for `markShadows`.
	 */
	private fitShadows() {
		const env = this.env
		const eye = this.camera.position
		const fwd = this.camera.getWorldDirection(this.shadowFwd)
		this.shadowRay.set(eye, fwd)
		const focus = this.shadowFocus
		// A world view's ground is its streamed tiles, not the hidden stand-in terrain (#741).
		const world = this.doc.world
		const ahead = world ? marchGround(this.worldHeight, eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, 3000, 8) : this.terrain.raycast(this.shadowRay, focus, 3000) ? focus.distanceTo(eye) : -1
		const dist = ahead < 0 ? 300 : ahead
		const nearExtent = THREE.MathUtils.clamp(dist, 30, 250)
		const farExtent = THREE.MathUtils.clamp(dist * 6, 800, 2500)
		const nearCenter = this.shadowNear.copy(eye).addScaledVector(fwd, Math.min(dist, nearExtent))
		const farCenter = this.shadowFar.copy(eye).addScaledVector(fwd, Math.min(dist, farExtent * 0.6))
		this.shadowFits |= env.updateShadow(nearCenter, nearExtent, farCenter, farExtent)
	}

	/**
	 * Says which shadow maps to redraw this frame, just before it is drawn (#326). Both are kept between
	 * frames: the far one is redrawn when its fit, the scene or a preference changes (a layer shown or
	 * hidden, the wireframe); the near one, which also follows the camera (culling, LODs and the room
	 * gate pick what it draws) and moving models, on the same changes and when the camera moves. When
	 * the only change is a pose or a moving material (a cut-out's texture, a fade) of a model drawn in
	 * its box, only the moving models are drawn again, over a copy of the rest (`PosedShadows`, #346). A
	 * still view with nothing moving in the near box redraws neither.
	 *
	 * In a world view the scene changes all the time while tiles stream in (a tile's models placed, a
	 * texture of theirs bound), so there a scene change redraws the far map at most once every
	 * WORLD_FAR_FRAMES frames (#15), which caps what it adds to a frame on average: a flight east through
	 * Elwynn redrew it on 13 frames in 120, each about 2,000 calls and 12 ms of CPU, all but one for a
	 * model or texture landing. A far map a few frames late shows a far model's shadow late, in the fog.
	 */
	private markShadows() {
		const env = this.env
		const fits = this.shadowFits
		const posed = this.nearPosed
		this.shadowFits = 0
		this.nearPosed = false
		if (!env.key.castShadow) return
		const swapped = this.objects !== this.shadowObjects
		const scene = this.shadowSceneChanged()
		if (scene) this.farStale = true
		this.farAge++
		const held = !!this.doc.world && !swapped && this.farAge < WORLD_FAR_FRAMES
		if (this.prefsChanged || fits & SHADOW_FAR || (this.farStale && !held)) {
			env.far.shadow.needsUpdate = true
			this.farStale = false
			this.farAge = 0
		}
		const view = !this.viewProj.equals(this.shadowViewProj)
		if (view) this.shadowViewProj.copy(this.viewProj)
		if (scene || view || this.prefsChanged || fits & SHADOW_NEAR) {
			env.key.shadow.needsUpdate = true
			// The redraw notes the posed models it draws again.
			clearNearCasters()
		} else if (posed) this.posedShadows.poses = true
		this.prefsChanged = false
	}

	/** Whether what casts a shadow changed since the last call: the placed objects, the ground, the spawns or a model's texture. */
	private shadowSceneChanged(): boolean {
		const k = this.shadowKey
		const t = this.terrain
		const objects = this.objects
		const v0 = objects.version
		const v1 = t.heightsVersion
		const v2 = t.holesVersion
		const v3 = this.doc.spawnLayer.changeStamp
		const v4 = texturesBoundCount()
		if (objects === this.shadowObjects && k[0] === v0 && k[1] === v1 && k[2] === v2 && k[3] === v3 && k[4] === v4) return false
		this.shadowObjects = objects
		k[0] = v0
		k[1] = v1
		k[2] = v2
		k[3] = v3
		k[4] = v4
		return true
	}
	/** Scratch for `cullInstances`, which keeps a shadow's lookup matrix across its frustum update. */
	private drawnShadowMatrix = new THREE.Matrix4()
	private shadowFwd = new THREE.Vector3()
	private shadowRay = new THREE.Ray()
	/** The world view's streamed ground height, NaN where no tile is loaded, for `marchGround`. */
	private worldHeight = (x: number, z: number): number => this.doc.world?.heightAt(x, z) ?? NaN
	private shadowFocus = new THREE.Vector3()
	private shadowNear = new THREE.Vector3()
	private shadowFar = new THREE.Vector3()
	private shadowObjects: ObjectLayer | null = null
	private shadowKey = [-1, -1, -1, -1, -1]
	/** The far shadow map waits on a scene change (`markShadows`), and the frames since it was last redrawn. */
	private farStale = false
	private farAge = Infinity
	/** The fits `fitShadows` changed since the last `markShadows` (SHADOW_NEAR, SHADOW_FAR bits). */
	private shadowFits = 0
	/** A model posed, or a moving material changed, this frame shows in the near cascade's map. */
	private nearPosed = false
	/** The camera's view-projection when the near map was last checked. */
	private shadowViewProj = new THREE.Matrix4()
	/** Preferences were applied since the last frame (layers, wireframe, culling: what the near map draws). */
	private prefsChanged = true

	/** Apply user preferences (graphics + camera). Cheap; safe to call often. */
	applyPrefs(p: Prefs) {
		this.prefs = p
		this.prefsChanged = true
		if (!p.dayCycle) this.hour = p.timeOfDay
		this.env.setClouds(p.clouds)
		this.env.setShadows(p.shadows)
		// Times the interface size (#372): under the page's CSS zoom the canvas's CSS px are that much larger on screen.
		const ratio = Math.min(window.devicePixelRatio * p.renderScale * clampUiScale(p.uiScale), 3)
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
		// A single building's map has no ground in the client, only the flat stand-in under it (#271); a
		// world view's is its streamed tiles (#15).
		d.terrain.group.visible = p.showTerrain && !d.meta.region?.wmoOnly && !d.world
		if (d.world) d.world.group.visible = p.showTerrain
		d.terrain.material.wireframe = p.wireframe
		d.water.mesh.visible = p.showWater && editor.waterEnabled
		d.liquidRenderer.group.visible = p.showWater
		if (d.world) d.world.water.visible = p.showWater
		// The WMOs' liquids (#287) share one material.
		wmoLiquidMaterial().visible = p.showWater
		d.objects.group.visible = p.showObjects
		d.objects.setKindsShown(p.showDoodads, p.showBuildings)
		d.groundEffects.group.visible = p.showGroundEffects
		d.spawnLayer.setKinds({ monster: p.showMonsters, npc: p.showNpcs, object: p.showGameObjects })
		d.spawnLayer.setEvents(p.shownEvents)
		this.spawnLabels.enabled = p.spawnNames
		this.spawnLabels.setSide(p.namesSide)
		// What a layer toggle hides can't stay selected, since it can't be clicked either (#135).
		if (!p.showObjects && editor.selectedIds.length) selectObjects(d.objects, [])
		else if (editor.selectedIds.some((id) => d.objects.isHidden(id)))
			selectObjects(
				d.objects,
				editor.selectedIds.filter((id) => !d.objects.isHidden(id)),
			)
		const s = editor.selectedSpawn
		if (s && (!{ monster: p.showMonsters, npc: p.showNpcs, object: p.showGameObjects }[s.kind] || !d.spawnLayer.eventShown(s))) selectSpawn(null)
	}

	/** Give the active terrain the palette whenever the editor's palette changes. */
	private syncPalette() {
		// The palette array is replaced, never edited in place (as in updateLookTexture), so identity says it changed.
		if (this.doc.paletteFrom === editor.palette) return
		this.doc.paletteFrom = editor.palette
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
			reference: copyReference(editor.reference),
			paths: copyPaths(editor.paths),
			region: d.meta.region,
			vmangos: d.meta.vmangos,
			bookmarks: [...editor.bookmarks],
			flattenLock: { ...editor.flattenLock },
			waterLock: { on: editor.water.lock, pos: { ...editor.water.lockPos } },
		}
		const c = this.controller
		d.camera = { target: c.target.clone(), yaw: c.yaw, pitch: c.pitch, distance: c.distance }
	}

	private syncTabs() {
		docs.tabs = this.documents.map((d) =>
			d === this.doc ? { id: d.id, name: editor.mapName, dirty: editor.dirty, size: d.world ? 0 : d.terrain.size } : { id: d.id, name: d.meta.mapName, dirty: d.meta.dirty, size: d.world ? 0 : d.terrain.size },
		)
		docs.active = this.doc.id
	}

	/**
	 * Ends what a held button is doing on the outgoing document before a tab switch or close (#549),
	 * as a stroke's onUp does: a gizmo drag pushes its step into that document's History (it reads the
	 * selection and `this.objects`, which still name the old tab), a flight-path drag hands the window
	 * where the stop went, and the brush-size drag, a Select press on a trigger and the path test's
	 * clicks, which belong to a spot on the old map, are dropped.
	 */
	private endInteractions() {
		if (this.gizmoDrag.active) this.endGizmoDrag()
		if (this.taxi.dragging) this.taxi.endDrag()
		this.sizeDrag = null
		this.trigDown = null
		if (this.navPick) {
			this.navPick = false
			this.nav.clearPath()
			setStatus('Stopped the path test.', 2000)
		}
	}

	/** Make `d` the edited/rendered document. `stash` saves the current one first. */
	private activate(d: MapDocument, stash = true) {
		// Already the active tab: its `meta` is the copy from the last stash, so loading it would revert
		// what the editor holds since (palette, dirty flag, roles, effects, reference, paths) (#547).
		if (stash && d === this.doc) {
			this.syncTabs()
			return
		}
		this.triggerLayer.select(null)
		ui.pickedTrigger = null
		// The chunk under the cursor on one map means nothing on another.
		editor.hoverChunk = -1
		ui.replaceSlot = null
		if (this.leftDown) {
			this.activeTool?.onUp?.(this.ctx, this.hit)
			this.leftDown = false
		}
		if (this.doc) this.endInteractions()
		if (stash && this.doc && this.doc !== d) {
			this.stashActive()
			this.scene.remove(this.doc.terrain.group, this.doc.water.mesh, this.doc.water.floor, this.doc.objects.group, this.doc.groundEffects.group, this.doc.spawnLayer.group, this.doc.liquidRenderer.group)
			if (this.doc.world) this.scene.remove(this.doc.world.group, this.doc.world.water)
		}
		this.doc = d
		this.scene.add(d.terrain.group, d.water.mesh, d.water.floor, d.objects.group, d.groundEffects.group, d.spawnLayer.group, d.liquidRenderer.group)
		if (d.world) this.scene.add(d.world.group, d.world.water)
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
		editor.reference = copyReference(m.reference)
		editor.paths = copyPaths(m.paths ?? [])
		editor.pathId = -1
		editor.pathPoint = -1
		// The locked points are positions on one map; another map starts unlocked (#449).
		editor.flattenLock = { ...(m.flattenLock ?? { on: false, x: 0, y: 0, z: 0 }) }
		editor.water.lock = m.waterLock?.on ?? true
		editor.water.lockPos = { ...(m.waterLock?.pos ?? { x: 0, y: 0, z: 0 }) }
		ui.referenceUrl = d.referenceImage?.url ?? ''
		ui.referenceVersion++
		this.refDrag = null
		editor.mapSize = d.terrain.size
		editor.region = m.region ? regionLabel(m.region) : ''
		editor.regionBlock = m.region ? { x: m.region.x, y: m.region.y, size: m.region.size } : null
		editor.regionMap = m.region?.mapName ?? ''
		editor.worldMap = d.world?.mapName ?? ''
		editor.spawns = d.spawnLayer.spawns.slice()
		editor.spawnsError = d.spawnsError
		ui.spawnChanges = d.spawnLayer.editCount()
		ui.hiddenModels = d.objects.hidden.size
		selectSpawn(null)
		d.terrain.setTileBorders(m.region ? TILE_CELLS : 0)
		editor.selected = null
		editor.selectedIds = []
		editor.selection = null
		ui.pasting = false
		this.nudgeSession = null
		this.controller.bounds = d.world ? WORLD_SIDE : d.terrain.worldSize
		this.controller.maxDistance = d.world ? WORLD_MAX_DISTANCE : d.terrain.worldSize * 1.6
		if (this.prefs) this.applyLayerVisibility(this.prefs)
		if (d.camera) {
			this.controller.target.copy(d.camera.target)
			this.controller.jump()
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

	/**
	 * Create a new map in its own tab. `setup` fills it before the tab opens (the benchmark maps, #322),
	 * since opening copies its `meta` into `editor`. `water` is the New world page's (#759): the sea at its
	 * level when the preset (or the image) has one, and lakes of its liquid filled in the land's basins.
	 */
	newDocument(size: number, kind: GenerateKind, seed: number, name = 'Untitled', setup?: (d: MapDocument) => void, shape?: CoastShape | null, opts?: Partial<ShapeOptions>, image?: ImageGround, water?: WorldWater) {
		const d = new MapDocument(size, this.uniqueName(name))
		if (image) {
			// From a heightmap (#745): the sea at 0 when asked, else none, as Flat land's.
			d.terrain.generateFromImage(image, opts?.erosion ?? 0, seed)
			d.meta.waterLevel = image.sea ? 0 : presetById('flat').waterLevel
			d.meta.waterEnabled = image.sea
		} else {
			d.terrain.generate(kind, seed, shape, opts)
			const preset = presetById(kind)
			d.meta.waterLevel = preset.waterLevel
			d.meta.waterEnabled = preset.water
		}
		if (d.meta.waterEnabled && water?.sea !== undefined) d.meta.waterLevel = water.sea
		let shores: Float32Array | null = null
		if (water?.lakes) {
			const t = d.terrain
			const level = findLakes(t.heights, t.verts, t.cellSize, { ...LAKE_RULES, sea: d.meta.waterEnabled ? d.meta.waterLevel : null })
			if (fillLakes(d.liquids, t, level, water.lakes)) shores = shoreLevels(level, t.verts)
		}
		d.terrain.autoPaint(d.meta.waterLevel, d.meta.waterEnabled, undefined, shores)
		setup?.(d)
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
		if (n < 2) return
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
		if (r.wmoOnly) region.wmoOnly = true
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
		// Read from the client, so the client holds it as it opens: Launch compares later states with this.
		d.compiled = { key: this.regionKey(), changes: d.history.changes }
		// A single building opens with the camera looking at it from outside, over its middle.
		const b = r.bounds
		if (r.wmoOnly && b?.length === 6) {
			const radius = Math.hypot(b[3] - b[0], b[5] - b[2]) / 2
			this.controller.focus((b[0] + b[3]) / 2, (b[2] + b[5]) / 2, Math.min(this.controller.maxDistance, Math.max(60, radius * 1.2)))
		}
		return d
	}

	/**
	 * Opens a world view of map `mapName` (its folder name; #15) in a tab of its own, or switches to the
	 * one open: the client's tiles streamed around the camera, in the map's editor coordinates. With
	 * `view` the camera takes it; with only `at` it looks at that ground point once its tile has loaded.
	 */
	openWorld(mapName: string, at: { x: number; z: number }, view?: { target: THREE.Vector3; yaw: number; pitch: number; distance: number }): MapDocument {
		let d = this.documents.find((x) => x.world?.mapName.toLowerCase() === mapName.toLowerCase())
		if (d) this.activate(d)
		else {
			d = new MapDocument(WORLD_STAND_IN, this.uniqueName(`${mapName} world`))
			const stand = d.terrain
			d.world = new WorldStream(mapName, d.objects, (x, z) => stand.heightAt(x, z), stand.material)
			d.objects.lookOnly = true
			// The client's water is part of what a later step streams; the stand-in has no sea.
			d.meta.waterEnabled = false
			d.camera = { target: new THREE.Vector3(at.x, 0, at.z), yaw: this.controller.yaw, pitch: Math.max(this.controller.pitch, 0.5), distance: WORLD_FOCUS_DISTANCE }
			this.addDocument(d)
		}
		const c = this.controller
		if (view) {
			c.setView(view.target.x, view.target.y, view.target.z, view.yaw, view.pitch, view.distance)
			this.worldFocus = null
		} else this.worldFocus = { doc: d.id, x: at.x, z: at.z, distance: WORLD_FOCUS_DISTANCE }
		return d
	}

	/** A world view's ground point to look at once its tile has loaded (`openWorld` without a view). */
	private worldFocus: { doc: number; x: number; z: number; distance: number } | null = null

	/**
	 * Looks at the ground point (x, z) from the camera's distance (the minimap's click). In a world view
	 * whose tile there isn't loaded yet, it looks again once it is, so the camera stands on its ground.
	 */
	lookAtGround(x: number, z: number) {
		const c = this.controller
		c.focus(x, z)
		const world = this.doc.world
		this.worldFocus = world && Number.isNaN(world.heightAt(x, z)) ? { doc: this.doc.id, x, z, distance: c.distance } : null
	}

	/** Streams the active world view's tiles around the camera, and looks at `worldFocus` once it can. */
	private updateWorld() {
		const world = this.doc.world
		if (!world) return
		const eye = this.camera.position
		world.update(eye.x, eye.z, streamReach(this.viewDistance))
		// The models of the tiles dropped go with their batches when nothing else uses them (#15), before
		// this frame's lights, particles and rooms are worked out from the objects left.
		if (world.takeDropped()) {
			const gone = this.doc.objects.dropEmptyBatches(new Set())
			if (gone.size) this.releaseModels(gone)
		}
		const f = this.worldFocus
		if (f && f.doc === this.doc.id && !Number.isNaN(world.heightAt(f.x, f.z))) {
			this.worldFocus = null
			this.controller.focus(f.x, f.z, f.distance)
		}
	}

	/**
	 * Gives a region's document its creatures and game objects, from the world database. The
	 * document may no longer be the active tab by the time they arrive; the layer is kept either way.
	 */
	setSpawns(d: MapDocument, spawns: vmangos.WorldSpawn[]) {
		// The tab was closed while the database was read: its layer is disposed, nothing to give it (#550).
		if (!this.documents.includes(d)) return
		const before = d.spawnLayer.modelTypes(new Set())
		d.spawnLayer.set(spawns)
		// Spawns read again: the models only the old ones used are let go of (#505).
		if (this.documents.includes(d)) this.releaseModels(before)
		d.spawnsError = ''
		if (d === this.doc) {
			editor.spawns = spawns.slice()
			editor.spawnsError = ''
			ui.spawnChanges = 0
		}
		if (this.prefs) this.applyLayerVisibility(this.prefs)
	}

	/** Records why a region's spawns could not be read, so the UI can say so and offer a retry. */
	setSpawnsError(d: MapDocument, message: string) {
		if (!this.documents.includes(d)) return
		d.spawnsError = message
		if (d === this.doc) editor.spawnsError = message
	}

	/**
	 * A plain right-click: selects the creature, region object or placed model under the cursor and
	 * opens a menu of what can be done with it. On bare ground there is no menu.
	 */
	private openContextMenu(e: PointerEvent) {
		ui.contextMenu = null
		const seq = ++this.menuSeq
		this.updatePointer(e)
		this.raycaster.setFromCamera(this.ndc, this.camera)
		const items: ContextItem[] = []
		let title = ''
		const picked = pickNearest(this.objects, this.doc.spawnLayer, this.raycaster)
		// An area trigger, while they are drawn (#306): picked over a building it stands in.
		const ray = this.raycaster.ray
		const layer = this.triggerLayer
		const trig = layer.group.visible ? pickTrigger(layer.triggers, ray.origin, ray.direction, layer.tileX, layer.tileY) : null
		if (trig && triggerWins(trig, picked.spawn ? 'spawn' : picked.id !== null ? 'model' : null, picked.distance)) {
			const t = trig.trigger
			this.selectTrigger(t.id)
			const dest = t.teleport
			title = `Area trigger ${t.id}${t.name ? `: ${t.name}` : ''}`
			const what = title
			if (dest) items.push({ label: 'Teleport to destination', run: () => void teleportTo(this, dest, what) })
			else title += ' (teleports no one)'
			const at = editorPoint(t, layer.tileX, layer.tileY)
			items.push({ label: 'Focus', run: () => this.controller.focus(at.x, at.z, Math.max(20, t.radius * 4, t.boxX * 2)) })
			items.push({ label: 'Unselect', run: () => this.selectTrigger(null) })
			items.push({ separator: true }, ...copyItems({ ids: [{ what: 'area trigger id', id: t.id }], name: t.name }))
			ui.contextMenu = { x: e.clientX, y: e.clientY, title, items }
			return
		}
		if (layer.selected !== null) this.selectTrigger(null)
		const id = picked.id
		// A click that hits nothing near the selected creature or object still opens its menu (#205).
		const spawn = picked.spawn ?? (id === null ? this.selectedSpawnNear(e) : null)
		if (spawn) {
			const menu = this.spawnActions.menu(spawn)
			title = menu.title
			items.push(...menu.items)
		} else {
			const o = id !== null ? this.objects.objects.get(id) : undefined
			if (!o) return
			if (editor.tool !== 'select' && editor.tool !== 'place') editor.tool = 'select'
			if (!editor.selectedIds.includes(o.id)) selectObjects(this.objects, [o.id])
			const n = editor.selectedIds.length
			title = n > 1 ? `${n} models` : displayName(o.type)
			items.push({ label: 'Focus', shortcut: 'F', run: () => this.focusSelected() })
			items.push({ label: 'Preview', run: () => (ui.modelPreview = { title: displayName(o.type), type: o.type, scale: o.scale }) })
			items.push({ label: 'Duplicate', shortcut: 'Ctrl+Shift+D', run: () => this.duplicateSelected() })
			items.push({ label: 'Place more of this', run: () => pickModel(o) })
			items.push({ label: 'Unselect', run: () => this.deselect() })
			// Copy id (#681): a model of the client's region has its unique ID there; one added here has none yet.
			if (n === 1) {
				const uid = this.doc.meta.region?.uids.get(o.id)
				const path = o.type.replace(/^(m2|wmo):/, '')
				items.push({ separator: true }, ...copyItems({ ids: uid !== undefined ? [{ what: 'unique id', id: uid }] : [] }))
				if (path !== o.type) items.push({ label: 'Copy path', run: () => void copyValue(path, 'path') })
			}
			items.push({ separator: true }, { label: n > 1 ? 'Delete models' : 'Delete model', shortcut: 'Del', danger: true, run: () => this.deleteSelected() })
		}
		ui.contextMenu = { x: e.clientX, y: e.clientY, title, items }
		if (spawn) void this.spawnActions.addTeleports(spawn, seq, title)
	}

	/** Counts the viewport menus opened, so an answer that comes back late finds whether its menu is still up. */
	private menuSeq = 0

	/**
	 * Puts the camera at server spot `dest` in the active tab's coordinates, looking the way it faces
	 * from a little behind, as a player arriving there would (Teleport to destination, #306).
	 */
	viewSpot(dest: { x: number; y: number; z: number; o: number }) {
		const o = this.serverTiles(this.doc)
		const p = editorPoint(dest, o.x, o.y)
		// A player's eye height above the spot: where the flying camera sits, and what an orbit looks at.
		this.controller.setView(p.x, p.y + 1.7, p.z, dest.o, 0.3, 12)
	}

	/** The selected spawn when (clientX, clientY) is within CONTEXT_MARGIN px of it on the screen, else null. */
	private selectedSpawnNear(e: { clientX: number; clientY: number }): vmangos.WorldSpawn | null {
		const sel = editor.selectedSpawn
		if (!sel) return null
		const s = this.doc.spawnLayer.get(spawnKey(sel))
		if (!s || !this.doc.spawnLayer.boundsOf(s, this.nearBox)) return null
		const r = this.canvas.getBoundingClientRect()
		return nearScreenBox(this.nearBox, this.camera, r.width, r.height, e.clientX - r.left, e.clientY - r.top, CONTEXT_MARGIN) ? s : null
	}
	private nearBox = new THREE.Box3()

	// The spawn actions (SpawnActions.ts), under the names the components and probes call.
	focusSpawn(s: vmangos.WorldSpawn) {
		this.spawnActions.focusSpawn(s)
	}
	focusPoint(x: number, z: number) {
		this.spawnActions.focusPoint(x, z)
	}
	editPath(key: string) {
		this.spawnActions.editPath(key)
	}
	startSpawnPick(key: string, mode: 'lead' | 'follow' | 'pool' | 'joinPool' | 'joinMother') {
		this.spawnActions.startSpawnPick(key, mode)
	}
	pickSpawn(o: vmangos.WorldSpawn) {
		this.spawnActions.pickSpawn(o)
	}
	changeSpawns(changes: readonly SpawnChange[], label: string) {
		this.spawnActions.changeSpawns(changes, label)
	}
	makePool(key: string) {
		return this.spawnActions.makePool(key)
	}
	setFormationSlot(key: string, dist: number, angle: number) {
		this.spawnActions.setFormationSlot(key, dist, angle)
	}
	deletePathPoint() {
		this.spawnActions.deletePathPoint()
	}
	editSpawn(key: string, vals: SpawnFields, label: string) {
		return this.spawnActions.editSpawn(key, vals, label)
	}
	placeCreature(t: vmangos.CreatureTemplate, at: THREE.Vector3, rotY?: number) {
		return this.spawnActions.placeCreature(t, at, rotY)
	}
	placeObject(t: vmangos.ObjectTemplate, at: THREE.Vector3, rotY?: number) {
		return this.spawnActions.placeObject(t, at, rotY)
	}
	applyCreatureTemplate(entry: number, now: Record<string, string>, was: Record<string, string>) {
		return this.spawnActions.applyCreatureTemplate(entry, now, was)
	}
	applyObjectTemplate(entry: number, now: Record<string, string>, was: Record<string, string>) {
		return this.spawnActions.applyObjectTemplate(entry, now, was)
	}
	spawnEdits(): vmangos.SpawnEdit[] {
		return this.spawnActions.spawnEdits()
	}
	markSpawnsSaved() {
		this.spawnActions.markSpawnsSaved()
	}

	/**
	 * A new map to export for the 1.12 client, of tiles x tiles 128-cell tiles. It's made the same as
	 * any new map, then marked with its folder and map ID, and its place and tiles on the client's grid
	 * (`ref.tileX`, `tileY`, `tiles`, #46): a preset's coast follows the tiles, and those left out are hidden.
	 * `opts` are the New world page's Height, Roughness and Erosion (#744); `image`, when given, is the ground
	 * instead of the preset (From a heightmap, #745), eroded at `opts.erosion`; `water` the sea level and
	 * lakes (#759).
	 */
	newVmangosDocument(tiles: number, kind: GenerateKind, seed: number, ref: VmangosRef, opts?: Partial<ShapeOptions>, image?: ImageGround, water?: WorldWater): MapDocument {
		const mask = maskBytes(ref.tiles, tiles)
		const d = this.newDocument(tiles * TILE_CELLS, kind, seed, ref.dir, (doc) => doc.terrain.setTileMask(mask), mask ? new CoastShape(mask, tiles) : null, opts, image, water)
		d.meta.vmangos = { ...ref }
		if (!mask) delete d.meta.vmangos.tiles
		return d
	}

	/**
	 * Sets which tiles of the open client map's square are the map's (Map Properties, #46): `tiles` is the
	 * mask (terrain/tileMask.ts, '' for every tile). One undo step; the ground of a tile left out stays.
	 */
	setWorldTiles(tiles: string) {
		const ref = this.doc.meta.vmangos
		if (!ref) return
		const before = ref.tiles ?? ''
		if (before === tiles) return
		// Through the active document at call time, as every undo step.
		const apply = (mask: string) => {
			const r = this.doc.meta.vmangos
			if (!r) return
			if (mask) r.tiles = mask
			else delete r.tiles
			this.terrain.setTileMask(maskBytes(mask, this.terrain.size / TILE_CELLS))
		}
		apply(tiles)
		this.history.push({ label: 'Map tiles', undo: () => apply(before), redo: () => apply(tiles) })
	}

	/**
	 * Makes the open client map's terrain the bigger square `square` of the grid, with mask `tiles`
	 * (Map Properties adding a tile outside the square, #46): the map is made again in its tab with its
	 * ground, paint, models and the rest moved into the new square (io/worldGrow.ts), the new tiles flat
	 * below the sea. It can't be undone, so the tab's undo history starts again; the map is left unsaved.
	 */
	growWorld(square: TileSquare, tiles: string) {
		const d = this.doc
		const ref = d.meta.vmangos
		if (!ref) return
		const n0 = d.terrain.size / TILE_CELLS
		// The old square's place in the new one, in tiles.
		const dx = (ref.tileX ?? 0) - square.x
		const dy = (ref.tileY ?? 0) - square.y
		if (!Number.isInteger(n0) || dx < 0 || dy < 0 || dx + n0 > square.size || dy + n0 > square.size) throw new Error(`tiles ${square.x},${square.y} (${square.size}×${square.size}) don't hold the map's square`)
		const fill = editor.waterEnabled ? editor.waterLevel - 6 : 0
		const snap = growSnapshot(this.snapshot(), dx, dy, square.size, fill)
		// The same ref, so Map Properties and anything else holding it see the new place.
		const was = { ...ref }
		const place = (r: VmangosRef) => {
			delete ref.tileX
			delete ref.tileY
			delete ref.tiles
			if (r.tileX) ref.tileX = r.tileX
			if (r.tileY) ref.tileY = r.tileY
			if (r.tiles) ref.tiles = r.tiles
		}
		place({ ...ref, tileX: square.x, tileY: square.y, tiles })
		snap.vmangos = ref
		const mx = dx * TILE_YARDS
		const mz = dy * TILE_YARDS
		try {
			this.openDocument(snap, editor.filePath, d.id)
		} catch (e) {
			place(was)
			throw e
		}
		// The new tab, now open, kept the old one's camera and bookmarks: they move with the ground.
		const c = this.controller
		c.setView(c.target.x + mx, c.target.y, c.target.z + mz, c.yaw, c.pitch, c.distance)
		editor.bookmarks = editor.bookmarks.map((b) => ({ ...b, x: b.x + mx, z: b.z + mz }))
		editor.dirty = true
		this.refreshTabs()
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
		// A world view's pick aims at its hidden stand-in, so its streamed ground under the cursor is taken (#756).
		const world = this.doc.world
		const hit = world ? this.worldCursor() : this.hit
		if (!hit) return { error: 'Point at the ground or a model to copy its position.' }
		const at = hit.clone()
		const m = this.doc.meta
		if (!m.vmangos && !m.region && !world) return { error: 'This map isn’t in the client yet, so it has no map ID: make it with File › New World… or open a part of Azeroth.' }
		if (!m.vmangos) await this.loadMapIds()
		const id = this.openMapId()
		if (id === null) return { error: 'The client’s map list could not be read, so this map’s ID is unknown.' }
		const t = this.serverTiles(this.doc)
		return { command: teleportCommand(at, id, t.x, t.y) }
	}

	/**
	 * Where a character launched into the game should stand: on the ground or the model surface below
	 * the camera (the orbit target in ground-following mode, the camera itself when flying), facing the
	 * way the camera looks, in the server's coordinates and map. Null for a map that isn't in the client.
	 */
	async playerSpot(): Promise<ServerSpot | null> {
		const m = this.doc.meta
		const world = this.doc.world
		if (!m.vmangos && !m.region && !world) return null
		if (!m.vmangos) await this.loadMapIds()
		const id = this.openMapId()
		if (id === null) return null
		const c = this.controller
		// From a little above an orbit target, so a floor just over the terrain is found, not a roof.
		const from = c.followGround ? c.target.clone().setY(c.target.y + PLAYER_PROBE) : this.camera.position.clone()
		let at: THREE.Vector3
		if (world) {
			// A world view stands on its streamed ground (#756): its terrain is the hidden stand-in and its
			// streamed models are a look-only layer, so no floor is found; NaN where the tile is not loaded yet.
			const g = world.heightAt(from.x, from.z)
			at = from.clone().setY(Number.isNaN(g) ? c.target.y : g)
		} else at = this.groundBelow(from) ?? from.clone().setY(this.terrain.heightAt(from.x, from.z))
		at.y += PLAYER_LIFT
		const t = this.serverTiles(this.doc)
		return serverSpot(at, id, t.x, t.y, c.yaw)
	}

	/**
	 * The client tile at the north-west corner of a map's editor frame, for serverSpot: a region's first
	 * tile; a map made with New World's place on the grid (#46), but for a WMO-only one, whose building
	 * Publish writes at the world's middle (#272), the frame that puts its building there.
	 */
	private serverTiles(d: MapDocument): { x: number; y: number } {
		const m = d.meta
		if (m.region) return { x: m.region.x, y: m.region.y }
		const b = m.vmangos?.info?.wmoOnly ? this.globalBuilding(d) : null
		return b ? wmoOnlyTiles(b) : this.tileOrigin(d)
	}

	/**
	 * The client tile at the north-west corner of the open map's editor frame (see serverTiles), for
	 * the windows that place the server's points on it.
	 */
	serverOrigin(): { x: number; y: number } {
		return this.serverTiles(this.doc)
	}

	/**
	 * The client tile at a map's north-west corner: a region's first tile, a map made for the client's
	 * place on the grid (#46, 0,0 for one made before), else 0,0. Whole tiles, unlike serverTiles.
	 */
	tileOrigin(d: MapDocument = this.doc): { x: number; y: number } {
		const m = d.meta
		if (m.region) return { x: m.region.x, y: m.region.y }
		return { x: m.vmangos?.tileX ?? 0, y: m.vmangos?.tileY ?? 0 }
	}

	/** A WMO-only map's building, as Publish picks it: the first WMO, at its editor position. */
	globalBuilding(d: MapDocument = this.doc): THREE.Vector3 | null {
		for (const o of d.objects.objects.values()) {
			if (o.type.startsWith('wmo:')) return d.objects.worldPlacement(o).pos
		}
		return null
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
		const objects = this.objects
			.list()
			.filter((o) => !isHelper(o.type))
			.map((o) => {
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
			// A map saved before the file kept chunk data has none of its own, so the client's zones,
			// impassable flags and no-tuft cells stay; its holes and baked shadows are still sent (#644).
			headers: this.doc.chunkDataKnown ? { areaIds: t.areaIds, chunkFlags: t.chunkFlags } : undefined,
			holes: t.holes,
			// A map saved before the file kept holes adds its own to the client's (#663).
			holesAdd: !this.doc.holesKnown,
			// A map that has none of its own keeps the client's.
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

	/**
	 * In a world view (#15), which is looked at and not edited, says so and returns true: the commands
	 * that act on the map's ground or models call it first, since a world tab's terrain is a hidden
	 * stand-in and its models are the stream's. File › Edit Here opens the block for them.
	 */
	refuseInWorld(): boolean {
		if (!this.doc.world) return false
		setStatus('A world view is looked at, not edited: File › Edit Here opens the block around the camera to edit.', 6000)
		return true
	}

	/** The map the active tab is a world view of (#15), or null for any other tab. */
	activeWorld(): string | null {
		return this.doc.world?.mapName ?? null
	}

	/** The tiles the active world view's map has (tileKey), or null for any other tab. */
	worldTiles(): ReadonlySet<number> | null {
		return this.doc.world?.tileKeys ?? null
	}

	/** The active world view's streaming (tiles drawn, being read, the map's count), or null for any other tab. */
	worldStats(): ReturnType<WorldStream['stats']> | null {
		return this.doc.world?.stats() ?? null
	}

	/**
	 * A fingerprint of what Compile writes for the active region (io/regionKey.ts): its ground, paint,
	 * chunk data, models and liquids, taken from the document's own arrays rather than the export, whose
	 * building footprints change as models load. Spawns are left out: they go to the database. Anything
	 * new that `exportInput` or the region save sends must be added to `RegionKeyInput` too, or Launch misses
	 * its edits (tests/regionKey.test.ts fails to type-check until it is mapped there).
	 */
	regionKey(): string {
		const d = this.doc
		const t = d.terrain
		return regionKeyOf({
			terrain: { heights: t.heights, weights: t.weights, chunkSlots: t.chunkSlots, holes: t.holes, noEffect: t.noEffect, areaIds: t.areaIds, chunkFlags: t.chunkFlags, shadow: t.shadow },
			settings: {
				palette: editor.palette,
				textureEffects: editor.textureEffects,
				textureLooks: editor.textureLooks,
				scopedEffects: editor.scopedEffects,
				chunkDataKnown: d.chunkDataKnown,
				liquidsKnown: d.liquidsKnown,
				holesKnown: d.holesKnown,
			},
			objects: this.regionObjects(),
			liquids: d.liquids,
		})
	}

	/** The other open regions edited since they were opened or last compiled (any step, spawns too), by tab name. */
	otherEditedRegions(): string[] {
		return this.documents.filter((d) => d !== this.doc && d.meta.region && d.history.changes !== d.compiled.changes).map((d) => d.meta.mapName)
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
		// The scene's view wins over the one a world view would take once its first tile loads.
		this.worldFocus = null
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

	/** A left-button drag is held (a brush stroke, a box select): the map is mid-edit, its history step not yet pushed. */
	isStroking() {
		return this.leftDown
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
			if (d.world) this.scene.remove(d.world.group, d.world.water)
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
		this.releaseModels(d.modelTypes(new Set()))
		d.dispose()
		this.syncTabs()
	}

	/**
	 * Lets go of the models of `drop` (a closed map's, or spawns replaced) and of their particles' models
	 * that no open map, tool preview or clipboard uses (#505): their geometry, materials and textures,
	 * which the registry otherwise kept for the rest of the session, and their WMOs' room data.
	 */
	private releaseModels(drop: Set<string>) {
		const keep = new Set<string>()
		for (const d of this.documents) d.modelTypes(keep)
		if (editor.prefab) keep.add(editor.prefab)
		for (const e of activeDoodadBrush()?.entries ?? []) keep.add(e.type)
		for (const o of this.objectClip?.objects ?? []) keep.add(o.type)
		for (const o of this.clip?.objects ?? []) keep.add(o.type)
		withParticleModels(keep)
		withParticleModels(drop)
		for (const t of drop) if (keep.has(t) || this.doodadTool.previewing(t)) drop.delete(t)
		if (!drop.size) return
		releaseAssets(drop)
		// A WMO's room data goes with the last type placing it (its doodad sets are types of their own).
		const wmo = (t: string) => (t.startsWith('wmo:') ? baseType(t).slice('wmo:'.length).toLowerCase() : '')
		const placed = new Set<string>()
		for (const t of keep) placed.add(wmo(t))
		const paths = new Set<string>()
		for (const t of drop) if (wmo(t) && !placed.has(wmo(t))) paths.add(wmo(t))
		this.rooms.forget(paths)
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
			reference: copyReference(m.reference),
			paths: copyPaths(m.paths ?? []),
			heights: new Uint8Array(t.heights.buffer, t.heights.byteOffset, t.heights.byteLength),
			weights: t.weights,
			chunkSlots: t.chunkSlots,
			holes: t.holes,
			holesKnown: d.holesKnown,
			liquids: encodeLiquids(d.liquids),
			liquidsKnown: d.liquidsKnown,
			liquidKinds: liquidKindsOf(d.liquids),
			chunkData: { areaIds: t.areaIds, chunkFlags: t.chunkFlags, noEffect: t.noEffect },
			chunkDataKnown: d.chunkDataKnown,
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
		// Anything below can throw once the document holds GPU resources, so it is freed on every throw (#535).
		try {
			this.fillDocument(d, m, filePath, replace)
		} catch (e) {
			d.dispose()
			throw e
		}
		this.addDocument(d, replace)
	}

	/** The part of openDocument that can throw: fills the new document `d` from the snapshot. */
	private fillDocument(d: MapDocument, m: MapSnapshot, filePath: string, replace: MapDocument | undefined) {
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
		d.holesKnown = m.holesKnown
		// Before the layers, so a building's liquid the client's table lacks draws as its kind (#540).
		rememberLiquidKinds(m.liquidKinds)
		if (m.liquids) decodeLiquids(d.liquids, m.liquids)
		d.liquidsKnown = m.liquidsKnown
		if (m.chunkData) {
			const c = m.chunkData
			if (c.areaIds.length !== t.areaIds.length || c.chunkFlags.length !== t.chunkFlags.length || c.noEffect.length !== t.noEffect.length) {
				throw new Error('chunk data size mismatch')
			}
			t.areaIds.set(c.areaIds)
			t.chunkFlags.set(c.chunkFlags)
			t.noEffect.set(c.noEffect)
		}
		d.chunkDataKnown = m.chunkDataKnown
		if (m.shadows) {
			if (m.shadows.length !== (t.shadowSide * t.shadowSide) / 8) {
				throw new Error('shadow data size mismatch')
			}
			t.setBakedShadows(m.shadows, t.shadowSide)
			// The map's own: the client's are not read over them.
			t.bakedRequested = true
		}
		t.markAllDirty()
		const region: RegionRef | null = m.region ? { ...m.region, uids: new Map() } : null
		// A single building's map keeps no flag of its own in the file; its building's unique ID tells it.
		if (region && m.objects.some((o) => o.uid === GLOBAL_UID)) region.wmoOnly = true
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
			reference: copyReference(m.reference),
			paths: copyPaths(m.paths ?? []),
		}
		// A map made for the client may leave tiles of its square out (#46).
		if (m.vmangos?.tiles) t.setTileMask(maskBytes(m.vmangos.tiles, m.size / TILE_CELLS))
		// The image is the author's file, read again each time the map opens.
		if (m.reference) void this.loadReferenceImage(m.reference.path, d)
		if (replace) {
			d.camera = replace.camera
			d.meta.bookmarks = [...replace.meta.bookmarks]
		}
	}

	// ---------------------------------------------------------------- reference image (#184)

	/** The reference image's drag in the top-down view: what it holds, where it started and the record before. */
	private refDrag: { kind: number | 'move' | 'turn'; x0: number; z0: number; before: ReferenceImage } | null = null
	private refCursor = ''
	private refV = new THREE.Vector3()

	/** The active map's reference image as read (pixels and texture), or null. */
	get referenceImage(): LoadedReference | null {
		return this.doc.referenceImage
	}

	/**
	 * Reads the image at `path` for document `d` (the active one by default), unless it holds it
	 * already. A failed read leaves the map's record as it is and says so. Returns whether it is there.
	 */
	async loadReferenceImage(path: string, d: MapDocument = this.doc): Promise<boolean> {
		if (d.referenceImage?.path === path) return true
		try {
			const img = await readReferenceFile(path)
			if (!this.documents.includes(d)) {
				img.dispose()
				return false
			}
			this.useReferenceImage(img, d)
			return true
		} catch (err) {
			setStatus(`Reference image ${path} not read: ${err}`, 8000)
			return false
		}
	}

	/** Makes `img` document `d`'s reference pixels, freeing the ones it had. */
	useReferenceImage(img: LoadedReference, d: MapDocument = this.doc) {
		if (d.referenceImage && d.referenceImage !== img) d.referenceImage.dispose()
		d.referenceImage = img
		if (d !== this.doc) return
		ui.referenceUrl = img.url
		ui.referenceVersion++
	}

	/**
	 * Sets the active map's reference record (null removes it) as one undo step named `label`, from
	 * `before` (the record now, unless an interaction already changed it live). Nothing is recorded
	 * when it ends as it began.
	 */
	setReference(next: ReferenceImage | null, label: string, before: ReferenceImage | null = copyReference(editor.reference)) {
		const after = copyReference(next)
		this.applyReference(after)
		if (sameReference(before, after)) return
		this.history.push({ label, undo: () => this.applyReference(before), redo: () => this.applyReference(after) })
	}

	/** Puts a record into `editor`, reading its image when the map doesn't hold that one. */
	private applyReference(r: ReferenceImage | null) {
		editor.reference = copyReference(r)
		if (r && this.doc.referenceImage?.path !== r.path) void this.loadReferenceImage(r.path)
	}

	/** The record that lays `img` over the whole map, more than half seen. */
	referenceFor(img: LoadedReference): ReferenceImage {
		const place = fitPlace(img.pixels.w, img.pixels.h, this.terrain.worldSize)
		return { path: img.path, mode: 'ground', opacity: 0.6, shown: true, ...place }
	}

	/**
	 * Where the screen overlay lies on the ground in the top-down view: the image fitted inside the
	 * viewport (as the overlay's object-fit: contain draws it), its centre and edges unprojected through
	 * the top-down camera. Null outside the top-down view.
	 */
	referenceFromScreen(): ReferencePlace | null {
		const img = this.doc.referenceImage
		if (!img || !this.topDown) return null
		const cw = Math.max(1, this.container.clientWidth)
		const ch = Math.max(1, this.container.clientHeight)
		const s = Math.min(cw / img.pixels.w, ch / img.pixels.h)
		// The drawn image's half size as shares of the viewport's half size (NDC).
		const hx = (img.pixels.w * s) / cw
		const hy = (img.pixels.h * s) / ch
		const at = (x: number, y: number): [number, number] => {
			this.refV.set(x, y, 0).unproject(this.ortho)
			return [this.refV.x, this.refV.z]
		}
		const [cx, cz] = at(0, 0)
		const [rx, rz] = at(hx, 0)
		// NDC's y runs up the screen, the image's rows down it.
		const [bx, bz] = at(0, -hy)
		return { x: cx, z: cz, w: 2 * Math.hypot(rx - cx, rz - cz), h: 2 * Math.hypot(bx - cx, bz - cz), turn: Math.atan2(rz - cz, rx - cx) }
	}

	/** The corner handles' half size while placing, in world units: about 7 pixels of the top-down view. */
	private refHandle(): number {
		return (7 * 2 * this.ortho.top) / Math.max(1, this.container.clientHeight)
	}

	/** Whether the reference image is being placed in the view now. */
	private referencePlacing(): boolean {
		const r = editor.reference
		return ui.referenceAdjust && this.topDown && !this.minimapShot && !!r && r.mode === 'ground'
	}

	/** Drapes the active map's reference image, or not, each frame. */
	private updateReference() {
		const r = editor.reference
		const img = this.doc.referenceImage
		const show = !!r && r.mode === 'ground' && !this.minimapShot && r.shown && !!img && img.path === r.path
		const placing = this.referencePlacing()
		this.terrain.setReference(show ? img!.texture : null, show ? r!.opacity : 0, show || placing ? r : null, placing ? this.refHandle() : 0)
	}

	/** The ground point under the pointer in the top-down view (straight down, so any height will do). */
	private topDownPoint(): [number, number] {
		this.refV.set(this.ndc.x, this.ndc.y, 0).unproject(this.ortho)
		return [this.refV.x, this.refV.z]
	}

	/**
	 * A left press while the reference image is being placed: a corner scales it (Shift frees its
	 * shape), the image moves, Ctrl+drag turns it. Every press is taken, so no tool acts meanwhile.
	 */
	private referencePress(e: PointerEvent): boolean {
		if (!this.referencePlacing()) return false
		const r = editor.reference!
		const [x, z] = this.topDownPoint()
		const hit = refHit(r, x, z, this.refHandle() * 1.5)
		if (hit === null) return true
		this.refDrag = { kind: e.ctrlKey ? 'turn' : hit === 'inside' ? 'move' : hit, x0: x, z0: z, before: { ...r } }
		return true
	}

	private moveReferenceDrag(e: PointerEvent) {
		const d = this.refDrag!
		const r = editor.reference
		if (!r || !this.topDown) {
			this.refDrag = null
			return
		}
		const [x, z] = this.topDownPoint()
		const b = d.before
		const p: ReferencePlace = d.kind === 'move' ? { x: b.x + x - d.x0, z: b.z + z - d.z0, w: b.w, h: b.h, turn: b.turn } : d.kind === 'turn' ? dragTurn(b, d.x0, d.z0, x, z) : dragCorner(b, d.kind, x, z, !e.shiftKey)
		r.x = p.x
		r.z = p.z
		r.w = p.w
		r.h = p.h
		r.turn = p.turn
	}

	private endReferenceDrag() {
		const d = this.refDrag
		this.refDrag = null
		if (d) this.setReference(editor.reference, d.kind === 'move' ? 'Move reference image' : d.kind === 'turn' ? 'Turn reference image' : 'Scale reference image', d.before)
	}

	/** The cursor over the image while placing it: a corner, the image, or the default. */
	private referenceHover() {
		let cursor = ''
		if (this.referencePlacing()) {
			const [x, z] = this.topDownPoint()
			const hit = refHit(editor.reference!, x, z, this.refHandle() * 1.5)
			cursor = hit === null ? '' : hit === 'inside' ? 'move' : 'nwse-resize'
		}
		if (cursor === this.refCursor) return
		this.refCursor = cursor
		this.canvas.style.cursor = cursor
	}

	/** The image and its record when both are there for a conversion, or null after saying why. */
	private referenceSource(): { img: LoadedReference; place: ReferenceImage } | null {
		const r = editor.reference
		const img = this.doc.referenceImage
		if (!r || !img || img.path !== r.path) {
			setStatus('Choose a reference image first (View › Reference Image).', 4000)
			return null
		}
		return { img, place: r }
	}

	/** Reference image › Heights: its brightness from `min` (black) to `max` (white), set on the ground under it or added to it, one undo step. */
	referenceToHeights(min: number, max: number, mode: RefHeightMode) {
		const src = this.referenceSource()
		if (!src) return
		const t = this.terrain
		const { next, count } = heightsFromImage(t.heights, t.verts, t.cellSize, src.img.pixels, src.place, min, max, mode)
		if (!count) {
			setStatus('The reference image lies off the map, so no height changed.', 4000)
			return
		}
		this.setHeights(next, 'Reference image to heights')
		setStatus(`Set ${count} vertices from the reference image's brightness. Undo reverts it.`, 5000)
	}

	/** Reference image › Zones: each chunk under a colour with a zone takes that zone (most of it wins), one undo step. */
	referenceToZones(colours: RefColour[], areaOf: number[], tolerance: number) {
		const src = this.referenceSource()
		if (!src) return
		const t = this.terrain
		const stroke = new ChunkDataStroke(t, 'Reference image to zones')
		const n = areasFromImage(t.areaIds, t.paintChunksPerSide, CHUNK_CELLS * t.cellSize, colourIndices(src.img.pixels, colours, tolerance), src.img.pixels, src.place, areaOf)
		t.touchChunkData()
		const cmd = stroke.finish()
		if (cmd) this.history.push(cmd)
		setStatus(n ? `Set the zone of ${n} chunks from the reference image. Undo reverts it.` : 'No chunk changed: give a colour a zone, or move the image over the map.', 5000)
	}

	/** Reference image › Textures: the texels under a colour with a texture are painted with it alone, one undo step. */
	referenceToTextures(colours: RefColour[], layerOf: number[], tolerance: number) {
		const src = this.referenceSource()
		if (!src) return
		const t = this.terrain
		const R = t.splatRes
		const stroke = new TerrainStroke(t, 'Reference image to textures', { splat: true })
		stroke.reserveSplat({ x0: 0, z0: 0, x1: R - 1, z1: R - 1 })
		const r = texturesFromImage(t.weights, t.chunkSlots, R, t.paintChunksPerSide, t.worldSize / R, colourIndices(src.img.pixels, colours, tolerance), src.img.pixels, src.place, layerOf)
		if (r.rect) {
			stroke.touchSplat(r.rect)
			t.markSplatDirty(r.rect)
		}
		const cmd = stroke.finish()
		if (cmd) this.history.push(cmd)
		const refused = r.refused ? `; ${r.refused} texels kept theirs, where a chunk had no slot left for another texture` : ''
		setStatus(r.painted ? `Painted ${r.painted} texels from the reference image${refused}. Undo reverts it.` : 'Nothing painted: give a colour a texture, or move the image over the map.', 6000)
	}

	/** Reference image › Mask: the texels under the chosen colours are added to the paint mask, one undo step. */
	referenceToMask(colours: RefColour[], chosen: boolean[], tolerance: number) {
		const src = this.referenceSource()
		if (!src) return
		const t = this.terrain
		const idx = colourIndices(src.img.pixels, colours, tolerance)
		let count = 0
		this.editMask('Reference image to mask', (m) => {
			count = maskFromImage(m, t.splatRes, t.worldSize / t.splatRes, idx, src.img.pixels, src.place, chosen).count
		})
		setStatus(count ? `Added ${count} texels to the mask from the reference image.` : 'Nothing masked: tick a colour, or move the image over the map.', 5000)
	}

	// ---------------------------------------------------------------- surfaces

	/**
	 * Terrain or object surface under the cursor, whichever is nearer. The terrain is left out where
	 * `terrainSeeThrough` says so: under the ground its ray march meets the ground at the camera itself,
	 * which put a model placed in a cave or a dungeon at the camera.
	 */
	surfaceHit(exclude?: Set<number>): { point: THREE.Vector3; parent: number | null } | null {
		this.raycaster.setFromCamera(this.ndc, this.camera)
		const groundPoint = this.terrainSeeThrough() ? null : this.terrainPointUnderRay()
		const obj = this.objects.raycastSurface(this.raycaster, exclude)
		const groundDist = groundPoint ? groundPoint.distanceTo(this.raycaster.ray.origin) : Infinity
		if (obj && obj.distance < groundDist) return { point: obj.point, parent: obj.id }
		return groundPoint ? { point: groundPoint, parent: null } : null
	}

	/** The last floorHit's cursor, camera and answer: the spawn brush asks on every move, and a ray through every model is dear. */
	private floorCache = { x: NaN, y: NaN, cam: new THREE.Matrix4(), at: 0, exclude: undefined as Set<number> | undefined, hit: null as { point: THREE.Vector3; parent: number | null } | null }

	/**
	 * The floor under the cursor a creature or game object stands on (#660): the nearer of the terrain
	 * and the first model surface facing up (`raycastFloor` passes ceilings and walls). The terrain is
	 * see-through when the camera is under it (in a cave or a dungeon below the ground, where the ray
	 * starts inside the ground) or hidden, so the model floor wins there. The answer is kept for a
	 * quarter second while the cursor and the camera stay put, for models still loading.
	 */
	floorHit(exclude?: Set<number>): { point: THREE.Vector3; parent: number | null } | null {
		const c = this.floorCache
		const now = performance.now()
		if (c.x === this.ndc.x && c.y === this.ndc.y && c.exclude === exclude && now - c.at < 250 && c.cam.equals(this.camera.matrixWorld)) return c.hit
		this.raycaster.setFromCamera(this.ndc, this.camera)
		const groundPoint = this.terrainPointUnderRay()
		const obj = this.objects.raycastFloor(this.raycaster, exclude)
		const groundDist = groundPoint ? groundPoint.distanceTo(this.raycaster.ray.origin) : Infinity
		c.hit = obj && (obj.distance < groundDist || this.terrainSeeThrough()) ? { point: obj.point, parent: obj.id } : groundPoint ? { point: groundPoint, parent: null } : null
		c.x = this.ndc.x
		c.y = this.ndc.y
		c.exclude = exclude
		c.at = now
		c.cam.copy(this.camera.matrixWorld)
		return c.hit
	}

	/** Whether a floor ray looks through the terrain: it is hidden, or the camera is under it (not in a hole). */
	private terrainSeeThrough(): boolean {
		const t = this.terrain
		if (!t.group.visible) return true
		const p = this.camera.position
		return t.contains(p.x, p.z) && !t.isHole(p.x, p.z) && p.y < t.heightAt(p.x, p.z)
	}

	private terrainPointUnderRay(): THREE.Vector3 | null {
		// A single building's ground is a hidden stand-in: models and spawns go on the building (#271).
		if (this.doc.meta.region?.wmoOnly) return null
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
		if (this.refuseInWorld()) return
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
		if (this.refuseInWorld()) return
		const t = this.terrain
		const R = t.splatRes
		const m = t.mask
		let x0 = R,
			z0 = R,
			x1 = -1,
			z1 = -1
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
		if (this.refuseInWorld()) return
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
			let x0 = R,
				z0 = R,
				x1 = -1,
				z1 = -1
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

	/**
	 * A new world's trees, bushes and rocks (#758): a zone's scatter (wow/zoneTrees.ts) filled over the
	 * whole map, `amount` times as thickly as the zone is covered, through the doodad brush's fill and
	 * its rules: on dry ground above the beach, off steep slopes, below the snow line, the plants in
	 * clumps. The models must be loaded first, since the spacing reads their size. One undo step each.
	 * Returns how many were placed.
	 */
	scatterWorld(s: ZoneScatter, amount: number, seed: number): number {
		const t = this.terrain
		if (amount <= 0) return 0
		let maxH = -Infinity
		for (let i = 0; i < t.heights.length; i++) maxH = Math.max(maxH, t.heights[i])
		const sea = editor.waterEnabled ? editor.waterLevel : null
		const base = sea ?? 0
		worldRules(s, sea === null ? -1e5 : 2, snowLine(editor.waterLevel, maxH) - 10 - base)
		const area = { x0: 0, z0: 0, x1: t.size, z1: t.size }
		const yd2 = t.worldSize * t.worldSize
		// Plants grow in clumps: woods and clearings over a few hundred yards.
		const clumps = (x: number, z: number) => (t.isOff(x, z) ? 0 : THREE.MathUtils.smoothstep(fbm(x * 0.006, z * 0.006, 3, seed + 7), 0.38, 0.62))
		const open = (x: number, z: number) => (t.isOff(x, z) ? 0 : 1)
		let n = 0
		// The clumps keep about half the points, so twice as many are tried.
		if (s.plants) n += this.doodadTool.fill(this.ctx, s.plants, area, null, { attempts: Math.round(((s.plantDensity * yd2) / 1e4) * amount * 2), keep: clumps, own: true, label: 'Scatter trees' })
		if (s.rocks) n += this.doodadTool.fill(this.ctx, s.rocks, area, null, { attempts: Math.round(((s.rockDensity * yd2) / 1e4) * amount), keep: open, own: true, label: 'Scatter rocks' })
		return n
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
				this.terrain.setAreaShape(cells)
				u.selMode.value = 3
			} else u.selMode.value = 1
		} else {
			u.selMode.value = 0
		}
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
			setStatus(`Select an area first: drag on the ground with the Select tool (${firstKeyOf('tool:select')}).`)
			return
		}
		const next = cur.slice()
		if (cells > 0) growMask(next, size, cells)
		else shrinkMask(next, size, -cells)
		const r = setAreaCells(t, size, next)
		selectObjects(
			this.objects,
			r
				? withGroups(
						this.objects,
						objectsInArea(this.objects, t, size, t.cellSize).map((o) => o.id),
					)
				: [],
		)
		setStatus(r ? `${cells > 0 ? 'Grew' : 'Shrank'} the area to ${r.x1 - r.x0} × ${r.z1 - r.z0} cells.` : 'The area shrank to nothing.')
	}

	/** Selects the whole map and every object in it. */
	selectAll() {
		if (this.refuseInWorld()) return
		const n = this.terrain.size
		editor.selection = { x0: 0, z0: 0, x1: n, z1: n }
		selectObjects(
			this.objects,
			objectsInRect(this.objects, this.terrain.cellSize, editor.selection).map((o) => o.id),
		)
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
			setStatus(`Select an area first: drag on the ground with the Select tool (${firstKeyOf('tool:select')}).`)
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
		setStatus(hole ? `Cut a hole of ${n} ${n === 1 ? 'cell' : 'cells'}. Fill hole puts the ground back; ${keysOf('undo')} undoes.` : `Filled ${n} ${n === 1 ? 'cell' : 'cells'} of hole.`)
	}

	/**
	 * Models › Fit Ground to Selection (#168, #210): levels the ground under each selected model to its
	 * base, its origin (never above just under its floor), blending back over a ring, and with Cut holes opens the ground where it stands
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
		const { cmd, fitted, loading } = this.fitGroundCommand(ids, stamp, fit)
		if (cmd) this.history.push(cmd)
		const what = stamp ? 'Stamped' : 'Fitted the ground to'
		if (fitted) setStatus(`${what} ${fitted} ${fitted === 1 ? 'model' : 'models'}.${loading ? ` ${loading} still loading, left out.` : ''}`, 5000)
		else setStatus(loading ? 'The selected models are still loading; try again in a moment.' : 'Nothing to change: the ground already fits.', 5000)
	}

	/**
	 * The Place tool's Fit ground (#207): fits the ground under the model `id` just placed, with the Fit
	 * Ground dialog's settings, and returns the change for the tool to fold into the placement's undo step.
	 */
	fitGroundUnder(id: number, fit: FitOptions): Command | null {
		const { cmd, loading } = this.fitGroundCommand([id], false, fit)
		if (loading) setStatus('The model is still loading, so the ground was not fitted under it. Models › Fit Ground to Selected Models fits it once it shows.', 5000)
		return cmd
	}

	/**
	 * Fits (or with `stamp`, stamps) the ground to the models `ids` and returns the change as one
	 * command, already applied but not pushed, with how many models changed the ground and how many
	 * were left out because they are still loading. Shared by Fit Ground and the Place tool's Fit ground.
	 */
	private fitGroundCommand(ids: number[], stamp: boolean, fit: FitOptions): { cmd: Command | null; fitted: number; loading: number } {
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
			// The window reaches past the apron, the ring and the cell the smoothing takes beyond it.
			const apron = stamp ? 0 : FIT_APRON_CELLS * cs
			const reach = opts.falloff + apron + cs
			const x0 = Math.max(0, Math.floor((box.min.x - reach) / cs))
			const z0 = Math.max(0, Math.floor((box.min.z - reach) / cs))
			const x1 = Math.min(t.size, Math.ceil((box.max.x + reach) / cs))
			const z1 = Math.min(t.size, Math.ceil((box.max.z + reach) / cs))
			if (x1 <= x0 || z1 <= z0) continue
			const w = x1 - x0 + 1
			const h = z1 - z0 + 1
			const ground = new Float32Array(w * h)
			const floor = new Float32Array(w * h).fill(NaN)
			const under = new Float32Array(w * h).fill(NaN)
			const from = box.min.y - 1
			let lowFloor = Infinity
			let lowUnder = Infinity
			for (let z = 0; z < h; z++) {
				for (let x = 0; x < w; x++) {
					const vx = x0 + x
					const vz = z0 + z
					ground[z * w + x] = t.heights[vz * V + vx]
					const wx = vx * cs
					const wz = vz * cs
					if (wx < box.min.x || wx > box.max.x || wz < box.min.z || wz > box.max.z) continue
					const u = this.objects.surfaceAt(id, wx, wz, false, from)
					under[z * w + x] = u
					if (u < lowUnder) lowUnder = u
					if (stamp) continue
					const f = this.objects.surfaceAt(id, wx, wz, true, from)
					floor[z * w + x] = f
					if (f < lowFloor) lowFloor = f
				}
			}
			if (stamp) {
				// Stamp: the ground takes the underside's shape, both ways.
				floor.set(under)
			} else {
				// A floor or underside counts only near the model's lowest one (#208), whatever the ground
				// does under it: a stable's hayloft and a roof's eaves are far above them, a floor raised on
				// a foundation is not.
				for (let i = 0; i < floor.length; i++) {
					if (floor[i] > lowFloor + fit.reach) floor[i] = NaN
					if (under[i] > lowUnder + fit.reach) under[i] = NaN
				}
			}
			// A fit levels the ground to the model's base and keeps an apron level around it (#210); a
			// stamp takes the underside's shape and blends straight out. The base is the origin, raised by
			// the depth a model on the ground was sunk to (a negative height, from the Place tool's PgDn or
			// the Inspector), so a farmhouse's stone footing sunk 2 yd stays 2 yd underground.
			const o = this.objects.objects.get(id)!
			const sunk = o.parent === undefined ? Math.max(0, -o.yOff) : 0
			const base = stamp ? NaN : this.objects.worldPlacement(o).pos.y + sunk
			const r = fitHeights(ground, floor, under, w, h, x0, z0, cs, opts, base, apron)
			if (!r.changed) continue
			fitted++
			// The models on the ground under this one would ride the ground: note where each stood.
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
			return {
				cmd: {
					label: terrainCmd.label,
					undo: () => {
						moves?.undo()
						terrainCmd.undo()
					},
					redo: () => {
						terrainCmd.redo()
						moves?.redo()
					},
				},
				fitted,
				loading,
			}
		}
		return { cmd: null, fitted, loading }
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
			setStatus(`Copied ${n} ${n === 1 ? 'model' : 'models'}. ${keysOf('paste')} pastes a copy under the cursor (in any map tab); ${keysOf('duplicate')} duplicates in place.`)
			return true
		}
		const s = editor.selection
		if (!s || s.x1 <= s.x0 || s.z1 <= s.z0) {
			setStatus(`Nothing selected. Click a model, or drag on the ground with the Select tool (${firstKeyOf('tool:select')}) to select part of the map first.`)
			return false
		}
		const shape = areaShape(this.terrain, this.terrain.size)
		this.clip = copyRegion(this.terrain, this.objects, s, editor.palette, this.doc.liquids, shape ? cellsInRect(shape, this.terrain.size, s) : undefined)
		this.lastCopied = 'area'
		ui.hasClip = true
		const liquid = this.clip.liquids?.cells.length ? `, ${this.clip.liquids.cells.length} liquid cells` : ''
		setStatus(`Copied ${this.clip.w}×${this.clip.h} cells${liquid} and ${this.clip.objects.length} objects. Paste with ${keysOf('paste')} (works in other map tabs too).`)
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
		if (this.refuseInWorld()) return
		if (!(this.lastCopied === 'objects' ? this.objectClip : this.clip)) {
			setStatus(`The clipboard is empty. Select models or an area with the Select tool and press ${keysOf('copy')}.`)
			return
		}
		editor.tool = 'select'
		selectObjects(this.objects, [])
		ui.pasting = true
		this.selectTool.pasteAt = null
		this.selectTool.pasteWorld = null
		setStatus(this.lastCopied === 'objects' ? 'Click to put the copied models down · Enter places them · Esc cancels' : 'Click to place the paste · Enter places it · R turns it · PgUp/PgDn raise/lower · Esc cancels', 0)
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
		// time is the timer's elapsed seconds.
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
		selectObjects(
			this.objects,
			r.added.map((o) => o.id),
		)
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
			selectObjects(
				this.objects,
				r.added.map((o) => o.id),
			)
			ui.pasting = false
			setStatus(`Pasted ${r.added.length} ${r.added.length === 1 ? 'model' : 'models'}. ${keysOf('paste')} pastes again; ${keysOf('undo')} undoes.`)
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
		setStatus(`Pasted. ${keysOf('undo')} to undo.`)
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
		setStatus(hide ? `${what}${attached} hidden. ${keysOf('unhideAll')} shows all hidden models again.` : `${what}${attached} shown.`, 3000)
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
		// The outline's targets, colours and warn boxes and where the handles stand are built again only
		// when the objects, the ground, the selection or the tool moved (#551); each frame only the handles
		// are fitted to the camera.
		const nudge = this.canNudge()
		const L = this.objects
		const k = this.selBuiltFor
		const primary = editor.selected?.id
		if (k.layer !== L || k.version !== L.version || k.terrain !== this.terrain || k.heights !== this.terrain.heightsVersion || k.ids !== editor.selectedIds || k.primary !== primary || k.nudge !== nudge) {
			k.layer = L
			k.version = L.version
			k.terrain = this.terrain
			k.heights = this.terrain.heightsVersion
			k.ids = editor.selectedIds
			k.primary = primary
			k.nudge = nudge
			this.buildSelectionVisuals(nudge ? selectedObjects(L) : NO_OBJECTS)
		}
		this.outline.setTerrain(this.terrain)
		const g = this.selGizmo
		if (g.on) {
			this.gizmo.update(g.at, g.radius, g.top, this.viewEye(), g.scalable, true, editor.gizmoLocal ? g.yaw : 0)
			// A group's handles work the group as one: no hover cursor from a single model's.
			if (g.group && this.canvas.style.cursor && !this.gizmoDrag.active) this.canvas.style.cursor = ''
			return
		}
		// No model: the selected creature or object of the region gets the ring and arrow instead.
		const s = this.gizmoDrag.selectedSpawn()
		if (s && this.doc.spawnLayer.boundsOf(s, this.tmpBox)) {
			const size = this.tmpBox.getSize(this.tmpV)
			this.gizmo.update(this.spawnGizmoAt.set(s.x, s.y, s.z), Math.max(size.x, size.z) * 0.55, this.tmpBox.max.y, this.viewEye(), false)
		} else this.gizmo.hide()
		if (this.canvas.style.cursor && !this.gizmoDrag.active) this.canvas.style.cursor = ''
	}

	/** Outlines every selected model in its colour, sets the warn boxes and puts the handles' spot into `selGizmo`. */
	private buildSelectionVisuals(sel: readonly WorldObject[]) {
		const one = sel.length === 1 ? sel[0] : undefined
		// One model: its warn boxes answer its prop test too.
		const warn = one ? this.overlappingBoxes(one, this.warnBoxes.length) : 0
		const targets = this.outlineTargets
		targets.length = 0
		for (let i = 0; i < sel.length; i++) {
			const o = sel[i]
			const m = (this.outlineMatrices[i] ??= new THREE.Matrix4())
			this.objects.matrixOf(o, m)
			const t = (this.outlinePool[i] ??= { asset: getAsset(o.type), matrix: m, touching: false })
			t.asset = getAsset(o.type)
			t.matrix = m
			t.touching = this.touchesSomething(o, sel.length, one ? warn > 0 : undefined)
			targets.push(t)
		}
		this.outline.setTargets(targets)
		this.outline.setWarnBoxes(this.warnBoxes, warn)
		const g = this.selGizmo
		g.on = sel.length > 0
		g.group = sel.length > 1
		if (g.group) this.placeGroupGizmo(sel)
		else if (one) {
			// One model: the handles stand at its spot, sized to its box.
			this.tmpBox.copy(getAsset(one.type).bbox).applyMatrix4(this.objects.matrixOf(one, this.tmpM))
			const size = this.tmpBox.getSize(this.tmpV)
			this.objects.worldPosition(one, g.at)
			g.radius = Math.max(size.x, size.z) * 0.55
			g.top = this.tmpBox.max.y
			g.scalable = !one.type.startsWith('wmo:')
			g.yaw = this.objects.worldYaw(one)
		}
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

	/**
	 * Outlines the model or spawn under the pointer that a Select click would pick (#641), by the click's
	 * own `pickNearest`. Picks again only when the pointer, the camera, the objects, the spawns or the
	 * selection moved, and draws nothing (no mask pass) while it is off, another tool is active, the
	 * pointer is pressed or off the viewport, a handle is under it, or the pick is already selected.
	 */
	private updateHoverVisuals() {
		const h = this.hovered
		const on =
			this.prefs?.hoverOutline !== false &&
			editor.tool === 'select' &&
			this.pointerInside &&
			!this.leftDown &&
			!this.gizmoDrag.active &&
			!this.sizeDrag &&
			!this.navPick &&
			!ui.pasting &&
			!this.controller.isDragging &&
			!(this.gizmo.visible && this.gizmo.hoveredHandle)
		if (!on) {
			if (h.id !== null || h.spawn || this.hoverTargets.length) this.setHover(null, null)
			this.hoverKey.reset()
			return
		}
		const c = this.camera.matrixWorld.elements
		const layer = this.doc.spawnLayer
		const k = this.hoverKey.begin().add(this.ndc.x).add(this.ndc.y).add(c[8]).add(c[9]).add(c[10]).add(c[12]).add(c[13]).add(c[14])
		k.add(this.objects).add(this.objects.version).add(layer).add(layer.version).add(editor.selectedIds).add(editor.selectedSpawn)
		if (!k.changed()) return
		this.raycaster.setFromCamera(this.ndc, this.camera)
		const { id, spawn } = pickNearest(this.objects, layer, this.raycaster)
		const o = id !== null ? this.objects.objects.get(id) : undefined
		if (o && !editor.selectedIds.includes(o.id)) {
			const asset = getAsset(o.type)
			if (!asset.ready) return this.hoverPending()
			this.setHover(o.id, null, asset, this.objects.matrixOf(o, this.hoverMatrix))
			return
		}
		const sel = editor.selectedSpawn
		if (spawn && !(sel && this.spawnKeyOf(sel) === spawnKey(spawn))) {
			const type = spawnType(spawn)
			const asset = type ? getAsset(type) : null
			// A spawn drawn as a marker (no model of its own) gets no stroke.
			if (asset && !asset.ready) return this.hoverPending()
			if (asset) {
				this.setHover(null, spawn, asset, spawnMatrix(spawn, true, this.hoverMatrix))
				return
			}
		}
		this.setHover(null, null)
	}

	/** The hovered model is still loading: nothing outlined yet, and the pick is made again next frame. */
	private hoverPending() {
		this.setHover(null, null)
		this.hoverKey.reset()
	}

	/** Sets what the hover outline shows; no asset for nothing. */
	private setHover(id: number | null, spawn: vmangos.WorldSpawn | null, asset?: ModelAsset, matrix?: THREE.Matrix4) {
		this.hovered.id = id
		this.hovered.spawn = spawn
		const targets = this.hoverTargets
		targets.length = 0
		if (asset && matrix) {
			const t = (this.hoverTarget ??= { asset, matrix, touching: false })
			t.asset = asset
			t.matrix = matrix
			targets.push(t)
		}
		this.hoverOutline.setTargets(targets)
	}

	/**
	 * Outlines the other spawns of the selected spawn's pool (#172), those drawn with their model. Built
	 * again only when the spawns or the selection change.
	 */
	private updatePoolVisuals() {
		const layer = this.doc.spawnLayer
		const sel = editor.selectedSpawn
		const b = this.poolBuiltFor
		if (b.layer === layer && b.version === layer.version && b.sel === sel) return
		b.layer = layer
		b.version = layer.version
		b.sel = sel
		const targets = this.poolTargets
		targets.length = 0
		const mates = sel?.pool ? poolMates(layer.spawns, sel) : []
		for (const s of mates) {
			const type = spawnType(s)
			const asset = type ? getAsset(type) : null
			if (!asset?.ready || !layer.eventShown(s)) continue
			const m = (this.poolMatrices[targets.length] ??= new THREE.Matrix4())
			targets.push({ asset, matrix: spawnMatrix(s, true, m), touching: false })
		}
		this.poolOutline.setTargets(targets)
	}

	/** Puts the handles' spot into `selGizmo` for a multi-selection: its pivot, the ring round the whole group and the arrow over its top. */
	private placeGroupGizmo(sel: readonly WorldObject[]) {
		const targets = movableSelection(this.objects)
		const pivot = this.selectionPivot(targets.length ? targets : sel)
		let radius = 0
		let topY = -Infinity
		let baseY = 0
		let scalable = true
		for (const o of sel) {
			this.objects.matrixOf(o, this.tmpM)
			const { min, max } = this.tmpBox.copy(getAsset(o.type).bbox).applyMatrix4(this.tmpM)
			const dx = Math.max(Math.abs(min.x - pivot.x), Math.abs(max.x - pivot.x))
			const dz = Math.max(Math.abs(min.z - pivot.z), Math.abs(max.z - pivot.z))
			radius = Math.max(radius, Math.hypot(dx, dz))
			topY = Math.max(topY, max.y)
			baseY += this.objects.worldPosition(o, this.tmpV).y / sel.length
			if (o.type.startsWith('wmo:')) scalable = false
		}
		const g = this.selGizmo
		g.at.set(pivot.x, baseY, pivot.z)
		g.radius = radius * 1.05
		g.top = topY
		g.scalable = scalable
		g.yaw = this.objects.worldYaw(this.selectedObject() ?? sel[0])
	}

	private warnBoxes: THREE.Box3[] = Array.from({ length: 8 }, () => new THREE.Box3())
	private touchBox = new THREE.Box3()
	private touchM = new THREE.Matrix4()
	private touchNear: WorldObject[] = []

	/**
	 * Whether a selected model touches anything, for the outline's colour: it is attached to a parent,
	 * its lowest point is on (or under) the ground somewhere across its footprint, or another prop's
	 * box meets its own (`props`, when the caller already knows). A big selection skips the prop test.
	 */
	private touchesSomething(o: WorldObject, selected: number, props?: boolean): boolean {
		if (o.parent !== null && o.parent !== undefined) return true
		const box = this.touchBox.copy(getAsset(o.type).bbox).applyMatrix4(this.objects.matrixOf(o, this.touchM))
		// The ground under the footprint's centre and corners.
		let ground = this.groundAt((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2)
		ground = Math.max(ground, this.groundAt(box.min.x, box.min.z), this.groundAt(box.max.x, box.min.z))
		ground = Math.max(ground, this.groundAt(box.min.x, box.max.z), this.groundAt(box.max.x, box.max.z))
		if (box.min.y <= ground + 0.25) return true
		return selected <= 16 && (props ?? this.overlappingBoxes(o, 1) > 0)
	}

	/** The terrain height at a point, or -Infinity off the map or over a hole. */
	private groundAt(x: number, z: number): number {
		const t = this.terrain
		return t.contains(x, z) && !t.isHole(x, z) ? t.heightAt(x, z) : -Infinity
	}

	/**
	 * Puts into `warnBoxes` the world boxes of up to `limit` other props that overlap `o` (shrunk,
	 * since bounds are loose), and returns how many. The outline marks the parts of `o` inside them;
	 * parts under the terrain are marked by the outline shader itself. Reads the roots that may reach
	 * its box from the layer's cells (#551), and the attached props, not every object.
	 */
	private overlappingBoxes(o: WorldObject, limit: number): number {
		const asset = getAsset(o.type)
		if (!asset.ready) return 0
		const L = this.objects
		const box = this.tmpBox.copy(asset.bbox).applyMatrix4(L.matrixOf(o, this.tmpM))
		box.expandByVector(box.getSize(this.tmpV).multiplyScalar(-0.05))
		let n = 0
		const near = this.touchNear
		for (let pass = 0; pass < 2 && n < limit; pass++) {
			if (pass === 0) L.rootsTouching(box.min.x, box.min.z, box.max.x, box.max.z, near)
			else L.attachedObjects(near)
			for (let i = 0; i < near.length && n < limit; i++) {
				const other = near[i]
				if (L.isHidden(other.id)) continue
				const a = getAsset(other.type)
				if (!a.ready) continue
				// A prop resting on/holding another isn't a collision.
				if (L.hangsOn(o, other.id) || L.hangsOn(other, o.id)) continue
				const ob = this.otherBox.copy(a.bbox).applyMatrix4(L.matrixOf(other, this.tmpM))
				ob.expandByVector(ob.getSize(this.tmpV).multiplyScalar(-0.05))
				if (box.intersectsBox(ob)) this.warnBoxes[n++].copy(ob)
			}
		}
		near.length = 0
		return n
	}

	// ------------------------------------------------------------- gizmo drag (GizmoDrag.ts)

	/** Begin dragging a gizmo handle under the pointer. Returns true if one was hit. */
	private startGizmoDrag(): boolean {
		return this.gizmoDrag.start()
	}

	private updateGizmoDrag(snap: boolean) {
		this.gizmoDrag.update(snap)
	}

	private endGizmoDrag() {
		this.gizmoDrag.end()
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
		const want = this.altHeld && this.pointerInside && !this.leftDown && !this.gizmoDrag.active && !this.controller.isDragging && this.pipetteApplies()
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
		queueViewportHint(`Size ${editor.brush.radius.toFixed(1)}${f}`)
	}

	/** The zone and tile effect choices the tuft key was last made from, and that key. */
	private scopedFrom: ScopedEffects | null = null
	private scopedKey = ''
	private geKey = ''
	private geDensity = ''
	private geVersion = -1
	private gePalette: unknown = null
	private geEffects: unknown = null

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
		const doc = this.doc
		const region = doc.meta.region
		if (t.bakedRequested || !region || !wow.loaded) return
		t.bakedRequested = true
		RegionShadows(region.mapName, region.x, region.y, region.size)
			.then((s) => {
				if (!this.documents.includes(doc)) return
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
		if (this.refuseInWorld()) return
		if (this.shadowBaking) {
			setStatus('Shadows are still baking.')
			return
		}
		const doc = this.doc
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
					await yieldToFrame()
					if (!this.documents.includes(doc)) {
						setStatus('The shadow bake stopped: its map was closed.')
						return
					}
				}
			}
		} finally {
			this.shadowBaking = false
		}
		if (shape && kept) n = restoreOutsideShape(out, side, r, kept, shape, t.size, SHADOW_PER_CELL)
		// The bake may have ended on another tab; its stroke belongs to the map it started on.
		stroke.touch(r)
		const cmd = stroke.finish()
		if (cmd) doc.history.push(cmd)
		const from = models ? ` from the ground and ${models.count} models` : ' from the ground'
		const waiting = models?.loading ? ` ${models.loading} models still loading cast nothing; bake again once they show.` : ''
		setStatus((n ? `Baked the shadows ${where}${from}: ${n} texels changed.` : `The shadows ${where} were already so.`) + waiting, waiting ? 8000 : 4000)
	}

	/** Whether a shadow bake is running (bakeShadows). */
	private shadowBaking = false

	/**
	 * Terrain › Erode (#165): water drops and then thermal passes (terrain/erodeArea.ts) over the selected
	 * area or the whole map, as one undo step. It works on a copy of the heights a slice at a time between
	 * frames, reporting the share done to `progress`, and leaves the ground as it was when `cancelled`
	 * says so; the dialog that runs it stays up meanwhile, so nothing else edits the map. With `o.mask`
	 * the paint mask becomes where the ground settled (#242), in the same undo step. Returns whether it
	 * ran to the end.
	 */
	async erodeArea(o: ErodeSettings, progress: (f: number) => void, cancelled: () => boolean): Promise<boolean> {
		if (this.eroding) {
			setStatus('The ground is still eroding.')
			return false
		}
		const doc = this.doc
		const t = this.terrain
		const objects = this.objects
		const s = editor.selection
		const r = s && s.x1 > s.x0 && s.z1 > s.z0 ? { x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1 } : { x0: 0, z0: 0, x1: t.size, z1: t.size }
		const where = s ? 'in the selected area' : 'over the map'
		const w = r.x1 - r.x0 + 1
		const h = r.z1 - r.z0 + 1
		const V = t.verts
		const cs = t.cellSize
		const weights = new Float32Array(w * h)
		areaVertexWeights(s ? areaCells(t, t.size) : null, t.size, r, weights)
		const work = new Float32Array(w * h)
		for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) work[z * w + x] = t.heights[(r.z0 + z) * V + r.x0 + x] / cs
		this.eroding = true
		let finished = false
		try {
			finished = await erodePatch(work, w, h, weights, o, progress, cancelled)
		} finally {
			this.eroding = false
		}
		if (!this.documents.includes(doc)) {
			setStatus('The erosion stopped: its map was closed.')
			return false
		}
		if (!finished) {
			setStatus(`Erosion cancelled; the ground ${where} is as it was.`)
			return false
		}
		const resnap = (q: Rect) => this.objects.markRegionDirty(q.x0 * cs, q.z0 * cs, q.x1 * cs, q.z1 * cs)
		const stroke = new TerrainStroke(t, s ? 'Erode selection' : 'Erode map', { heights: true, mask: o.mask }, resnap)
		stroke.reserveHeights(r)
		let most = 0
		// With the mask (#242), each vertex's rise in yards: where the drops left their load and scree slid to.
		const gain = o.mask ? work : null
		for (let z = 0; z < h; z++) {
			for (let x = 0; x < w; x++) {
				const k = z * w + x
				const i = (r.z0 + z) * V + r.x0 + x
				const d = weights[k] ? work[k] * cs - t.heights[i] : 0
				if (gain) gain[k] = d
				if (!d) continue
				if (Math.abs(d) > most) most = Math.abs(d)
				t.heights[i] += d
			}
		}
		t.markDirty(r.x0, r.z0, r.x1, r.z1)
		stroke.touchHeights(r)
		objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
		let settled = 0
		if (gain) {
			// The sediment map takes the mask's place, so Fill Mask lays a texture only where the ground settled.
			const R = t.splatRes
			const all = { x0: 0, z0: 0, x1: R - 1, z1: R - 1 }
			stroke.reserveMask(all)
			t.mask.fill(0)
			settled = settledMask(gain, w, h, r.x0, r.z0, R / t.size, SETTLED_FULL, t.mask, R)
			stroke.touchMask(all)
			t.markMaskDirty()
		}
		const cmd = stroke.finish()
		if (cmd) doc.history.push(cmd)
		if (gain && doc === this.doc) this.refreshMaskState()
		const masked = !gain ? '' : settled ? `; the mask holds where it settled (Paint › Fill Mask with Paint Texture lays a texture there)` : '; nothing settled enough to mask'
		setStatus(`Eroded the ground ${where}: up to ${most.toFixed(1)} yd moved${masked}.`, gain ? 8000 : 4000)
		return true
	}

	/** Whether Terrain › Erode is running (erodeArea). */
	private eroding = false

	/**
	 * Terrain › Smooth Selection (#713): Sculpt › Smooth's 3x3 kernel (terrain/smoothArea.ts), `o.passes`
	 * passes at `o.strength`, over the selected area (its rectangle or free-form shape, the vertices whose
	 * cells are all in it) or the whole map, faded in from the area's edge over `o.width` yards with
	 * `o.falloff`. Works on a copy a slice at a time between frames, as erodeArea does, and writes the
	 * result as one undo step; `cancelled` leaves the ground as it was. Returns whether it ran to the end.
	 * With `o.mode` Raise, Lower, Flatten or Roughen (#721) it runs that one pass instead (`shapePatch`), over
	 * the same vertices with the same falloff, as one undo step.
	 */
	async smoothArea(o: SmoothAreaSettings, progress: (f: number) => void, cancelled: () => boolean): Promise<boolean> {
		if (this.smoothing) {
			setStatus('The ground is still being smoothed.')
			return false
		}
		const mode = o.mode ?? 'smooth'
		const doc = this.doc
		const t = this.terrain
		const s = editor.selection
		const r = s && s.x1 > s.x0 && s.z1 > s.z0 ? { x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1 } : { x0: 0, z0: 0, x1: t.size, z1: t.size }
		const where = s ? 'in the selected area' : 'over the map'
		const w = r.x1 - r.x0 + 1
		const h = r.z1 - r.z0 + 1
		const V = t.verts
		const cs = t.cellSize
		const weights = new Float32Array(w * h)
		areaVertexWeights(s ? areaCells(t, t.size) : null, t.size, r, weights)
		if (o.falloff) fadeFromEdge(weights, w, h, o.width / cs)
		const work = new Float32Array(w * h)
		for (let z = 0; z < h; z++) work.set(t.heights.subarray((r.z0 + z) * V + r.x0, (r.z0 + z) * V + r.x0 + w), z * w)
		let finished = false
		let target = NaN
		if (mode !== 'smooth') {
			// One pass, no slicing: a few million vertices at most, well under a frame's worth each.
			finished = !cancelled()
			if (finished) target = shapePatch(work, w, h, weights, o, r.x0, r.z0, cs)
			progress(1)
		} else {
			this.smoothing = true
			try {
				finished = await smoothPatch(work, w, h, weights, o, progress, cancelled)
			} finally {
				this.smoothing = false
			}
		}
		if (!this.documents.includes(doc)) {
			setStatus('The smoothing stopped: its map was closed.')
			return false
		}
		if (!finished) {
			setStatus(`${mode === 'smooth' ? 'Smoothing' : 'The pass was'} cancelled; the ground ${where} is as it was.`)
			return false
		}
		const resnap = (q: Rect) => doc.objects.markRegionDirty(q.x0 * cs, q.z0 * cs, q.x1 * cs, q.z1 * cs)
		const verb = { smooth: 'Smooth', raise: 'Raise', lower: 'Lower', flatten: 'Flatten', roughen: 'Roughen' }[mode]
		const stroke = new TerrainStroke(t, `${verb} ${s ? 'selection' : 'map'}`, { heights: true }, resnap)
		stroke.reserveHeights(r)
		let most = 0
		for (let z = 0; z < h; z++) {
			for (let x = 0; x < w; x++) {
				const k = z * w + x
				if (!weights[k]) continue
				const i = (r.z0 + z) * V + r.x0 + x
				const d = work[k] - t.heights[i]
				if (!d) continue
				if (Math.abs(d) > most) most = Math.abs(d)
				t.heights[i] = work[k]
			}
		}
		t.markDirty(r.x0, r.z0, r.x1, r.z1)
		stroke.touchHeights(r)
		doc.objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
		const cmd = stroke.finish()
		if (cmd) doc.history.push(cmd)
		const done = { smooth: 'Smoothed', raise: 'Raised', lower: 'Lowered', flatten: 'Flattened', roughen: 'Roughened' }[mode]
		const to = mode === 'flatten' && Number.isFinite(target) ? ` to ${target.toFixed(2)} yd` : ''
		const already = mode === 'smooth' ? 'was already smooth' : mode === 'flatten' ? 'was already flat' : 'did not change'
		setStatus(most ? `${done} the ground ${where}${to}: up to ${most.toFixed(2)} yd moved.` : `The ground ${where} ${already}.`, 4000)
		return true
	}

	/** Whether Terrain › Smooth Selection is running (smoothArea). */
	private smoothing = false

	/**
	 * Runs a Lua script (#28, Tools › Scripts…) on the active map: Noggit Red's script API over its
	 * terrain and models (script/prelude.ts, ScriptRun.ts), `print` going to `print`. Everything it changed,
	 * up to an error too, is one undo step named after it. A script that makes brushes (#29) becomes the
	 * Script Brush tool's (`scriptBrushes`, `file` its file in the scripts folder, '' for none), and the
	 * result names them. Null when it could not start (a world view, or a script already running).
	 */
	async runScript(code: string, name: string, print: (text: string) => void, file = ''): Promise<(ScriptResult & { brushes: string[] }) | null> {
		if (this.refuseInWorld()) return null
		if (this.scripting) {
			setStatus('A script is still running.')
			return null
		}
		this.scripting = true
		try {
			const doc = this.doc
			const folder = doc.meta.region?.mapName
			if (!doc.meta.vmangos && folder !== undefined) await this.loadMapIds()
			const { openScript } = await import('../script/luaRun')
			if (this.doc !== doc) return null
			const host = this.scriptHost(print)
			const { result, session } = await openScript(code, name, host)
			const cmd = host.finish(`Script ${name}`)
			if (cmd) doc.history.push(cmd)
			this.syncSelection()
			if (session) this.scriptBrushes.use(session, file)
			return { ...result, brushes: session?.brushes.map((b) => b.name) ?? [] }
		} finally {
			this.scripting = false
		}
	}

	/** A script host on the active map, its prints going to `print`. */
	private scriptHost(print: (text: string) => void, label = 'Script'): EngineScriptHost {
		const doc = this.doc
		const m = doc.meta
		const folder = m.region?.mapName
		const mapId = m.vmangos ? m.vmangos.mapId : folder !== undefined ? (this.mapIds?.get(folder.toLowerCase()) ?? -1) : -1
		const c = this.controller
		const s = editor.selection
		return new EngineScriptHost(
			doc.terrain,
			doc.objects,
			doc.liquids,
			{
				print,
				camera: () => {
					const p = this.persp.position
					return { x: p.x, y: p.y, z: p.z, pitch: THREE.MathUtils.radToDeg(c.pitch), yaw: THREE.MathUtils.radToDeg(c.yaw) }
				},
				target: () => ({ x: c.target.x, y: c.target.y, z: c.target.z }),
				mapId,
				areaAt: (x, z) => this.areaAt(x, z),
				area: s && s.x1 > s.x0 && s.z1 > s.z0 ? { x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1 } : null,
				loadImage: loadScriptImage,
				palette: () => editor.palette,
				setPalette: (p) => (editor.palette = p),
				effect: (tex, chunk) => {
					const t = doc.terrain
					const side = t.paintChunksPerSide
					const gx = chunk % side
					const gz = Math.floor(chunk / side)
					return effectAt(editor.palette[tex] ?? '', editor.textureEffects, editor.scopedEffects, t.areaIds[chunk], Math.floor(gx / 16), Math.floor(gz / 16), groundEffectTables())
				},
			},
			label,
		)
	}

	/**
	 * The Script Brush tool's brush script (#29): a stroke's host is the active map's, its prints go to the
	 * Scripts window's output, and its edits are one undo step on that map.
	 */
	readonly scriptBrushes = new ScriptBrushes({
		host: (label) => {
			if (this.refuseInWorld()) return null
			// The map's ID comes from the client's list, read in the background the first time.
			if (!this.doc.meta.vmangos && this.doc.meta.region) void this.loadMapIds()
			return { host: this.scriptHost((t) => scriptSay(t), label), history: this.doc.history }
		},
		after: () => this.syncSelection(),
	})

	/** Whether a script is running (runScript). */
	private scripting = false

	/** The rectangle the top-down camera frames while renderTopDown draws it, or null. */
	private minimapShot: { cx: number; cz: number; halfX: number; halfZ: number; top: number } | null = null
	private minimapTarget: THREE.WebGLRenderTarget | null = null
	/** The active map's highest ground, kept until its terrain or heights change (`groundTop`). */
	private groundTopKey: { terrain: Terrain | null; version: number; top: number } = { terrain: null, version: -1, top: -Infinity }

	/**
	 * The active map's highest ground, scanned once per change of its heights rather than once per shot:
	 * renderTopDown asks for every minimap tile and world-map zone (#554).
	 */
	private groundTop(): number {
		const t = this.terrain
		// Edits still waiting for the frame bump heightsVersion here, so the key sees them.
		t.update(this.renderer)
		const k = this.groundTopKey
		if (k.terrain === t && k.version === t.heightsVersion) return k.top
		let top = -Infinity
		const hs = t.heights
		for (let i = 0; i < hs.length; i++) if (hs[i] > top) top = hs[i]
		k.terrain = t
		k.version = t.heightsVersion
		k.top = top
		return top
	}

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
		const tile = TILE_CELLS * this.terrain.cellSize
		return this.renderTopDown(tx * tile, tz * tile, (tx + 1) * tile, (tz + 1) * tile, models, side, side)
	}

	/**
	 * Draws the rectangle x0..x1, z0..z1 of the map (editor yards) straight from above, as
	 * renderMinimapTile does a tile: `w` by `h` pixels of RGBA, row 0 at the north (z0) edge, column 0 at
	 * the west (x0). Drawn up to four times larger (as the GPU's largest target allows) and averaged down.
	 * The world map (#181) draws a zone this way.
	 */
	renderTopDown(x0: number, z0: number, x1: number, z1: number, models: 'none' | 'buildings' | 'all', w: number, h: number): Uint8Array {
		// Without a context (#209) the shot would be black, and it is written into the client.
		if (this.renderer.getContext().isContextLost()) throw new Error('the viewport lost its WebGL context; try again once it is back')
		const t = this.terrain
		const ground = this.groundTop()
		const top = editor.waterEnabled ? Math.max(editor.waterLevel, ground) : ground
		// Models stand up to a few hundred yards above the ground; the camera is far above that.
		this.minimapShot = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, halfX: (x1 - x0) / 2, halfZ: (z1 - z0) / 2, top: top + 400 }
		const ss = Math.max(1, Math.min(4, Math.floor(this.renderer.capabilities.maxTextureSize / Math.max(w, h))))
		const bigW = w * ss
		const bigH = h * ss
		// From that height the deepest ground may lie past the top-down view's far plane.
		const far = this.ortho.far
		this.ortho.far = ORTHO_HEIGHT + 400 + 20000
		// The shot is no frame of the view: the meter books none of it to the frame's sections.
		const metered = this.meter.on
		this.meter.on = false
		try {
			// Readied for the ortho camera (updateTopDown reads minimapShot), without drawing the view or
			// moving the clock.
			this.simulate(0, this.timer.getElapsed())
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
			set('refOpacity', 0)
			set('refEdit', 0)
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
			if (!rt || rt.width !== bigW || rt.height !== bigH) {
				rt?.dispose()
				rt = this.minimapTarget = new THREE.WebGLRenderTarget(bigW, bigH, { samples: 0 })
				rt.texture.colorSpace = THREE.SRGBColorSpace
				// three tone maps and converts to sRGB only when drawing to the screen or to an XR target, and
				// the minimap should look as the editor's view does. Stored as plain bytes, not as an sRGB
				// texture, which would encode the shader's already encoded colours a second time.
				;(rt as THREE.WebGLRenderTarget & { isXRRenderTarget: boolean }).isXRRenderTarget = true
				rt.texture.internalFormat = 'RGBA8'
			}
			const pix = new Uint8Array(bigW * bigH * 4)
			const prev = this.renderer.getRenderTarget()
			try {
				this.renderer.setRenderTarget(rt)
				this.renderer.clear()
				this.renderer.render(this.scene, this.ortho)
				this.renderer.readRenderTargetPixels(rt, 0, 0, bigW, bigH, pix)
				if (this.renderer.getContext().isContextLost()) throw new Error('the viewport lost its WebGL context; try again once it is back')
			} finally {
				this.renderer.setRenderTarget(prev)
				this.scene.background = background
				for (const c of hidden) c.visible = true
				// The shot drew the shadow maps without what it hid; the view's next frame draws them again.
				this.prefsChanged = true
				for (const [un, v] of saved) {
					if (un.value instanceof THREE.Vector4 && v instanceof THREE.Vector4) un.value.copy(v)
					else un.value = v
				}
			}
			// Averaged down ss by ss, and turned upright: GL reads the bottom row first.
			const out = new Uint8Array(w * h * 4)
			const n = ss * ss
			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					let r = 0
					let g = 0
					let b = 0
					for (let sy = 0; sy < ss; sy++) {
						const row = bigH - 1 - (y * ss + sy)
						for (let sx = 0; sx < ss; sx++) {
							const i = (row * bigW + x * ss + sx) * 4
							r += pix[i]
							g += pix[i + 1]
							b += pix[i + 2]
						}
					}
					const o = (y * w + x) * 4
					out[o] = Math.floor(r / n)
					out[o + 1] = Math.floor(g / n)
					out[o + 2] = Math.floor(b / n)
					out[o + 3] = 255
				}
			}
			return out
		} finally {
			this.meter.on = metered
			this.minimapShot = null
			this.ortho.far = far
			this.ortho.updateProjectionMatrix()
		}
	}

	/** Terrain › Clear Shadows: lights every baked shadow texel in the selected area or the whole map, as one undo step. */
	clearShadows() {
		if (this.refuseInWorld()) return
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
		// The key is rebuilt only when one of them changed: the palette, the map's effects and the scoped ones
		// are replaced as a whole on every edit, so identity tells.
		const version = this.objects.version
		if (this.geDensity !== density || this.geVersion !== version || this.gePalette !== editor.palette || this.geEffects !== editor.textureEffects || this.scopedFrom !== editor.scopedEffects) {
			this.geDensity = density
			this.geVersion = version
			this.gePalette = editor.palette
			this.geEffects = editor.textureEffects
			if (this.scopedFrom !== editor.scopedEffects) {
				this.scopedFrom = editor.scopedEffects
				this.scopedKey = JSON.stringify(editor.scopedEffects)
			}
			let k = `${density}|${version}|` + editor.palette.join('|')
			for (const [tex, id] of Object.entries(editor.textureEffects)) k += `|${tex}=${id}`
			this.geKey = k + this.scopedKey
		}
		const key = this.geKey
		// The client seeds each chunk's tufts by its place in the client's map: a region's tiles start at its first.
		const origin = this.tileOrigin(this.doc)
		// Tufts show as far as the fade lets them, which is farther at the corners of a wide view.
		layer.reach = tuftReach(this.persp.fov, this.persp.aspect)
		layer.update(this.viewEye(), editor.palette, editor.textureEffects, tables, key, performance.now(), this.objects, frillDensity(density), editor.scopedEffects, origin.x, origin.y)
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

	/** Whether the wheel tilts now: Z is held over the selected models, or over the Place tool's preview. */
	private tiltScrolls(): boolean {
		return this.tiltHeld && (this.canNudge() || (editor.tool === 'place' && !!editor.prefab && !editor.placeScatter && !ui.placeCreature && !ui.placeObject))
	}

	/**
	 * Tilts (forward or back) or rolls (to a side, `roll`) each selected model by `degrees` about its own
	 * axes, Z+scroll (#344). Steps in a row on the same selection are one undo step, as the nudge keys are.
	 */
	tiltSelected(degrees: number, roll: boolean) {
		const targets = movableSelection(this.objects)
		if (!targets.length) return
		const now = performance.now()
		const s = this.nudgeSession
		const key = targets.map((o) => o.id).join(',')
		const continuing = !!s && s.key === key && this.history.peek() === s.cmd && now - s.time < 1500
		const before = continuing ? s.before : targets.map((o) => ({ ...o }))
		for (const o of targets) {
			if (roll) o.tiltZ = stepTilt(o.tiltZ ?? 0, degrees)
			else o.tiltX = stepTilt(o.tiltX ?? 0, degrees)
			this.objects.touch(o.id)
			if (editor.selected?.id === o.id) editor.selected = { ...o }
		}
		const cmd = groupTransformCommand(this.objects, before, targets, targets.length > 1 ? `Tilt ${targets.length} objects` : 'Tilt')
		if (continuing) this.history.replaceTop(cmd)
		else this.history.push(cmd)
		this.nudgeSession = { key, before, cmd, time: now }
		const o = targets[0]
		setViewportHint(`Tilt ${tiltDeg(o.tiltX ?? 0)}°, roll ${tiltDeg(o.tiltZ ?? 0)}°${targets.length > 1 ? ' (first of the selection)' : ''}`)
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
		if (ui.referenceAdjust && e.key === 'Escape') {
			ui.referenceAdjust = false
			setStatus('Stopped placing the reference image.', 2000)
			return true
		}
		if (this.navPick && e.key === 'Escape') {
			this.navPick = false
			this.nav.clearPath()
			setStatus('Stopped the path test.', 2000)
			return true
		}
		if (ui.pasting && this.lastCopied === 'area' && (e.key === 'r' || e.key === 'R')) {
			this.rotateClip()
			return true
		}
		if (ui.pasting && this.lastCopied === 'objects' && (e.key === 'r' || e.key === 'R')) {
			this.turnPastedModels((e.shiftKey ? 1 : -1) * THREE.MathUtils.degToRad(45))
			return true
		}
		if (this.spawnActions.handleKey(e)) return true
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
		this.history.push(addedCommand(this.objects, added, 'Import object list'))
	}

	/** Sculpt's Vertex mode: flatten the selected vertices to their mean height, or clear the selection. */
	/** Runs `fn` on the Path tool, for the options bar's path controls (#167). */
	path<T>(fn: (tool: PathTool, ctx: ToolContext) => T): T {
		return fn(this.pathTool, this.ctx)
	}

	vertexAction(action: 'flatten' | 'clear') {
		;(this.tools.sculpt as SculptTool).vertexAction(this.ctx, action)
	}

	/**
	 * Removes models that stand exactly where another model of the same type stands, keeping the
	 * first of each. One undo step. Positions and turns are compared to a hundredth.
	 */
	removeDuplicateModels() {
		if (this.refuseInWorld()) return
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
		const cmd = removedCommand(this.objects, dupes)
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
		let x0 = 0,
			z0 = 0,
			x1 = side - 1,
			z1 = side - 1
		if (scope === 'tile') {
			const tile = this.tileUnderCamera()
			if (!tile) return null
			x0 = tile.x0
			z0 = tile.z0
			x1 = Math.min(side - 1, x0 + tile.cells)
			z1 = Math.min(side - 1, z0 + tile.cells)
		}
		let lo = Infinity,
			hi = -Infinity
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
		if (this.refuseInWorld()) return
		const t = this.terrain
		const tile = this.tileUnderCamera()
		if (!tile) {
			setStatus('The camera is not over the map.', 3000)
			return
		}
		const { tx, tz, name } = tile
		const x0 = tx * TILE_CELLS * t.cellSize,
			z0 = tz * TILE_CELLS * t.cellSize
		const x1 = x0 + TILE_CELLS * t.cellSize,
			z1 = z0 + TILE_CELLS * t.cellSize
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
			const cmd = removedCommand(this.objects, gone)
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
			const px = (c % side) * per,
				pz = Math.floor(c / side) * per
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
		this.setGroups(
			ids.map((id) => ({ id, from: this.objects.objects.get(id)!.group, to: g })),
			`Group ${ids.length} models`,
		)
		setStatus(`Grouped ${ids.length} models: a click on one selects them all. ${keysOf('ungroup')} ungroups them.`, 5000)
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
		for (const g of groups) for (const id of this.objects.groupMembers(g)) changes.push({ id, from: g, to: undefined })
		this.setGroups(changes, groups.size === 1 ? 'Ungroup models' : `Ungroup ${groups.size} groups`)
		setStatus(`Ungrouped ${changes.length} models.`, 4000)
	}

	/** Sets objects' selection groups as one undo step; `to` undefined takes an object out of its group. */
	private setGroups(changes: Array<{ id: number; from: number | undefined; to: number | undefined }>, label: string) {
		const objects = this.objects
		const apply = (to: boolean) => {
			for (const c of changes) {
				// Through setGroup, which keeps ObjectLayer's group index (#630).
				objects.setGroup(c.id, to ? c.to : c.from)
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
			setStatus(`Copy one model first (select it, ${keysOf('copy')}), then select the models to replace with it.`, 6000)
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
		// A region's edge against the client's tiles around it (#195).
		const region = editor.regionBlock && editor.regionMap ? { map: editor.regionMap, ...editor.regionBlock } : null
		let edges: EdgeSegment[] | null = null
		if ('go' in window && region) edges = await RegionEdges(region.map, region.x, region.y, region.size).catch(() => null)
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
			edges,
			spawnIds: 'go' in window && region ? (q) => CheckSpawnIDs(vmangos.SpawnIDQuery.createFrom(q)) : null,
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
		let x = 0,
			z = 0
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
			textures.push(this.detailTexture(editor.palette[idx] ?? '', sums[k] / (SPLAT_PER_CELL * SPLAT_PER_CELL * 255), tables))
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

	/** A texture layer of the Detail info readout: its short name, its share (0 to 1) as a percent, and its ground effect. */
	private detailTexture(path: string, share: number, tables: ReturnType<typeof groundEffectTables>): DetailInfo['textures'][number] {
		const name = path.startsWith('#') ? path : path.slice(path.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
		return { name, weight: Math.round(share * 100), effect: effectFor(path, editor.textureEffects, tables) }
	}

	private worldCursorAt = new THREE.Vector3()

	/** A world view's streamed ground under the cursor (#15), or null off it. Marches the ray, so it runs with the 2 Hz stats only. */
	private worldCursor(): THREE.Vector3 | null {
		if (!this.pointerInside) return null
		this.raycaster.setFromCamera(this.ndc, this.camera)
		const r = this.raycaster.ray
		const d = marchGround(this.worldHeight, r.origin.x, r.origin.y, r.origin.z, r.direction.x, r.direction.y, r.direction.z, 4000, 2)
		return d < 0 ? null : r.at(d, this.worldCursorAt)
	}

	/**
	 * The Detail info readout of a world view (#15) at its ground point `p`, from what the stream holds
	 * of the tile there: its texture layers only once read (near the camera). The cell is on the whole
	 * map, as a region's is on its block.
	 */
	private worldDetailInfo(p: THREE.Vector3 | null): DetailInfo | null {
		const world = this.doc.world
		const t = p && world ? world.tileAt(p.x, p.z) : null
		if (!p || !world || !t) return null
		const d = worldCellDetail(t, p.x, p.z)
		const tables = groundEffectTables()
		const gx = t.x * TILE_CHUNKS + d.chunkX
		const gz = t.y * TILE_CHUNKS + d.chunkY
		const chunkYards = TILE_YARDS / TILE_CHUNKS
		let models = 0
		for (const o of this.objects.objects.values()) {
			if (o.parent === undefined && Math.floor(o.x / chunkYards) === gx && Math.floor(o.z / chunkYards) === gz) models++
		}
		return {
			tile: `${t.x}, ${t.y}`,
			chunk: `${d.chunkX}, ${d.chunkY}`,
			cell: `${t.x * TILE_CELLS + d.cellX}, ${t.y * TILE_CELLS + d.cellY}`,
			height: world.heightAt(p.x, p.z),
			slope: groundSlopeDeg((x, z) => world.heightAt(x, z), p.x, p.z, TILE_YARDS / TILE_CELLS),
			hole: d.hole,
			noTufts: d.noTufts,
			impassable: d.impassable,
			area: d.area ? `${areaName(d.area)} (${d.area})` : '',
			room: this.roomName(),
			textures: (d.textures ?? []).map((x) => this.detailTexture(x.path, x.weight, tables)),
			liquids: d.liquids.map((l) => `${liquidType(l.type).name} at ${l.height.toFixed(1)}`),
			models,
		}
	}

	/** The object id of the active map's building when the map is a single building (WMO-only, #271), else null. */
	private wmoOnlyBuilding(): number | null {
		const region = this.doc.meta.region
		if (!region?.wmoOnly) return null
		for (const [id, uid] of region.uids) if (uid === GLOBAL_UID) return id
		return null
	}

	/**
	 * Runs the portal flood of the WMO the camera is in and hands the gate its groups, and fades the
	 * room's fog in or out over the scene's.
	 */
	private updateRoomGate(dt: number) {
		const r = this.rooms.current
		beginRoomGates()
		if (!this.topDown) {
			if (r) {
				this.roomClip.copy(this.viewProj).multiply(r.matrix)
				const pvs = this.roomFlood.run(r.nav, r.seeds, r.eye, this.roomClip)
				addRoomGate(r.origin, pvs.visible, pvs.fog)
				this.roomAdmit.set(r.nav, r.matrix, pvs.visible, this.roomGround)
			}
			// The other buildings in view are flooded from outside (#116): an interior shows only where a
			// doorway does.
			for (const w of this.rooms.outside(this.objects, this.viewFrustum, this.camera.position, ROOM_MAX_GATED - 1, this.wmoOnlyBuilding())) {
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
		const cmd = this.chunkStroke(label, chunks, edit)
		if (cmd) this.history.push(cmd)
	}

	/** editChunks' step, made and applied but not pushed, for a caller that adds to it. */
	private chunkStroke(label: string, chunks: number[], edit: (c: number) => void) {
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
		return stroke.finish()
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
		if (this.refuseInWorld()) return
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
	 * Restore the Client's Paint (#645): puts the selected area's chunks (or every chunk) back to `base`,
	 * the region's paint as the client has it without Meld's patch (tilePaint of LoadBaseRegionPaint), as
	 * one undo step with the textures the palette lacked. The next compile then finds those chunks
	 * unpainted and writes the client's own alpha (#526). Returns the status line.
	 */
	restoreClientPaint(base: { palette: string[]; weights: Uint8Array; chunkSlots: Uint8Array }): string {
		const t = this.terrain
		if (base.weights.length !== t.weights.length || base.chunkSlots.length !== t.chunkSlots.length) {
			return "The client's tiles do not cover this map's ground."
		}
		const side = t.paintChunksPerSide
		const where = editor.selection ? ' in the selected area' : ''
		const scope = editor.selection ? this.selectedChunks() : Array.from({ length: side * side }, (_, c) => c)
		const plan = planRestore(t, editor.palette, base, base.palette, scope, side, t.splatRes)
		if ('full' in plan) return `This map's texture palette has no room for ${plan.full.length} of the client's textures${where} (${MAX_PALETTE} at most).`
		if (!plan.changed.length) return `The paint${where} is the client's already.`
		const n = plan.changed.length
		const before = [...editor.palette]
		const after = plan.palette
		editor.palette = [...after]
		const cmd = this.chunkStroke('', plan.changed, (c) => restoreChunk(t, base, plan.remap, c, side, t.splatRes))
		if (cmd) {
			this.history.push({
				label: `Restore the client's paint in ${n} chunk${n === 1 ? '' : 's'}`,
				bytes: cmd.bytes,
				undo: () => {
					cmd.undo()
					editor.palette = [...before]
				},
				redo: () => {
					editor.palette = [...after]
					cmd.redo()
				},
			})
		} else editor.palette = before
		return `Restored the client's paint in ${n} chunk${n === 1 ? '' : 's'}${where}. Compile to Client writes its own alpha maps back there.`
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
		if (this.refuseInWorld()) return
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
