import { noRoles, type TextureRoles } from '../terrain/roles'
import { GroundEffectLayer } from '../world/GroundEffectLayer'
import { noScopedEffects, type ScopedEffects, type TextureEffects } from '../world/groundEffects'
import type { TextureLooks } from '../world/textureLooks'
import * as THREE from 'three'
import { CELL_SIZE, Terrain } from '../terrain/Terrain'
import { Water } from '../water/Water'
import { LiquidMap } from '../water/liquids'
import { LiquidRenderer } from '../water/LiquidRenderer'
import { ObjectLayer } from '../world/ObjectLayer'
import { SpawnLayer } from '../world/SpawnLayer'
import { History } from '../state/history'
import { LAYERS } from '../terrain/layers'

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
}

/** What a map made for the client says about itself (vmangos.MapInfo): written on publish. */
export interface MapInfo {
  /** 0 a world map, 1 a dungeon, 2 a raid, 3 a battleground. */
  type: number
  name: string
  areaId: number
  loadingScreen: number
  maxPlayers: number
  ghostMap: number
  ghostX: number
  ghostY: number
  /** A WMO-only map: the map is its first building, with no ground, as the client's Blackfathom Deeps. */
  wmoOnly?: boolean
}

export const defaultMapInfo = (): MapInfo => ({ type: 0, name: '', areaId: 0, loadingScreen: 0, maxPlayers: 0, ghostMap: -1, ghostX: 0, ghostY: 0 })

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
}

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
   * Whether `liquids` holds the region's liquids. A region saved before maps kept liquids opens
   * without them, and its export then leaves the client's liquids alone.
   */
  liquidsKnown = true
  /**
   * Whether the terrain's area IDs, chunk flags and no-effect cells are the map's own. A map saved
   * before the file kept them opens without them, and a region's export then leaves the client's
   * chunk headers alone.
   */
  chunkDataKnown = true
  readonly history = new History()
  /** The palette the terrain's shader was last given, as one string, to tell when it changes. */
  paletteKey = ''
  meta: DocMeta
  camera: DocCamera | null = null

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
    }
  }

  /** Untitled, unsaved and untouched: safe to replace when opening a file. */
  get pristine() {
    return !this.meta.dirty && !this.meta.filePath && this.objects.objects.size === 0 && !this.history.peek()
  }

  dispose() {
    this.groundEffects.dispose()
    this.terrain.dispose()
    this.water.dispose()
    this.objects.dispose()
    this.spawnLayer.dispose()
    this.liquidRenderer.dispose()
  }
}
