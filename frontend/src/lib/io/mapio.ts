import {
  ApplySpawnEdits,
  BrowseVmangosFolder,
  SaveSQLDialog,
  SpawnEditSQL,
  LoadMap,
  LoadBuildingMap,
  LoadRegion,
  LoadSpawns,
  MapEntries,
  OpenBrushDialog,
  OpenModelSetDialog,
  OpenTextDialog,
  ReadTextFile,
  SaveBrushDialog,
  SaveModelSetDialog,
  SaveTextDialog,
  WriteTextFile,
  OpenHeightmapDialog,
  OpenImageDialog,
  GameClient,
  SetGameClient,
  GameWindow,
  SetGameWindow,
  BrowseBenillaFolder,
  SetBenillaPath,
  LaunchGame,
  LaunchGameAt,
  PlayHere,
  OpenMapDialog,
  PublishVmangosMap,
  ReadHeightmap,
  SaveHeightmapDialog,
  SaveImageDialog,
  WritePNG,
  SaveMap,
  SaveMapDialog,
  RegionPending,
  SaveRegion,
  UpdateRegionServer,
  SetVmangosPath,
  VmangosPath,
  WriteHeightmap,
  WriteNormalMap,
  WriteMinimapTiles,
} from '../../../wailsjs/go/main/App'
import { fromMapData, toMapData } from './mapData'
import type { Engine } from '../engine/Engine'
import type { MapDocument } from '../engine/MapDocument'
import { editor, prefs, setStatus, ui } from '../state/editor.svelte'
import { savingDetail, startSaving, withSaving } from '../state/saving'
import { formatBrush, parseBrush, uniqueName, type DoodadBrush } from '../tools/doodadBrush'
import { formatSet, parseSet, type ModelSet } from '../wow/modelSets'
import { grownBlock, type Side } from './regionGrow'
import { cachedPending } from './regionKey'
import { CELL_SIZE } from '../terrain/Terrain'
import { base64ToFloats, floatsToBase64 } from './base64'
import { ALPHA_BYTES, tilePaint } from './tileImport'
import { CHUNK_CELLS } from '../terrain/chunkPaint'
import { CHUNK_IMPASSABLE } from '../terrain/chunkFlags'
import { TILE_CELLS, mapToTiles, type ExportObject } from './vmangosExport'
import { formatObjectList, parseObjectList } from '../world/objectList'
import { formatPortCoords } from './portCoords'
import { tileKey } from './mapTiles'
import { blockAround, blockHolds, spotTile } from '../world/teleport'
import type { TriggerDestination } from '../world/areaTriggers'
import { minimapScale, shadeHeights } from './minimapImage'
import { isHelper } from '../models/helpers'
import { watermapCells } from './watermapImport'
import { IMAGE_MAX, IMAGE_MIN, imageRatios, importHeights, importHeightsOnTile, type HeightmapMode } from './heightmapImport'
import { normalMapPixels, toBase64 } from './normalMap'
import { areaName, loadAreas } from '../wow/areas'
import { vmangos } from '../../../wailsjs/go/models'
import { EventsOn } from '../../../wailsjs/runtime/runtime'

/** True when running inside the Wails webview (Go bindings available). */
export const hasBackend = () => typeof (window as unknown as { go?: unknown }).go !== 'undefined'

export { fromMapData, toMapData }

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
    await withSaving('Saving map', () => SaveMap(path, toMapData(engine.snapshot())))
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
		const saved = await withSaving('Saving spawns to the world database', () => writeSpawns(engine))
		if (saved) setStatus(`${saved} Restart the world server to see them.`, 12000)
	})
}

/**
 * Writes the active region's spawn edits into the world database, unguarded, for Save Spawns and the
 * compile (#342). Returns the status sentence, or '' when there was nothing to write; throws when the
 * write failed.
 */
async function writeSpawns(engine: Engine): Promise<string> {
	const b = editor.regionBlock
	const edits = engine.spawnEdits()
	if (!b || !editor.regionMap || edits.length === 0) return ''
	const res = await ApplySpawnEdits(editor.regionMap, b.x, b.y, b.size, edits)
	engine.markSpawnsSaved()
	const skipped = res.skipped?.length ? ` Not written: ${res.skipped.join('; ')}.` : ''
	return `Saved spawns to the world database: ${res.added} added, ${res.changed} changed, ${res.deleted} deleted.${skipped}`
}

/** What the compile's spawn write did: its status note, whether it wrote any, and whether it failed. */
type CompileSpawns = { note: string; saved: boolean; failed: boolean }

const noSpawns: CompileSpawns = { note: '', saved: false, failed: false }

/**
 * Compile to Server and Compile All save the region's spawn edits with the ground (#342). A failure is
 * reported, not thrown, so the client's tiles still compile; the caller then leaves the server alone
 * rather than restarting it with half the edits.
 */
async function compileSpawns(engine: Engine): Promise<CompileSpawns> {
	try {
		const saved = await writeSpawns(engine)
		return saved ? { note: ` ${saved}`, saved: true, failed: false } : noSpawns
	} catch (err) {
		console.error(err)
		return { note: ` The spawn edits were not saved to the world database (${err}), so the server was left alone.`, saved: false, failed: true }
	}
}

/** The restart hint after spawns were saved with no server rebuild (which restarts the world server). */
const restartNote = (s: CompileSpawns) => (s.saved ? ' Restart the world server to see the spawns.' : '')

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
  return guarded('Open region', async () => openRegionView(engine, await LoadRegion(mapName, x, y, size)))
}

/**
 * Opens a WMO-only map (a dungeon that is one building and no terrain tiles) in a new tab: the tiles
 * its building covers, with the building as the one model and the ground hidden (#271).
 */
export function openWowBuilding(engine: Engine, mapName: string) {
  return guarded('Open building', async () => openRegionView(engine, await LoadBuildingMap(mapName)))
}

/** The side of the block Teleport to destination opens around a spot, in tiles. */
const TELEPORT_BLOCK = 3

/**
 * Teleport to destination (#306): shows server spot `dest` (an area trigger's or a portal's target,
 * `what` naming it in the status) in the editor. A tab whose map and block hold it is switched to;
 * otherwise the destination map opens in a new tab, as a block of up to TELEPORT_BLOCK tiles a side
 * around it, or whole for a map that is one building. Then the camera goes to the spot.
 */
export function teleportTo(engine: Engine, dest: TriggerDestination, what: string) {
  return guarded('Teleport', async () => {
    const map = (await MapEntries()).find((m) => m.ID === dest.map)
    if (!map) {
      setStatus(`${what} leads to map ${dest.map}, which the client's Map.dbc does not have.`, 8000)
      return
    }
    const tile = spotTile(dest)
    const dir = map.Dir.toLowerCase()
    const holds = (d: MapDocument) => {
      const r = d.meta.region
      if (r) return r.mapName.toLowerCase() === dir && (!!r.wmoOnly || blockHolds(r, tile))
      return d.meta.vmangos?.mapId === dest.map
    }
    const open = engine.documents.find(holds)
    if (open) engine.switchDocument(open.id)
    else {
      const res = await fetch(`/wow/tiles?map=${encodeURIComponent(map.Dir)}`)
      const tiles = res.ok ? ((await res.json()) as Array<{ X: number; Y: number }> | null) ?? [] : []
      if (!tiles.length) await openRegionView(engine, await LoadBuildingMap(map.Dir))
      else {
        const block = blockAround(tile, new Set(tiles.map((t) => tileKey(t.X, t.Y))), TELEPORT_BLOCK)
        if (!block) {
          setStatus(`${what} leads to ${map.Name} tile ${tile.x}_${tile.y}, which has no terrain in the client.`, 8000)
          return
        }
        await openRegionView(engine, await LoadRegion(map.Dir, block.x, block.y, block.size))
      }
      if (!engine.documents.some((d) => d.id === engine.activeDocumentId() && holds(d))) return
    }
    engine.viewSpot(dest)
    setStatus(`${what}: arrived in ${map.Name} at (${dest.x.toFixed(1)}, ${dest.y.toFixed(1)}, ${dest.z.toFixed(1)}).`, 6000)
  })
}

/**
 * A region view's alpha maps (vmangos.RegionView.Alpha): every layer but each chunk's first,
 * ALPHA_BYTES each, in the order of its chunks. They come as one GET from the asset server rather
 * than in LoadRegion's reply, whose JSON they made 33 of a 3x3 block's 36.5 MB (#636).
 */
async function regionAlpha(view: vmangos.RegionView): Promise<Uint8Array> {
	if (!view.alphaUrl) return new Uint8Array(0)
	const res = await fetch(view.alphaUrl)
	if (!res.ok) throw new Error(`the block's alpha maps: ${res.status} ${await res.text()}`)
	return new Uint8Array(await res.arrayBuffer())
}

/** Opens a block read from the client (LoadRegion, LoadBuildingMap) in a new tab, then its spawns. */
async function openRegionView(engine: Engine, view: vmangos.RegionView) {
  const { mapName, x, y, size } = view
  const alpha = await regionAlpha(view)
  let at = 0
  const nextAlpha = () => alpha.subarray(at, (at += ALPHA_BYTES))
  const paint = tilePaint(
    view.chunks.map((c) => ({
      indexX: c.indexX,
      indexY: c.indexY,
      layers: (c.layers ?? []).map((l, k) => ({ texture: l.texture, alpha: k > 0 ? nextAlpha() : undefined })),
    })),
    TILE_CHUNKS * size,
  )
  if (at !== alpha.length) throw new Error(`the block's alpha maps are ${alpha.length} bytes, its layers take ${at}`)
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
    heights: base64ToFloats(view.heights),
    weights: paint.weights,
    chunkSlots: paint.chunkSlots,
    holes,
    noEffect,
    areaIds,
    chunkFlags,
    palette: paint.palette,
    objects: view.objects,
    liquids: view.liquids,
    wmoOnly: view.wmoOnly,
    bounds: view.bounds,
  })
  if (!d) {
    setStatus(`${mapName} ${x}_${y} ${size}×${size} is already open.`)
    return
  }
  const notes = paint.dropped ? [`${paint.dropped} extra layers left out (a chunk takes four)`] : []
  setStatus(
    view.wmoOnly
      ? `Opened ${mapName}, a single building with no ground (${Math.round(performance.now() - t0)} ms). Its spawns can be edited; the building can take another doodad set, but not move.`
      : `Opened ${mapName} ${x}_${y}, ${size}×${size} tiles, with ${view.objects.length} models (${Math.round(performance.now() - t0)} ms)${notes.length ? '. ' + notes.join('; ') : ''}`,
    8000,
  )
  void loadSpawns(engine, d, mapName, x, y, size)
}

/**
 * Opens the active region one tile bigger on `side` (the Map panel's plus), in the old tab's place,
 * with the camera where it was. The block stays square (see regionGrow.ts). The bigger block is read
 * from the client's tiles and the old tab closes, so the region's edits must be in the client first
 * (Compile to Client; Save only writes the .wmap) and its spawn edits in the world database (#318).
 */
export async function extendRegion(engine: Engine, side: Side) {
  const block = editor.regionBlock
  const mapName = editor.regionMap
  if (!block || !mapName) return
  const grown = grownBlock(block, side)
  if (!grown) return
  const uncompiled = await regionUncompiled(engine)
  const spawns = ui.spawnChanges
  if (uncompiled || spawns) {
    const need = [
      uncompiled ? 'its ground, paint, model or water edits to the client (File › Compile to Client)' : '',
      spawns ? `its ${spawns} spawn ${spawns === 1 ? 'edit' : 'edits'} to the world database (File › Save Spawns to Database)` : '',
    ].filter(Boolean)
    setStatus(`The bigger block is read from the client and the server, so write ${need.join(' and ')} first, then add the next tiles.`, 10000)
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

/** What Compile writes the region to: the client's patch, the server's map data, or both (#214). */
export type CompileTarget = 'client' | 'server' | 'all'

/** A region as the compile names and builds it. */
type RegionBlock = { mapName: string; x: number; y: number; size: number }

/** The active region's edit as the region save takes it. */
function regionEdit(engine: Engine, region: RegionBlock) {
  const water = engine.regionLiquids()
  const { paint, headers } = regionPaint(engine, region.size)
  const heights = engine.outerHeights()
  return vmangos.RegionEdit.createFrom({
    mapName: region.mapName,
    x: region.x,
    y: region.y,
    size: region.size,
    // As the map file keeps them: base64 of the float32s, a fraction of the JSON numbers' text (#531).
    heights: floatsToBase64(heights),
    objects: engine.regionObjects(),
    paint,
    headers,
    hasLiquids: true,
    liquids: water.liquids,
    partialLiquids: water.partial,
  })
}

/** The region's name in the status lines: "Azeroth 32_59". */
const regionName = (r: RegionBlock) => `${r.mapName} ${r.x}_${r.y}`

/**
 * Whether the active region has edits the client's patch lacks (ground, paint, models, water; not
 * spawns): its fingerprint against the one taken when it was opened or last compiled, or, for a
 * region opened from a file, which has none, the Go side's build against the patch. That answer is
 * kept on the document (`MapDocument.pending`) and reused until the history moves to a state with
 * another fingerprint, since the build serialises and rebuilds the whole block (#531).
 */
export async function regionUncompiled(engine: Engine): Promise<boolean> {
  const region = engine.activeRegion()
  if (!region) return false
  const d = engine.activeDocument()
  if (d.compiled.key !== null) return d.history.changes !== d.compiled.changes && engine.regionKey() !== d.compiled.key
  let key: string | undefined
  const keyNow = () => (key ??= engine.regionKey())
  const changes = d.history.changes
  const cached = cachedPending(d.pending, changes, keyNow)
  if (cached !== null) return cached > 0
  // Taken before the call, so an edit made while it runs is not credited with its answer.
  const k = keyNow()
  const { files } = await RegionPending(regionEdit(engine, region))
  d.pending = { key: k, changes, files }
  return files > 0
}

/** The client's continents, whose server map data Compile to Server rebuilds: their map IDs. */
function continentId(mapName: string) {
  const name = mapName.toLowerCase()
  return name === 'azeroth' ? 0 : name === 'kalimdor' ? 1 : -1
}

/** A note on the spawn edits not yet in the world database, for a compile that can't save them. */
function spawnNote() {
  const n = ui.spawnChanges
  return n ? ` ${n} spawn ${n === 1 ? 'edit is' : 'edits are'} not in the world database yet: File › Save Spawns to Database.` : ''
}

/**
 * File › Compile to Client, Compile to Server and Compile All for the active region (#214):
 * - client writes it back into the client's patch, into the tiles it was opened from; only the tiles
 *   that differ from the patch's copies are written.
 * - server rebuilds the server's map data of the region's tiles from the client's patch, once it is
 *   sure the patch holds the region's edits, since the server is built from it.
 * - all does both, the server only for the tiles the client compile wrote.
 * Server and all also save the region's spawn edits into the world database (#342), before the
 * rebuild, whose restart of the world server then reads them.
 */
export function compileRegion(engine: Engine, target: CompileTarget) {
  const label = target === 'client' ? 'Compiling to the client' : target === 'server' ? 'Compiling to the server' : 'Compiling to the client and server'
  return guarded('Compile region', () => withSaving(label, async () => {
    const region = engine.activeRegion()
    if (!region) {
      setStatus('This map is not a part of a continent. Open one with File › Open Part of Azeroth…')
      return
    }
    const name = regionName(region)
    if (target === 'server') {
      await compileServer(engine, region, name)
      return
    }
    // Preferences › Check the Map before Compile (#195): errors stop the compile and open the list.
    if (prefs.checkBeforeCompile) {
      const errors = (await engine.checkMap()).findings.filter((f) => f.severity === 'error').length
      if (errors) {
        ui.checkMap = true
        setStatus(`Compile stopped: the map check found ${errors} ${errors === 1 ? 'error' : 'errors'}. Fix them, or turn off Preferences › Check the Map before Compile.`, 10000)
        return
      }
    }
    const d = engine.activeDocument()
    const compiled = { key: engine.regionKey(), changes: d.history.changes }
    const res = await SaveRegion(regionEdit(engine, region))
    // The patch now holds what the map held when the compile started.
    d.compiled = compiled
    const server = await VmangosPath()
    // The spawns need the server folder (it holds the database's settings); without one they wait.
    const spawns = target === 'all' && server ? await compileSpawns(engine) : noSpawns
    if (!res.patch) {
      // Compile works on the open tab: another region with edits says where they are.
      const others = engine.otherEditedRegions()
      const elsewhere = others.length ? ` ${others.join(', ')} ${others.length === 1 ? 'was' : 'were'} edited since the last compile: Compile works on the open tab, so switch to it.` : ''
      const rebuild = target === 'all' && server && res.mapId >= 0 ? " Compile to Server rebuilds the server's map data of the region anyway." : ''
      setStatus(`Nothing changed in ${name} since the last compile, so the patch and the game were left alone.${elsewhere}${spawns.note}${restartNote(spawns)}${rebuild}`, 10000)
      return
    }
    const unchanged = res.tiles - res.changed
    const wrote = res.building
      ? `Wrote ${region.mapName}'s building (its WDT) to ${res.patch}.`
      : `Wrote ${res.changed} of ${res.tiles} tiles of ${name} to the client (${res.patch})${unchanged ? `, ${unchanged} unchanged` : ''}.`
    // Only a continent of the client has map data to rebuild this way, and only when a tile changed.
    const rebuildable = !!server && res.mapId >= 0 && !!res.changedTiles?.length
    if (target === 'client') {
      setStatus(rebuildable ? `${wrote} The server's map data still has the old ground: Compile to Server rebuilds it.` : wrote, 10000)
      return
    }
    if (!server) {
      setStatus(`${wrote} No VMaNGOS server folder is set (Game menu), so the server was left alone.${spawnNote()}`, 10000)
      return
    }
    if (!rebuildable || spawns.failed) {
      const hint = res.mapId < 0 && !spawns.failed ? ` Run update-maps.bat (in the scripts folder beside ${server}) to rebuild the server's map data.` : ''
      setStatus(`${wrote}${spawns.note}${restartNote(spawns)}${hint}`, 12000)
      return
    }
    // The tiles alone only when the server's data matched the patch before; else the whole map.
    await rebuildServerMaps(res.mapId, res.tilesCurrent ? res.changedTiles : [], `${wrote}${spawns.note}`)
  }))
}

/** Compile to Server: the region's tiles rebuilt from the client's patch, which must hold its edits. */
async function compileServer(engine: Engine, region: RegionBlock, name: string) {
	if (!(await VmangosPath())) {
		setStatus('Set the VMaNGOS server folder first (Game menu), then Compile to Server.', 8000)
		return
	}
	if (await regionUncompiled(engine)) {
		setStatus(`${name} has edits the client doesn't have yet, and the server's map data is built from the client's tiles: Compile All writes both.`, 10000)
		return
	}
	// The spawns go first, so the world server the rebuild restarts reads them (#342).
	const spawns = await compileSpawns(engine)
	const mapId = continentId(region.mapName)
	if (mapId < 0 || spawns.failed) {
		const only = mapId < 0 && !spawns.failed ? ` Only Azeroth's and Kalimdor's map data is rebuilt this way. ${region.mapName}'s comes from update-maps.bat in the scripts folder beside the server.` : ''
		setStatus(`${spawns.note}${restartNote(spawns)}${only}`.trimStart(), 12000)
		return
	}
	const tiles: string[] = []
	for (let j = 0; j < region.size; j++) for (let i = 0; i < region.size; i++) tiles.push(`${region.x + i}_${region.y + j}`)
	await rebuildServerMaps(mapId, tiles, `${spawns.note} Rebuilding the server's map data of ${name} from the client's tiles.`.trimStart())
}

/** Starts the rebuild of the server's map data of `tiles` ("x_y"; none for the whole map) in the background. */
async function rebuildServerMaps(mapId: number, tiles: string[], lead: string) {
  if (serverMapsRunning) {
    setStatus(`${lead} The server's map data is still being rebuilt from the last compile: Compile to Server again when it is done.`, 10000)
    return
  }
  listenToServerMaps()
  serverMapsRunning = true
  try {
    await UpdateRegionServer(mapId, tiles)
    setStatus(`${lead} Rebuilding the server's map data…`, 0)
  } catch (e) {
    serverMapsRunning = false
    setStatus(`${lead} The server's map data was not rebuilt: ${e}`, 10000)
  }
}

let listeningServerMaps = false
let serverMapsRunning = false

/** Routes progress from the background server map update to the status bar, once. */
function listenToServerMaps() {
  if (listeningServerMaps) return
  listeningServerMaps = true
  EventsOn('servermaps:log', (line: string) => setStatus(line, 0))
  EventsOn('servermaps:done', (msg: string) => {
    serverMapsRunning = false
    setStatus(msg ? `Server map update failed: ${msg}` : "The server's map data is rebuilt and the world server is running again.", msg ? 0 : 10000)
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

/** Saves the map's ground normals as an RGB PNG, one pixel a vertex (Noggit Red's Export normalmap, #44). */
export function exportNormalMap(engine: Engine) {
  return guarded('Export normal map', async () => {
    const path = await SaveImageDialog('Export Normal Map', `${editor.mapName}-normals`)
    if (!path) return
    const t = engine.terrain
    const side = t.size + 1
    await WriteNormalMap(path, side, toBase64(normalMapPixels(engine.outerHeights(), side, t.cellSize)))
    setStatus(`Exported the normal map (${side}×${side}) to ${path}.`, 6000)
  })
}

/**
 * Puts a heightmap PNG onto the map's heights by `opts.mode`, as one undoable step: over the whole
 * map, or with `opts.scope` 'tile' over the client tile under the camera (Noggit Red's per-tile
 * import), where `opts.tiledEdges` leaves the vertices it shares with the next tiles alone (#44).
 */
export function importHeightmap(
  engine: Engine,
  opts: { mode: HeightmapMode; min: number; max: number; scope?: 'map' | 'tile'; tiledEdges?: boolean } = { mode: 'set', min: IMAGE_MIN, max: IMAGE_MAX },
) {
  return guarded('Import heightmap', async () => {
    if (opts.scope === 'tile' && !engine.tileUnderCamera()) {
      setStatus('The camera is not over the map, so there is no tile to import onto.', 4000)
      return
    }
    const path = await OpenHeightmapDialog()
    if (!path) return
    const img = await ReadHeightmap(path)
    const tile = opts.scope === 'tile' ? engine.tileUnderCamera() : null
    if (tile) {
      const n = tile.cells + (opts.tiledEdges ? 0 : 1)
      const next = importHeightsOnTile(engine.outerHeights(), engine.terrain.size + 1, imageRatios(img, n), tile.x0, tile.z0, opts.mode, opts.min, opts.max)
      engine.setHeights(next, `Import heightmap on ${tile.name}`)
      setStatus(`Imported the heightmap from ${path} onto ${tile.name}${img.side !== n ? ` (stretched from ${img.side}×${img.side} to ${n}×${n})` : ''}. Undo reverts it.`, 6000)
      return
    }
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

/** Saves a model set as a TOML file (see wow/modelSets.ts). */
export function exportModelSet(set: ModelSet) {
  return guarded('Export model set', async () => {
    const path = await SaveModelSetDialog(set.name.replace(/[\/:*?"<>|]+/g, '-'))
    if (!path) return
    await WriteTextFile(path, formatSet(set))
    setStatus(`Exported the set "${set.name}" to ${path}.`)
  })
}

/**
 * Reads model set files into the set list. A set named like one already there is added under a new
 * name, so a shared set never overwrites the user's own. Returns the names added.
 */
export function importModelSets() {
  const added: string[] = []
  return guarded('Import model set', async () => {
    const paths = (await OpenModelSetDialog()) ?? []
    if (!paths.length) return
    const problems: string[] = []
    for (const path of paths) {
      const { set, errors } = parseSet(await ReadTextFile(path))
      if (!set) {
        problems.push(`${path}: ${errors[0] ?? 'no set'}`)
        continue
      }
      set.name = uniqueName(set.name, prefs.modelSets.map((s) => s.name))
      prefs.modelSets = [...prefs.modelSets, set]
      added.push(set.name)
      if (errors.length) problems.push(`${path}: ${errors[0]}`)
    }
    if (added.length) prefs.modelSet = added[added.length - 1]
    const what = added.length === 1 ? `the set "${added[0]}"` : `${added.length} sets`
    const trouble = problems.length ? ` Skipped: ${problems.join('; ')}` : ''
    setStatus(added.length ? `Imported ${what}.${trouble}` : `No set imported.${trouble}`, problems.length ? 10000 : 4000)
  }).then(() => added)
}

/**
 * Saves the map from above as a PNG: the ground shaded by height (or, for a part of Azeroth, the
 * client's overview of the block), with the tile borders, at a few pixels a cell for a small map.
 */
/**
 * Import/Export › Write Minimap Tiles to the Client (B-129): draws each tile of the map from above and
 * puts it into the client's minimap, so the game's minimap and world map show the edited ground. A
 * region's tiles keep their place in its map; a map made for the client's are under its folder. The
 * buildings are drawn, not the trees (as the client's own tiles are), unless
 * `prefs.minimapAllModels`. The game is closed around the write, as for any patch write.
 */
export function writeMinimapTiles(engine: Engine) {
  return guarded('Write minimap', async () => {
    const region = engine.activeRegion()
    const ref = engine.activeVmangos()
    const target = region ? { dir: region.mapName, x: region.x, y: region.y } : ref ? { dir: ref.dir, x: 0, y: 0 } : null
    if (!target) {
      setStatus('Only a part of Azeroth or a map made for the client has a minimap in the game.')
      return
    }
    ui.busy = true
    try {
      // Placeholders would be drawn as boxes: wait for the meshes (a minute at most).
      for (let i = 0; i < 240 && engine.modelsLoading(); i++) {
        setStatus(`Waiting for ${engine.modelsLoading()} models to load…`, 1000)
        await new Promise((done) => setTimeout(done, 250))
      }
      const n = engine.terrain.size / TILE_CELLS
      const models = prefs.minimapAllModels ? 'all' : 'buildings'
      const tiles = []
      for (let tz = 0; tz < n; tz++) {
        for (let tx = 0; tx < n; tx++) {
          setStatus(`Drawing minimap tile ${tz * n + tx + 1} of ${n * n}…`, 0)
          await new Promise((done) => setTimeout(done, 0))
          tiles.push({ x: target.x + tx, y: target.y + tz, pixels: toBase64(engine.renderMinimapTile(tx, tz, models)) as unknown as number[] })
        }
      }
      setStatus('Writing the minimap into the client…', 0)
      const patch = await WriteMinimapTiles(target.dir, tiles)
      setStatus(`Wrote ${tiles.length} minimap ${tiles.length === 1 ? 'tile' : 'tiles'} of ${target.dir} into ${patch}.`, 8000)
    } finally {
      ui.busy = false
    }
  })
}

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
/** Reads which game client Meld uses into ui.gameClient (Game › Game Client). */
export async function refreshGameClient() {
  if (!hasBackend()) return
  try {
    ui.gameClient = (await GameClient()).client === 'benilla' ? 'benilla' : 'wow'
    const w = await GameWindow()
    ui.gameWindow = w.mode === 'windowed' || w.mode === 'fullscreen' ? w.mode : ''
    if (w.resolution) ui.gameResolution = w.resolution
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

/**
 * Sets how the game's window opens when Meld starts it (Game › Game Window): the game's own
 * setting, windowed or fullscreen, at `resolution`. Meld writes it into the game's own settings
 * (Benilla's config.toml, Wow.exe's Config.wtf) each time it starts the game.
 */
export async function setGameWindow(mode: '' | 'windowed' | 'fullscreen', resolution = ui.gameResolution) {
  if (!hasBackend()) return
  try {
    await SetGameWindow(mode, resolution)
    await refreshGameClient()
    const size = resolution.replace('x', '×')
    setStatus(mode === '' ? 'The game opens as its own Video options say.' : `The game opens ${mode === 'windowed' ? `in a ${size} window` : `fullscreen (${size} for Wow.exe)`} the next time Meld starts it.`, 6000)
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
    setStatus(info.benillaBuilt ? `Benilla folder: ${dir}. Pick Game › Benilla to use it.` : `Benilla folder: ${dir}, but it isn't built: run cargo build --release -p benilla there.`, 8000)
  } catch (e) {
    setStatus(`${e}`, 8000)
  }
}

/**
 * Opens the chosen game client now, logged in with the saved Game Login. With a saved character, it
 * enters the world where the camera is, when the open map is in the client.
 */
export async function launchGame(engine: Engine | null, opts: { anyway?: boolean } = {}) {
  if (!hasBackend()) return
  const game = ui.gameClient === 'benilla' ? 'Benilla' : 'World of Warcraft'
  // The game shows the client's tiles: an open region with edits they lack asks first (#214).
  if (engine && !opts.anyway && (await uncompiledName(engine))) {
    ui.dialog = 'compileBeforeLaunch'
    return
  }
  try {
    const spot = engine ? await engine.playerSpot() : null
    if (!spot) {
      await LaunchGame()
      setStatus(`Starting ${game}…`, 4000)
      return
    }
    // Placing the character can wait for the server to log it out.
    setStatus(`Starting ${game}…`, 20000)
    const placed = await LaunchGameAt(vmangos.CharacterSpot.createFrom(spot))
    setStatus(placed ? `Starting ${game} with ${placed} where the camera is…` : `Starting ${game}…`, 5000)
  } catch (e) {
    setStatus(`The game didn't start: ${e}`, 8000)
  }
}

/**
 * The active region's name when it has edits the client lacks (`regionUncompiled`), else ''; kept in
 * `ui.uncompiledRegion` for the launch dialog. A failed check (no client folder) doesn't stop a launch.
 */
async function uncompiledName(engine: Engine): Promise<string> {
  const region = engine.activeRegion()
  let stale = false
  try {
    stale = !!region && (await regionUncompiled(engine))
  } catch (e) {
    console.warn('compile check failed', e)
  }
  ui.uncompiledRegion = stale && region ? regionName(region) : ''
  return ui.uncompiledRegion
}

/** The launch dialog's Compile and Launch: Compile to Client, then the launch once the client has the edits. */
export async function compileAndLaunch(engine: Engine) {
  await compileRegion(engine, 'client')
  if (await uncompiledName(engine)) return
  await launchGame(engine, { anyway: true })
}

/**
 * Play here: moves the Game Login's character, in the world now, to where the camera is, through the
 * running world server, without closing the game. When it can't, the status bar says why and points
 * to Launch.
 */
export async function playHere(engine: Engine | null) {
  if (!hasBackend() || !engine) return
  try {
    const spot = await engine.playerSpot()
    if (!spot) {
      setStatus('Play here: the camera is not over a map that is in the client.', 6000)
      return
    }
    const moved = await PlayHere(vmangos.CharacterSpot.createFrom(spot))
    const stale = await uncompiledName(engine)
    setStatus(stale ? `Moved ${moved} to where the camera is. The game shows ${stale} without its latest edits: File › Compile to Client writes them (it restarts the game).` : `Moved ${moved} to where the camera is.`, stale ? 12000 : 4000)
  } catch (e) {
    setStatus(`Play here didn't move the character: ${e}. Game › Launch puts it there by restarting the game.`, 12000)
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
/** Clears the Saving bar of the publish running in the background; a no-op when none is. */
let endPublish = () => {}
let listening = false

/** Routes progress from the background publish to the status bar, once. */
function listenToPublish() {
  if (listening) return
  listening = true
  EventsOn('publish:log', (line: string) => {
    setStatus(line, 0)
    savingDetail(line)
  })
  EventsOn('publish:done', (msg: string) => {
    ui.busy = false
    endPublish()
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
    endPublish = startSaving(`Publishing ${ref.dir}`)
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
      endPublish()
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
