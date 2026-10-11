import {
  BrowseVmangosFolder,
  ExportTileHeights,
  ExportVmangosMap,
  LoadMap,
  LoadTile,
  OpenMapDialog,
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

/**
 * Writes a map made for the client: its tiles with their ground, paint and models, the map's WDT and
 * its row in the client's map table. The server's copy of the table follows when its folder is set.
 */
export function exportVmangosMap(engine: Engine) {
  return guarded('Export map', async () => {
    const ref = engine.activeVmangos()
    if (!ref) {
      setStatus('Only a map made for the client exports this way. Make one with File › New Map…, ticking “For the WoW 1.12 client”.')
      return
    }
    const input = engine.exportInput()
    const out = mapToTiles(input)
    const res = await ExportVmangosMap(
      vmangos.MapSpec.createFrom({
        Dir: ref.dir,
        MapID: ref.mapId,
        Tiles: out.tiles,
        Water: input.waterEnabled,
        WaterLevel: input.waterLevel,
      }),
    )
    const notes: string[] = []
    if (out.colorChunks) notes.push(`${out.colorChunks} chunks painted with a colour were left out; paint them with a texture`)
    if (out.outside) notes.push(`${out.outside} models outside the map were left out`)
    const server = res.Server
      ? " The server's map table is updated. Run update-maps.bat in your VMaNGOS folder, then start the server."
      : ' Set the VMaNGOS folder to update the server, then run update-maps.bat.'
    const extra = notes.length ? ' ' + notes.join('. ') + '.' : ''
    setStatus(`Wrote ${res.Tiles} tiles of ${ref.dir} (map ${ref.mapId}) to the client's patch.${server}${extra}`, 14000)
  })
}
