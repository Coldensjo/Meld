import * as THREE from 'three'
import { CELL_SIZE, Terrain } from '../terrain/Terrain'
import { Water } from '../water/Water'
import { ObjectLayer } from '../world/ObjectLayer'
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
  texScale: number
  waterLevel: number
  waterEnabled: boolean
  paintLayer: number
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
  readonly history = new History()
  /** The palette the terrain's shader was last given, as one string, to tell when it changes. */
  paletteKey = ''
  meta: DocMeta
  camera: DocCamera | null = null

  constructor(size: number, name: string, cellSize = CELL_SIZE) {
    this.terrain = new Terrain(size, cellSize)
    this.water = new Water(this.terrain.worldSize)
    this.objects = new ObjectLayer(this.terrain)
    this.meta = {
      mapName: name,
      filePath: '',
      dirty: false,
      palette: LAYERS.map((l) => l.swatch),
      region: null,
      vmangos: null,
      bookmarks: [],
      texScale: 8,
      waterLevel: 0,
      waterEnabled: true,
      paintLayer: 0,
    }
  }

  /** Untitled, unsaved and untouched: safe to replace when opening a file. */
  get pristine() {
    return !this.meta.dirty && !this.meta.filePath && this.objects.objects.size === 0 && !this.history.peek()
  }

  dispose() {
    this.terrain.dispose()
    this.water.dispose()
    this.objects.dispose()
  }
}
