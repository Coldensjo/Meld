import {
  ApplySpawnEdits,
  BrowseVmangosFolder,
  SaveSQLDialog,
  SpawnEditSQL,
  LoadMap,
  LoadRegion,
  LoadSpawns,
  OpenBrushDialog,
  OpenTextDialog,
  ReadTextFile,
  SaveBrushDialog,
  SaveTextDialog,
  WriteTextFile,
  OpenHeightmapDialog,
  OpenImageDialog,
  GameClient,
  SetGameClient,
  BrowseBenillaFolder,
  SetBenillaPath,
  LaunchGame,
  OpenMapDialog,
  PublishVmangosMap,
  ReadHeightmap,
  SaveHeightmapDialog,
  SaveImageDialog,
  WritePNG,
  SaveMap,
  SaveMapDialog,
  SaveRegion,
  SetVmangosPath,
  VmangosPath,
  WriteHeightmap,
} from '../../../wailsjs/go/main/App'
import { mapfile } from '../../../wailsjs/go/models'
import type { Engine, MapSnapshot } from '../engine/Engine'
import type { MapDocument } from '../engine/MapDocument'
import { editor, prefs, setStatus, ui } from '../state/editor.svelte'
import { formatBrush, parseBrush, uniqueName, type DoodadBrush } from '../tools/doodadBrush'
import { grownBlock, type Side } from './regionGrow'
import type { ScopedEffects, TextureEffects } from '../world/groundEffects'
import type { TextureLooks } from '../world/textureLooks'
import { CELL_SIZE } from '../terrain/Terrain'
import { base64ToBytes, bytesToBase64 } from './base64'
import { tilePaint } from './tileImport'
import { CHUNK_CELLS } from '../terrain/chunkPaint'
import { CHUNK_IMPASSABLE } from '../terrain/chunkFlags'
import { TILE_CELLS, mapToTiles, type ExportObject } from './vmangosExport'
import { formatObjectList, parseObjectList } from '../world/objectList'
import { formatPortCoords } from './portCoords'
import { minimapScale, shadeHeights } from './minimapImage'
import { isHelper } from '../models/helpers'
import { defaultMapInfo, type MapInfo } from '../engine/MapDocument'
import { watermapCells } from './watermapImport'
import { IMAGE_MAX, IMAGE_MIN, imageRatios, importHeights, type HeightmapMode } from './heightmapImport'
import { areaName, loadAreas } from '../wow/areas'
import { vmangos } from '../../../wailsjs/go/models'
import { EventsOn } from '../../../wailsjs/runtime/runtime'

/** True when running inside the Wails webview (Go bindings available). */
export const hasBackend = () => typeof (window as unknown as { go?: unknown }).go !== 'undefined'

export function toMapData(s: MapSnapshot): mapfile.MapData {
  return mapfile.MapData.createFrom({
    name: s.name,
    size: s.size,
    cellSize: s.cellSize,
    splatRes: s.splatRes,
    waterLevel: s.waterLevel,
    waterEnabled: s.waterEnabled,
    objects: s.objects,
    region: s.region ?? undefined,
    // The info travels as JSON the Go side keeps opaque (mapfile.VmangosFolder.Info).
    vmangos: s.vmangos ? { dir: s.vmangos.dir, mapId: s.vmangos.mapId, info: s.vmangos.info as unknown as number[] | undefined } : undefined,
    palette: s.palette,
    texScale: s.texScale,
    roles: s.roles ?? undefined,
    textureEffects: Object.keys(s.textureEffects).length ? s.textureEffects : undefined,
    textureLooks: Object.keys(s.textureLooks).length ? s.textureLooks : undefined,
    zoneEffects: Object.keys(s.scopedEffects.zones).length ? s.scopedEffects.zones : undefined,
    tileEffects: Object.keys(s.scopedEffects.tiles).length ? s.scopedEffects.tiles : undefined,
    heights: bytesToBase64(s.heights),
    weights: bytesToBase64(s.weights),
    chunkSlots: bytesToBase64(s.chunkSlots),
    holes: bytesToBase64(s.holes),
    liquids: s.liquids ? bytesToBase64(s.liquids) : undefined,
    areaIds: s.chunkData ? bytesToBase64(u32Bytes(s.chunkData.areaIds)) : undefined,
    chunkFlags: s.chunkData ? bytesToBase64(s.chunkData.chunkFlags) : undefined,
    noEffect: s.chunkData ? bytesToBase64(s.chunkData.noEffect) : undefined,
  })
}

/** The bytes of a Uint32Array, little endian as the map file stores them (every target is little endian). */
function u32Bytes(a: Uint32Array) {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
}

/** A Uint32Array read from little-endian bytes. */
function bytesU32(b: Uint8Array) {
  return new Uint32Array(b.slice().buffer, 0, b.byteLength >> 2)
}

export function fromMapData(m: mapfile.MapData): MapSnapshot {
  const common = {
    name: m.name,
    size: m.size,
    cellSize: m.cellSize,
    splatRes: m.splatRes,
    waterLevel: m.waterLevel,
    waterEnabled: m.waterEnabled,
    objects: (m.objects ?? []).map((o, i) => ({ ...o, id: o.id || 100000 + i, parent: o.parent || undefined, uid: o.uid || undefined })),
    region: m.region ? { mapName: m.region.mapName, x: m.region.x, y: m.region.y, size: m.region.size } : null,
    vmangos: m.vmangos ? { dir: m.vmangos.dir, mapId: m.vmangos.mapId, info: m.vmangos.info ? ({ ...defaultMapInfo(), ...(m.vmangos.info as unknown as Partial<MapInfo>) } as MapInfo) : undefined } : null,
    texScale: m.texScale ?? 0,
    roles: m.roles ? { rock: m.roles.rock, dirt: m.roles.dirt } : null,
    textureEffects: { ...((m.textureEffects ?? {}) as TextureEffects) },
    textureLooks: { ...((m.textureLooks ?? {}) as TextureLooks) },
    scopedEffects: { zones: (m.zoneEffects ?? {}) as ScopedEffects['zones'], tiles: (m.tileEffects ?? {}) as ScopedEffects['tiles'] },
    heights: base64ToBytes(m.heights),
  }
  if (m.version === 1) {
    // Format 1: eight global layers, converted when the map opens.
    return {
      ...common,
      palette: [],
      weights: new Uint8Array(0),
      chunkSlots: new Uint8Array(0),
      holes: new Uint8Array(0),
      liquids: null,
      chunkData: null,
      legacy: { layerTextures: m.layerTextures ?? [], splatA: base64ToBytes(m.splatA ?? ''), splatB: base64ToBytes(m.splatB ?? '') },
    }
  }
  return {
    ...common,
    palette: m.palette ?? [],
    weights: base64ToBytes(m.weights ?? ''),
    chunkSlots: base64ToBytes(m.chunkSlots ?? ''),
    // A format 2 map has no holes, and a format 3 map no liquids.
    holes: base64ToBytes(m.holes ?? ''),
    liquids: (m.version ?? 0) >= 4 ? base64ToBytes(m.liquids ?? '') : null,
    // A format 4 map has no area IDs, chunk flags or no-effect cells.
    chunkData:
      (m.version ?? 0) >= 5
        ? { areaIds: bytesU32(base64ToBytes(m.areaIds ?? '')), chunkFlags: base64ToBytes(m.chunkFlags ?? ''), noEffect: base64ToBytes(m.noEffect ?? '') }
        : null,
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

/**
 * Re-reads the active map from its file in the same tab, dropping its unsaved changes and undo history.
 * The UI asks first when there are unsaved changes.
 */
export function revertMap(engine: Engine) {
  return guarded('Revert', async () => {
    const path = editor.filePath
    if (!path) return
    const id = engine.activeDocumentId()
    const t0 = performance.now()
    const data = await LoadMap(path)
    engine.openDocument(fromMapData(data), path, id)
    setStatus(`Reverted to ${path} (${Math.round(performance.now() - t0)} ms)`)
  })
}

/** Asks before reverting a map with unsaved changes, then reverts it. */
export function requestRevert(engine: Engine) {
  if (editor.dirty) ui.dialog = 'revert'
  else revertMap(engine)
}

/** Paint chunks a side in a 1.12 tile. */
const TILE_CHUNKS = 16

/**
 * Reads a region's creatures and game objects from the server's world database into its document.
 * A failure (no server folder, the database not running) only costs the spawns, not the region.
 */
async function loadSpawns(engine: Engine, d: MapDocument, mapName: string, x: number, y: number, size: number) {
  try {
    const spawns = await LoadSpawns(mapName, x, y, size)
    engine.setSpawns(d, spawns)
    setStatus(`Loaded ${spawns.length} creatures and game objects from the server.`, 8000)
  } catch (err) {
    console.warn('spawns not loaded', err)
    engine.setSpawnsError(d, String(err))
    setStatus(`Spawns not loaded: ${err}`, 10000)
  }
}

/** Reads the active region's spawns again, after the server or its database has been started. */
export function reloadSpawns(engine: Engine) {
  const b = editor.regionBlock
  if (!b || !editor.regionMap) return
  const d = engine.activeDocument()
  engine.setSpawnsError(d, '')
  setStatus('Loading creatures and game objects from the server…')
  void loadSpawns(engine, d, editor.regionMap, b.x, b.y, b.size)
}

/**
 * Writes the active region's spawn edits (moved, changed, added and deleted creatures and objects)
 * into the server's world database. The world server reads its spawns at start, so it has to be
 * restarted to show them.
 */
export function saveSpawns(engine: Engine) {
  return guarded('Save spawns', async () => {
    const b = editor.regionBlock
    const edits = engine.spawnEdits()
    if (!b || !editor.regionMap || edits.length === 0) return
    const res = await ApplySpawnEdits(editor.regionMap, b.x, b.y, b.size, edits)
    engine.markSpawnsSaved()
    const skipped = res.skipped?.length ? ` Not written: ${res.skipped.join('; ')}.` : ''
    setStatus(`Saved spawns to the world database: ${res.added} added, ${res.changed} changed, ${res.deleted} deleted. Restart the world server to see them.${skipped}`, 12000)
  })
}

/** Saves the active region's spawn edits as an SQL script for the world database, without running it. */
export function exportSpawnSql(engine: Engine) {
  return guarded('Export spawn SQL', async () => {
    const b = editor.regionBlock
    const edits = engine.spawnEdits()
    if (!b || !editor.regionMap || edits.length === 0) return
    const res = await SpawnEditSQL(editor.regionMap, b.x, b.y, b.size, edits)
    const path = await SaveSQLDialog(`${editor.regionMap}-spawns`)
    if (!path) return
    await WriteTextFile(path, res.sql)
    setStatus(`Exported ${res.added + res.changed + res.deleted} spawn edits to ${path}.`, 8000)
  })
}

/** Opens a square block of the client's tiles in a new tab (or switches to it if it's open). */
export function openWowRegion(engine: Engine, mapName: string, x: number, y: number, size: number) {
  return guarded('Open region', async () => {
    const view = await LoadRegion(mapName, x, y, size)
    const paint = tilePaint(
      view.chunks.map((c) => ({
        indexX: c.indexX,
        indexY: c.indexY,
        layers: (c.layers ?? []).map((l) => ({ texture: l.texture, alpha: l.alpha ? base64ToBytes(l.alpha) : undefined })),
      })),
      TILE_CHUNKS * size,
    )
    // The client's holes (cave mouths) and no-doodad cells: each chunk gives a byte per cell row, a
    // bit per cell.
    const cells = TILE_CHUNKS * size * CHUNK_CELLS
    const holes = new Uint8Array(cells * cells)
    const noEffect = new Uint8Array(cells * cells)
    const unpack = (c: { indexX: number; indexY: number }, rows: number[] | undefined, out: Uint8Array) => {
      if (!rows) return
      for (let row = 0; row < CHUNK_CELLS; row++) {
        const bits = rows[row] ?? 0
        if (!bits) continue
        for (let col = 0; col < CHUNK_CELLS; col++) {
          if (bits & (1 << col)) out[(c.indexY * CHUNK_CELLS + row) * cells + c.indexX * CHUNK_CELLS + col] = 1
        }
      }
    }
    const side = TILE_CHUNKS * size
    const areaIds = new Uint32Array(side * side)
    const chunkFlags = new Uint8Array(side * side)
    for (const c of view.chunks) {
      unpack(c, c.holes, holes)
      unpack(c, c.noEffect, noEffect)
      areaIds[c.indexY * side + c.indexX] = c.areaId
      if (c.impassable) chunkFlags[c.indexY * side + c.indexX] = CHUNK_IMPASSABLE
    }
    const t0 = performance.now()
    const d = engine.openRegion({
      mapName,
      x,
      y,
      size,
      heights: Float32Array.from(view.heights),
      weights: paint.weights,
      chunkSlots: paint.chunkSlots,
      holes,
      noEffect,
      areaIds,
      chunkFlags,
      palette: paint.palette,
      objects: view.objects,
      liquids: view.liquids,
    })
    if (!d) {
      setStatus(`${mapName} ${x}_${y} ${size}×${size} is already open.`)
      return
    }
    const notes = paint.dropped ? [`${paint.dropped} extra layers left out (a chunk takes four)`] : []
    setStatus(
      `Opened ${mapName} ${x}_${y}, ${size}×${size} tiles, with ${view.objects.length} models (${Math.round(performance.now() - t0)} ms)${notes.length ? '. ' + notes.join('; ') : ''}`,
      8000,
    )
    void loadSpawns(engine, d, mapName, x, y, size)
  })
}

/**
 * Opens the active region one tile bigger on `side` (the Map panel's plus), in the old tab's place,
 * with the camera where it was. The block stays square (see regionGrow.ts). Unsaved changes would
 * be lost in the reload, so the map must be saved first: saving writes the tiles to the client,
 * which the bigger block is then read from.
 */
export function extendRegion(engine: Engine, side: Side) {
  const block = editor.regionBlock
  const mapName = editor.regionMap
  if (!block || !mapName) return
  const grown = grownBlock(block, side)
  if (!grown) return
  if (editor.dirty) {
    setStatus('Save the map first (Ctrl+S writes its tiles to the client), then add the next tiles.', 8000)
    return
  }
  const oldId = engine.activeDocumentId()
  const c = engine.controller
  // Where the camera looks, in the bigger block's coordinates (its origin may have moved north or west).
  const shift = TILE_CELLS * CELL_SIZE
  const target = c.target.clone()
  target.x += (block.x - grown.x) * shift
  target.z += (block.y - grown.y) * shift
  const view = { yaw: c.yaw, pitch: c.pitch, distance: c.distance }
  return openWowRegion(engine, mapName, grown.x, grown.y, grown.size).then(() => {
    if (engine.activeDocumentId() === oldId) return
    engine.closeDocument(oldId)
    c.target.copy(target)
    c.yaw = view.yaw
    c.pitch = view.pitch
    c.distance = view.distance
  })
}

/**
 * The painted chunks of the active region, by block chunk index (rows of 16 * size chunks), in the
 * encoding the map export uses. Each tile's own chunks are mapped into the block.
 */
function regionPaint(engine: Engine, size: number) {
  const perRow = 16 * size
  const tiles = mapToTiles(engine.exportInput()).tiles
  const block = (t: { X: number; Y: number }, chunk: number) => (t.Y * 16 + Math.floor(chunk / 16)) * perRow + t.X * 16 + (chunk % 16)
  return {
    paint: tiles.flatMap((t) =>
      t.Paint.map((p) => ({ chunk: block(t, p.Chunk), textures: p.Textures, weights: p.Weights, effects: p.Effects, flags: p.Flags, noEffect: p.NoEffect ?? undefined })),
    ),
    // The chunk headers, by block chunk; none for a map saved before it kept them.
    headers: tiles.flatMap((t) => (t.Headers ?? []).map((h) => ({ ...h, chunk: block(t, h.chunk) }))),
  }
}

/**
 * Writes the active region back into the client's patch, into the tiles it was opened from, for the
 * server to build from. Only the tiles that differ from the patch's copies are written.
 */
export function exportRegion(engine: Engine) {
  return guarded('Export region', async () => {
    const region = engine.activeRegion()
    if (!region) {
      setStatus('This map is not a part of a continent. Open one with File › Open Part of Azeroth…')
      return
    }
    const water = engine.regionLiquids()
    const { paint, headers } = regionPaint(engine, region.size)
    const res = await SaveRegion(
      vmangos.RegionEdit.createFrom({
        mapName: region.mapName,
        x: region.x,
        y: region.y,
        size: region.size,
        heights: Array.from(engine.outerHeights()),
        objects: engine.regionObjects(),
        paint,
        headers,
        hasLiquids: true,
        liquids: water.liquids,
        partialLiquids: water.partial,
      }),
    )
    if (!res.patch) {
      setStatus(`Nothing changed in ${region.mapName} ${region.x}_${region.y} since the last export, so the patch and the game were left alone.`, 6000)
      return
    }
    const server = await VmangosPath()
    const next = server ? ` Run update-maps.bat in ${server} to rebuild the server's map data.` : ''
    const unchanged = res.tiles - res.changed
    setStatus(`Wrote ${res.changed} of ${res.tiles} tiles of ${region.mapName} ${region.x}_${region.y} to ${res.patch}${unchanged ? ` (${unchanged} unchanged)` : ''}.${next}`, 10000)
  })
}

/**
 * Saves the map's heights as a 16-bit grey PNG. The image has one sample per vertex, so
 * (cells + 1) on each side, and maps -1024..+1024 yards to black..white.
 */
export function exportHeightmap(engine: Engine) {
  return guarded('Export heightmap', async () => {
    const path = await SaveHeightmapDialog(editor.mapName)
    if (!path) return
    await WriteHeightmap(path, engine.terrain.size + 1, Array.from(engine.outerHeights()))
    setStatus(`Exported the heightmap to ${path}.`)
  })
}

/** Replaces the map's heights with a heightmap PNG of the same size, as one undoable step. */
export function importHeightmap(engine: Engine, opts: { mode: HeightmapMode; min: number; max: number } = { mode: 'set', min: IMAGE_MIN, max: IMAGE_MAX }) {
  return guarded('Import heightmap', async () => {
    const path = await OpenHeightmapDialog()
    if (!path) return
    const img = await ReadHeightmap(path)
    const side = engine.terrain.size + 1
    // The image's greys between Min and Max, put onto the ground by the mode; another size is stretched over the map.
    const ratios = imageRatios(img, side)
    engine.setHeights(importHeights(engine.outerHeights(), ratios, opts.mode, opts.min, opts.max), 'Import heightmap')
    const stretched = img.side !== side ? ` (stretched from ${img.side}×${img.side} to the map's ${side}×${side})` : ''
    setStatus(`Imported the heightmap from ${path}${stretched}. Undo reverts it.`, 6000)
  })
}

/**
 * Lays a watermap image's water over the map (see io/watermapImport.ts): black is no water, and a grey
 * is the water's depth above the ground, between `min` and `max` yards.
 */
export function importWatermap(engine: Engine, opts: { min: number; max: number }) {
  return guarded('Import watermap', async () => {
    const path = await OpenHeightmapDialog()
    if (!path) return
    const img = await ReadHeightmap(path)
    const size = engine.terrain.size
    const cells = watermapCells(imageRatios(img, size + 1), engine.outerHeights(), size, opts.min, opts.max)
    const n = engine.importWatermap(cells)
    setStatus(n ? `Laid water on ${n} cells from ${path}. Undo removes it.` : `The watermap ${path} is all black, so no water was laid.`, 6000)
  })
}

/** The paint texture's name for a file, or '' when it is a colour. */
function paintTextureName(): string {
  const path = editor.palette[editor.paintLayer] ?? ''
  return path.startsWith('#') ? '' : path.slice(path.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
}

/**
 * Saves the paint texture's alphamap: its weight at every splat texel as a 16-bit grey PNG, black for
 * none and white for all of it (terrain/alphamap.ts).
 */
export function exportAlphamap(engine: Engine) {
  return guarded('Export alphamap', async () => {
    const name = paintTextureName()
    if (!name) {
      setStatus('Pick a client texture to paint with first: its alphamap is what gets exported.', 5000)
      return
    }
    const path = await SaveImageDialog('Export Alphamap', `${editor.mapName}-${name}`)
    if (!path) return
    const values = engine.alphamapOf(editor.paintLayer)
    const side = engine.terrain.splatRes
    const heights = Array.from(values, (v) => IMAGE_MIN + v * (IMAGE_MAX - IMAGE_MIN))
    await WriteHeightmap(path, side, heights)
    setStatus(`Exported the alphamap of ${name} (${side}×${side}) to ${path}.`, 6000)
  })
}

/**
 * Reads a grey image into the paint texture's alphamap (stretched to the map), so the texture covers
 * each texel as much as the image is light. One undo step.
 */
export function importAlphamap(engine: Engine) {
  return guarded('Import alphamap', async () => {
    const name = paintTextureName()
    if (!name) {
      setStatus('Pick a client texture to paint with first: the alphamap is laid into it.', 5000)
      return
    }
    const path = await OpenImageDialog(`Import Alphamap into ${name}`)
    if (!path) return
    const img = await ReadHeightmap(path)
    const refused = engine.importAlphamap(editor.paintLayer, imageRatios(img, engine.terrain.splatRes))
    setStatus(`Laid the alphamap from ${path} into ${name}.${refused ? ` ${refused} chunks already hold four other textures and kept their paint.` : ''} Undo reverts it.`, 8000)
  })
}

/** Saves the active map's models as a text list (see objectList.ts). */
export function exportObjectList(engine: Engine) {
  return guarded('Export object list', async () => {
    const path = await SaveTextDialog(editor.mapName)
    if (!path) return
    // The helper shapes are the editor's own and stay out of the list, as they stay out of the client.
    const objects = [...engine.objects.objects.values()].filter((o) => !isHelper(o.type))
    const count = objects.length
    await WriteTextFile(path, formatObjectList(objects))
    setStatus(`Exported ${count} models to ${path}.`)
  })
}

/** Saves a doodad brush as a TOML file (see tools/doodadBrush.ts). */
export function exportDoodadBrush(brush: DoodadBrush) {
  return guarded('Export doodad brush', async () => {
    const path = await SaveBrushDialog(brush.name.replace(/[\/:*?"<>|]+/g, '-'))
    if (!path) return
    await WriteTextFile(path, formatBrush(brush))
    setStatus(`Exported the brush "${brush.name}" to ${path}.`)
  })
}

/**
 * Reads doodad brush files into the brush list. A brush named like one already there is added under a
 * new name, so a shared brush never overwrites the user's own. Returns the names added.
 */
export function importDoodadBrushes() {
  const added: string[] = []
  return guarded('Import doodad brush', async () => {
    const paths = (await OpenBrushDialog()) ?? []
    if (!paths.length) return
    const problems: string[] = []
    for (const path of paths) {
      const { brush, errors } = parseBrush(await ReadTextFile(path))
      if (!brush) {
        problems.push(`${path}: ${errors[0] ?? 'no brush'}`)
        continue
      }
      brush.name = uniqueName(brush.name, prefs.doodadBrushes.map((b) => b.name))
      prefs.doodadBrushes = [...prefs.doodadBrushes, brush]
      added.push(brush.name)
      if (errors.length) problems.push(`${path}: ${errors[0]}`)
    }
    if (added.length) prefs.doodadBrush = added[added.length - 1]
    const what = added.length === 1 ? `the brush "${added[0]}"` : `${added.length} brushes`
    const trouble = problems.length ? ` Skipped: ${problems.join('; ')}` : ''
    setStatus(added.length ? `Imported ${what}.${trouble}` : `No brush imported.${trouble}`, problems.length ? 10000 : 4000)
  }).then(() => added)
}

/**
 * Saves the map from above as a PNG: the ground shaded by height (or, for a part of Azeroth, the
 * client's overview of the block), with the tile borders, at a few pixels a cell for a small map.
 */
export function saveMinimapImage(engine: Engine) {
  return guarded('Save minimap image', async () => {
    const t = engine.terrain
    const size = t.size
    const scale = minimapScale(size)
    const side = size * scale
    const flat = document.createElement('canvas')
    flat.width = flat.height = size
    const fctx = flat.getContext('2d')!
    const img = fctx.createImageData(size, size)
    shadeHeights(t.heights, size, editor.waterEnabled ? editor.waterLevel : -Infinity, img.data)
    fctx.putImageData(img, 0, 0)
    const out = document.createElement('canvas')
    out.width = out.height = side
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(flat, 0, 0, side, side)
    const block = editor.regionBlock
    if (block && editor.regionMap) {
      // The continent's overview is 64 tiles a side; the block is cut from it.
      const ov = new Image()
      ov.src = `/wow/overview?map=${encodeURIComponent(editor.regionMap)}`
      try {
        await ov.decode()
        const per = ov.naturalWidth / 64
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(ov, block.x * per, block.y * per, block.size * per, block.size * per, 0, 0, side, side)
      } catch (err) {
        console.warn('overview not drawn', err)
      }
    }
    if (size > TILE_CELLS) {
      ctx.strokeStyle = 'rgba(255, 184, 51, 0.85)'
      ctx.lineWidth = Math.max(1, scale)
      ctx.beginPath()
      for (let i = TILE_CELLS; i < size; i += TILE_CELLS) {
        ctx.moveTo(i * scale, 0)
        ctx.lineTo(i * scale, side)
        ctx.moveTo(0, i * scale)
        ctx.lineTo(side, i * scale)
      }
      ctx.stroke()
    }
    const path = await SaveImageDialog('Save Minimap Image', `${editor.mapName}-minimap`)
    if (!path) return
    await WritePNG(path, out.toDataURL('image/png').slice('data:image/png;base64,'.length))
    setStatus(`Saved the minimap (${side}×${side}) to ${path}.`)
  })
}

/** Saves the camera's place as the port commands for the map's server (see portCoords.ts). */
export function exportPortCoords(engine: Engine) {
  return guarded('Export port coordinates', async () => {
    const ref = engine.activeVmangos()
    if (!ref) {
      setStatus('Port commands need the map’s ID. Make the map with File › New World…', 8000)
      return
    }
    const path = await SaveTextDialog(editor.mapName)
    if (!path) return
    const at = engine.camera.position
    const area = engine.areaAt(at.x, at.z)
    if (area) await loadAreas()
    await WriteTextFile(path, formatPortCoords(at, ref.mapId, area ? areaName(area) : ''))
    setStatus(`Wrote the port commands for map ${ref.mapId} to ${path}.`)
  })
}

/** Places the models of a text list into the active map, as one undoable step. */
export function importObjectList(engine: Engine) {
  return guarded('Import object list', async () => {
    const path = await OpenTextDialog()
    if (!path) return
    const { objects, errors } = parseObjectList(await ReadTextFile(path))
    if (objects.length === 0) {
      setStatus(`${path} has no models${errors.length ? `; ${errors[0]}` : ''}.`, 8000)
      return
    }
    engine.addObjects(objects)
    const skipped = errors.length ? `, skipped ${errors.length} unreadable ${errors.length === 1 ? 'line' : 'lines'}` : ''
    setStatus(`Imported ${objects.length} models${skipped}. Undo removes them.`, 8000)
  })
}

/** Asks for the VMaNGOS server folder that the map data is built in. */
/** Reads which game client Meld uses into ui.gameClient (Preferences › Game Client). */
export async function refreshGameClient() {
  if (!hasBackend()) return
  try {
    ui.gameClient = (await GameClient()).client === 'benilla' ? 'benilla' : 'wow'
  } catch {
    /* no backend */
  }
}

/** Picks the game Meld closes and opens around an export: the WoW client or Benilla. */
export async function setGameClient(client: 'wow' | 'benilla') {
  if (!hasBackend()) return
  try {
    await SetGameClient(client)
    await refreshGameClient()
    setStatus(client === 'benilla' ? 'Meld now closes and opens Benilla around an export, logged in with the saved Game Login.' : 'Meld now closes and opens World of Warcraft (Wow.exe) around an export.', 6000)
  } catch (e) {
    setStatus(`${e}`, 8000)
  }
}

/** Picks the Benilla folder (its repository, with the release build in target/release). */
export async function chooseBenillaFolder() {
  if (!hasBackend()) return
  try {
    const dir = await BrowseBenillaFolder()
    if (!dir) return
    await SetBenillaPath(dir)
    const info = await GameClient()
    setStatus(info.benillaBuilt ? `Benilla folder: ${dir}. Pick Preferences › Benilla to use it.` : `Benilla folder: ${dir}, but it isn't built: run cargo build --release -p benilla there.`, 8000)
  } catch (e) {
    setStatus(`${e}`, 8000)
  }
}

/** Opens the chosen game client now, logged in with the saved Game Login. */
export async function launchGame() {
  if (!hasBackend()) return
  try {
    await LaunchGame()
    setStatus(ui.gameClient === 'benilla' ? 'Starting Benilla…' : 'Starting World of Warcraft…', 4000)
  } catch (e) {
    setStatus(`The game didn't start: ${e}`, 8000)
  }
}

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
      setStatus('Only a map made for the client publishes this way. Make one with File › New World…')
      return
    }
    listenToPublish()
    const input = engine.exportInput()
    const out = mapToTiles(input)
    const notes: string[] = []
    if (out.colorChunks) notes.push(`${out.colorChunks} chunks painted with a colour were left out`)
    if (out.outside) notes.push(`${out.outside} models outside the map were left out`)
    // A WMO-only map is its first building: the WDT places it, and the map has no tiles.
    let global: ExportObject | undefined
    if (ref.info?.wmoOnly) {
      global = input.objects.find((o) => o.type.startsWith('wmo:'))
      if (!global) {
        setStatus('A WMO-only map needs a building (a WMO) on it: place one first, or untick WMO-only in Map Properties.', 6000)
        return
      }
      out.tiles = []
    }
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
          Info: ref.info,
          Global: global ? { Type: global.type, X: global.x, Y: global.y, Z: global.z, RotY: global.rotY, TiltX: global.tiltX ?? 0, TiltZ: global.tiltZ ?? 0, Scale: global.scale } : undefined,
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
