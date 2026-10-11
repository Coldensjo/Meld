import {
  BrowseVmangosFolder,
  ExportTileHeights,
  LoadMap,
  LoadTile,
  OpenMapDialog,
  PublishVmangosMap,
  SaveMap,
  SaveMapDialog,
  SetVmangosPath,
  VmangosPath,
} from '../../../wailsjs/go/main/App'
import { mapfile } from '../../../wailsjs/go/models'
import type { Engine, MapSnapshot } from '../engine/Engine'
import { editor, setStatus, ui } from '../state/editor.svelte'
import { base64ToBytes, bytesToBase64 } from './base64'
import { tilePaint } from './tileImport'
import { mapToTiles } from './vmangosExport'
import { vmangos } from '../../../wailsjs/go/models'
import { EventsOn } from '../../../wailsjs/runtime/runtime'

/** True when running inside the Wails webview (Go bindings available). */
export const hasBackend = () => typeof (window as unknown as { go?: unknown }).go !== 'undefined'

function toMapData(s: MapSnapshot): mapfile.MapData {
  return mapfile.MapData.createFrom({
    name: s.name,
    size: s.size,
    cellSize: s.cellSize,
    splatRes: s.splatRes,
    waterLevel: s.waterLevel,
    waterEnabled: s.waterEnabled,
    objects: s.objects,
    palette: s.palette,
    texScale: s.texScale,
    heights: bytesToBase64(s.heights),
    weights: bytesToBase64(s.weights),
    chunkSlots: bytesToBase64(s.chunkSlots),
  })
}

function fromMapData(m: mapfile.MapData): MapSnapshot {
  const common = {
    name: m.name,
    size: m.size,
    cellSize: m.cellSize,
    splatRes: m.splatRes,
    waterLevel: m.waterLevel,
    waterEnabled: m.waterEnabled,
    objects: (m.objects ?? []).map((o, i) => ({ ...o, id: o.id || 100000 + i, parent: o.parent || undefined })),
    texScale: m.texScale ?? 0,
    heights: base64ToBytes(m.heights),
  }
  if (m.version === 1) {
    // Format 1: eight global layers, converted when the map opens.
    return {
      ...common,
      palette: [],
      weights: new Uint8Array(0),
      chunkSlots: new Uint8Array(0),
      legacy: { layerTextures: m.layerTextures ?? [], splatA: base64ToBytes(m.splatA ?? ''), splatB: base64ToBytes(m.splatB ?? '') },
    }
  }
  return {
    ...common,
    palette: m.palette ?? [],
    weights: base64ToBytes(m.weights ?? ''),
    chunkSlots: base64ToBytes(m.chunkSlots ?? ''),
  }
}

async function guarded(label: string, fn: () => Promise<void>) {
  if (!hasBackend()) {
    setStatus('File operations need the desktop app (run via `wails dev`).')
    return
  }
  if (ui.busy) return
  ui.busy = true
  try {
    await fn()
  } catch (err) {
    console.error(err)
    setStatus(`${label} failed: ${err}`, 8000)
  } finally {
    ui.busy = false
  }
}

export function saveMap(engine: Engine, saveAs = false) {
  return guarded('Save', async () => {
    let path = editor.filePath
    if (!path || saveAs) {
      path = await SaveMapDialog(editor.mapName)
      if (!path) return
    }
    const t0 = performance.now()
    await SaveMap(path, toMapData(engine.snapshot()))
    editor.filePath = path
    editor.dirty = false
    engine.refreshTabs()
    setStatus(`Saved ${path} (${Math.round(performance.now() - t0)} ms)`)
  })
}

export function openMap(engine: Engine) {
  return guarded('Open', async () => {
    const path = await OpenMapDialog()
    if (!path) return
    if (engine.focusPath(path)) {
      setStatus('That map is already open.')
      return
    }
    const t0 = performance.now()
    const data = await LoadMap(path)
    engine.openDocument(fromMapData(data), path)
    setStatus(`Loaded ${path} (${Math.round(performance.now() - t0)} ms)`)
  })
}

/** Paint chunks a side in a 1.12 tile. */
const TILE_CHUNKS = 16

/** Opens a tile of the client in a new tab (or switches to it if it's open). */
export function openWowTile(engine: Engine, mapName: string, x: number, y: number) {
  return guarded('Open tile', async () => {
    const view = await LoadTile(mapName, x, y)
    const paint = tilePaint(
      view.chunks.map((c) => ({
        indexX: c.indexX,
        indexY: c.indexY,
        layers: (c.layers ?? []).map((l) => ({ texture: l.texture, alpha: l.alpha ? base64ToBytes(l.alpha) : undefined })),
      })),
      TILE_CHUNKS,
    )
    const t0 = performance.now()
    const opened = engine.openTile({
      mapName,
      x,
      y,
      heights: Float32Array.from(view.heights),
      weights: paint.weights,
      chunkSlots: paint.chunkSlots,
      palette: paint.palette,
    })
    if (!opened) {
      setStatus(`${mapName} ${x}_${y} is already open.`)
      return
    }
    const notes = [
      paint.dropped ? `${paint.dropped} extra layers left out (a chunk takes four)` : '',
      view.placements.length ? `${view.placements.length} placed models aren't imported yet` : '',
    ].filter(Boolean)
    setStatus(
      `Opened ${mapName} ${x}_${y} (${Math.round(performance.now() - t0)} ms)${notes.length ? '. ' + notes.join('; ') : ''}`,
      8000,
    )
  })
}

/**
 * Writes the active tile's edited heights into the client's patch, for the server to build from.
 * Only heights are written so far: paint and objects stay as the client has them.
 */
export function exportWowTile(engine: Engine) {
  return guarded('Export tile', async () => {
    const tile = engine.activeTile()
    if (!tile) {
      setStatus('This map is not a client tile. Open one with File › Open WoW Tile…')
      return
    }
    const patch = await ExportTileHeights(tile.mapName, tile.x, tile.y, Array.from(engine.outerHeights()))
    const server = await VmangosPath()
    const next = server ? ` Run update-maps.bat in ${server} to rebuild the server's map data.` : ''
    setStatus(`Wrote the heights of ${tile.mapName} ${tile.x}_${tile.y} to ${patch}.${next} Paint and objects are not exported yet.`, 10000)
  })
}

/** Asks for the VMaNGOS server folder that the map data is built in. */
export async function chooseVmangosFolder() {
  if (!hasBackend()) return
  try {
    const dir = await BrowseVmangosFolder()
    if (!dir) return
    await SetVmangosPath(dir)
    setStatus(`VMaNGOS folder: ${dir}`)
  } catch (e) {
    setStatus(`Not a VMaNGOS server folder: ${e}`, 8000)
  }
}

let lastMapId = 0
let listening = false

/** Routes progress from the background publish to the status bar, once. */
function listenToPublish() {
  if (listening) return
  listening = true
  EventsOn('publish:log', (line: string) => setStatus(line, 0))
  EventsOn('publish:done', (msg: string) => {
    ui.busy = false
    if (msg) setStatus(`Publish failed: ${msg}`, 0)
    else setStatus(`Map published. In game, type .go xyz 16800 16800 10 ${lastMapId} to go there.`, 15000)
  })
}

/**
 * Publishes a map made for the client: it's written into the client's patch, added to the server, and the
 * server's map data is extracted again before the world server restarts. Runs in the background.
 */
export function publishVmangosMap(engine: Engine) {
  return guarded('Publish', async () => {
    const ref = engine.activeVmangos()
    if (!ref) {
      setStatus('Only a map made for the client publishes this way. Make one with File › New Map…, ticking “For the WoW 1.12 client”.')
      return
    }
    listenToPublish()
    const input = engine.exportInput()
    const out = mapToTiles(input)
    const notes: string[] = []
    if (out.colorChunks) notes.push(`${out.colorChunks} chunks painted with a colour were left out`)
    if (out.outside) notes.push(`${out.outside} models outside the map were left out`)
    lastMapId = ref.mapId
    ui.busy = true
    setStatus(`Publishing ${ref.dir}…${notes.length ? ' ' + notes.join('. ') + '.' : ''}`, 0)
    try {
      await PublishVmangosMap(
        vmangos.MapSpec.createFrom({
          Dir: ref.dir,
          MapID: ref.mapId,
          Tiles: out.tiles,
          Water: input.waterEnabled,
          WaterLevel: input.waterLevel,
        }),
      )
    } catch (e) {
      ui.busy = false
      throw e
    }
  })
}

/**
 * Save for a map made for the client is a publish: it asks first, because the world server stops and
 * players are disconnected. Other maps just save.
 */
export function saveOrPublish(engine: Engine, saveAs = false) {
  if (!saveAs && engine.activeVmangos()) {
    ui.dialog = 'publish'
    return
  }
  return saveMap(engine, saveAs)
}

/** Saves the map, then publishes it, if the save went through. */
export async function saveAndPublish(engine: Engine) {
  await saveMap(engine)
  if (!editor.dirty) await publishVmangosMap(engine)
}
