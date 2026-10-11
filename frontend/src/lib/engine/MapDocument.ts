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
  texScale: number
  waterLevel: number
  waterEnabled: boolean
  paintLayer: number
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
