import { noRoles, type TextureRoles } from '../terrain/roles'
import { GroundEffectLayer } from '../world/GroundEffectLayer'
import { noScopedEffects, type ScopedEffects, type TextureEffects } from '../world/groundEffects'
import type { TextureLooks } from '../world/textureLooks'
import type { ReferenceImage } from '../terrain/referenceImage'
import type { LoadedReference } from '../io/referenceLoad'
import type { PendingAnswer } from '../io/regionKey'
import type { MapPath } from '../terrain/paths'
import * as THREE from 'three'
import { CELL_SIZE, Terrain } from '../terrain/Terrain'
import { Water } from '../water/Water'
import { LiquidMap } from '../water/liquids'
import { LiquidRenderer } from '../water/LiquidRenderer'
import { ObjectLayer } from '../world/ObjectLayer'
import { SpawnLayer } from '../world/SpawnLayer'
import type { WorldStream } from '../world/WorldStream'
import { History } from '../state/history'
import { LAYERS } from '../terrain/layers'
import type { MapInfo } from './mapInfo'

// Kept in a plain module so io/mapData.ts and its test need no runes state.
export { defaultMapInfo, type MapInfo } from './mapInfo'

/** Per-map editor settings that are swapped in/out of `editor` on tab switch. */
export interface DocMeta {
	mapName: string
	filePath: string
	dirty: boolean
	/** The texture palette: a WoW tileset path or a '#rrggbb' colour per entry. */
	palette: string[]
	/** The block of client tiles this map was opened from, which saves go back to. */
	region: RegionRef | null
	/** For a map made for the client: its folder and map ID, which the export writes under. */
	vmangos: VmangosRef | null
	/** Named camera views of this map, kept with it. */
	bookmarks: Bookmark[]
	waterLevel: number
	waterEnabled: boolean
	paintLayer: number
	/** The palette index the Sculpt tool paints while sculpting (editor.sculptPaintLayer). */
	sculptPaintLayer: number
	/** The palette entries that are the map's rock and dirt (editor.roles), saved with the map. */
	roles: TextureRoles
	/** The map's own ground effect per texture path (editor.textureEffects), saved with the map. */
	textureEffects: TextureEffects
	/** The map's own look flags per texture path (editor.textureLooks), saved with the map. */
	textureLooks: TextureLooks
	/** The map's ground effect choices per zone and per tile (editor.scopedEffects), saved with the map. */
	scopedEffects: ScopedEffects
	/** The map's reference image record (editor.reference), saved with the map. */
	reference: ReferenceImage | null
	/** The map's paths (editor.paths, the Path tool), saved with the map. */
	paths: MapPath[]
	/** The Flatten tool's locked point (editor.flattenLock), a position on this map; unset means off (#449). */
	flattenLock?: { on: boolean; x: number; y: number; z: number }
	/** The water brush's lock and its locked point (editor.water.lock, lockPos), a position on this map (#449). */
	waterLock?: { on: boolean; pos: { x: number; y: number; z: number } }
}

/** A saved camera view: where it looks at, and from what angle and distance. */
export interface Bookmark {
	name: string
	x: number
	y: number
	z: number
	yaw: number
	pitch: number
	distance: number
}

/** A map made for the 1.12 client: its folder under World\Maps, and its map ID. */
export interface VmangosRef {
	dir: string
	mapId: number
	/** The map's own Map.dbc and map_template facts (Map Properties); absent until set. */
	info?: MapInfo
	/**
	 * The client tile at the terrain's north-west corner on the 64×64 grid, where publish puts it (#46);
	 * absent for 0, as every map made before sat at the grid's corner.
	 */
	tileX?: number
	tileY?: number
	/**
	 * Which tiles of the terrain's square are the map's, a '1' or '0' a tile row by row
	 * (terrain/tileMask.ts); absent for every tile. A tile left out is not drawn, picked or published,
	 * and keeps its ground.
	 */
	tiles?: string
}

/**
 * A square block of 1.12 map tiles in the client: the tile it starts at, and how many tiles a side.
 * `uids` ties each model's editor object to its unique ID in the client's files, so a save writes
 * the model back as it was. A model added in the editor has no entry.
 */
export interface RegionRef {
	mapName: string
	x: number
	y: number
	size: number
	uids: Map<number, number>
	/**
	 * The map is a single building with no tiles (a WMO-only dungeon, #271): the terrain is a hidden
	 * stand-in, and a save writes only the building's WDT.
	 */
	wmoOnly?: boolean
}

/** The unique ID a WMO-only map's WDT gives its building (vmangos.GlobalUID). */
export const GLOBAL_UID = 0xffffffff

/** The region's tile range, for example "Azeroth tiles 32–35 × 48–51 (4×4)". */
export function regionLabel(r: RegionRef): string {
	const x1 = r.x + r.size - 1
	const y1 = r.y + r.size - 1
	return `${r.mapName} tiles ${r.x}–${x1} × ${r.y}–${y1} (${r.size}×${r.size})`
}

export interface DocCamera {
	target: THREE.Vector3
	yaw: number
	pitch: number
	distance: number
}

let nextId = 1

/**
 * One open map: its terrain, water, placed objects, undo history, settings
 * and camera. The Engine renders exactly one document (the active tab).
 */
export class MapDocument {
	readonly id = nextId++
	readonly terrain: Terrain
	readonly water: Water
	readonly objects: ObjectLayer
	/** The grass tufts and flowers the game grows on the ground's textures. */
	readonly groundEffects: GroundEffectLayer
	readonly spawnLayer = new SpawnLayer()
	/** Why the region's spawns could not be read, for the UI; '' when they loaded or were not asked for. */
	spawnsError = ''
	/** The map's painted liquids (lakes, rivers, lava…), per chunk, as noggit edits them. */
	readonly liquids: LiquidMap
	readonly liquidRenderer: LiquidRenderer
	/**
	 * Whether the terrain's holes are all of the region's. A map saved before the file kept holes opens
	 * without them, and a region's export then adds the holes cut since to the client's rather than
	 * filling the client's in (#663). Kept across saves as `liquidsKnown` is (`holesUnknown`).
	 */
	holesKnown = true
	/**
	 * Whether `liquids` holds the region's liquids. A region saved before maps kept liquids opens
	 * without them, and its export then leaves the client's liquids alone. Saved again, the file says
	 * so (the header's `liquidsUnknown`, #525), so it opens the same way.
	 */
	liquidsKnown = true
	/**
	 * Whether the terrain's area IDs, chunk flags and no-effect cells are the map's own. A map saved
	 * before the file kept them opens without them, and a region's export then leaves the client's
	 * chunk headers alone. Kept across saves as `liquidsKnown` is (`chunkDataUnknown`).
	 */
	chunkDataKnown = true
	readonly history = new History()
	/**
	 * What the client was last known to hold of this region (#214): the compile fingerprint
	 * (`Engine.regionKey`) when it was opened from the client or last compiled, and the history's
	 * change count then. A null key is unknown, as for a region opened from a file.
	 */
	compiled: { key: string | null; changes: number } = { key: null, changes: -1 }
	/**
	 * For a region with no compiled key, the Go side's last answer to whether the client lacks its edits
	 * (io/compile.ts `regionUncompiled`, io/regionKey.ts `cachedPending`), so Launch, Play Here and growing
	 * the region don't rebuild the block each time until it is edited (#531). Null until first asked.
	 */
	pending: PendingAnswer | null = null
	/** The palette the terrain's shader was last given, as one string, to tell when it changes. */
	paletteFrom: unknown = null
	meta: DocMeta
	camera: DocCamera | null = null
	/** The reference image's pixels and texture, read from `meta.reference`'s path (io/referenceLoad.ts); null until read. */
	referenceImage: LoadedReference | null = null
	/**
	 * For a world view (#15), the second kind of document: the client's tiles of a whole map streamed
	 * around the camera, in the map's editor coordinates (tile (x, y) at x*TILE_YARDS, y*TILE_YARDS).
	 * Nothing in it is edited: its terrain is a hidden stand-in, its tools are off, and Edit Here
	 * opens the block around the camera in a region tab. The loaded tiles' models are in `objects`,
	 * placed and taken away by the stream. Null for every other map.
	 */
	world: WorldStream | null = null

	constructor(size: number, name: string, cellSize = CELL_SIZE) {
		this.terrain = new Terrain(size, cellSize)
		this.water = new Water(this.terrain)
		this.liquids = new LiquidMap(size)
		this.liquidRenderer = new LiquidRenderer(this.liquids, this.terrain.cellSize)
		this.objects = new ObjectLayer(this.terrain)
		this.groundEffects = new GroundEffectLayer(this.terrain)
		this.meta = {
			mapName: name,
			filePath: '',
			dirty: false,
			palette: LAYERS.map((l) => l.swatch),
			region: null,
			vmangos: null,
			bookmarks: [],
			waterLevel: 0,
			waterEnabled: true,
			paintLayer: 0,
			sculptPaintLayer: 0,
			roles: noRoles(),
			textureEffects: {},
			textureLooks: {},
			scopedEffects: noScopedEffects(),
			reference: null,
			paths: [],
		}
	}

	/** Untitled, unsaved and untouched: safe to replace when opening a file. */
	get pristine() {
		return !this.world && !this.meta.dirty && !this.meta.filePath && this.objects.objects.size === 0 && !this.history.peek()
	}

	/** Adds every model type the map holds or draws to `into`: its objects, spawns and tufts (#505). */
	modelTypes(into: Set<string>): Set<string> {
		this.objects.modelTypes(into)
		this.spawnLayer.modelTypes(into)
		this.groundEffects.modelTypes(into)
		return into
	}

	dispose() {
		// First: it takes its models out of `objects`.
		this.world?.dispose()
		this.groundEffects.dispose()
		this.terrain.dispose()
		this.water.dispose()
		this.objects.dispose()
		this.spawnLayer.dispose()
		this.liquidRenderer.dispose()
		this.referenceImage?.dispose()
		this.referenceImage = null
	}
}
