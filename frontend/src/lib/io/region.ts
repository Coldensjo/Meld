// Blocks of the client's tiles: opening a region or a building, its spawns, growing it, Teleport to
// destination, the world view and Edit Here, and Restore the Client's Paint.
import { LoadBuildingMap, LoadBaseRegionPaint, LoadRegion, LoadSpawns, MapEntries } from '../../../wailsjs/go/main/App'
import { guarded } from './backend'
import type { Engine } from '../engine/Engine'
import type { MapDocument, RegionRef } from '../engine/MapDocument'
import { editor, setStatus, ui } from '../state/editor.svelte'
import { grownBlock, type Side } from './regionGrow'
import { CELL_SIZE } from '../terrain/Terrain'
import { base64ToFloats } from './base64'
import { ALPHA_BYTES, tilePaint } from './tileImport'
import { CHUNK_CELLS } from '../terrain/chunkPaint'
import { CHUNK_IMPASSABLE } from '../terrain/chunkFlags'
import { TILE_CELLS, TILE_CHUNKS } from '../wow/format'
import { tileKey } from './mapTiles'
import { blockAround, blockHolds, spotTile } from '../world/teleport'
import type { TriggerDestination } from '../world/areaTriggers'
import { vmangos } from '../../../wailsjs/go/models'
import { regionUncompiled } from './compile'

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
			const tiles = res.ok ? (((await res.json()) as Array<{ X: number; Y: number }> | null) ?? []) : []
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

/** A region view's chunks and alpha maps in the editor's paint form (tilePaint). */
async function regionViewPaint(view: vmangos.RegionView) {
	const alpha = await regionAlpha(view)
	let at = 0
	const nextAlpha = () => alpha.subarray(at, (at += ALPHA_BYTES))
	const paint = tilePaint(
		view.chunks.map((c) => ({
			indexX: c.indexX,
			indexY: c.indexY,
			layers: (c.layers ?? []).map((l, k) => ({ texture: l.texture, alpha: k > 0 ? nextAlpha() : undefined })),
		})),
		TILE_CHUNKS * view.size,
	)
	if (at !== alpha.length) throw new Error(`the block's alpha maps are ${alpha.length} bytes, its layers take ${at}`)
	return paint
}

/**
 * Terrain › Restore the Client's Paint (#645): puts the active region's paint, in the selected area or
 * everywhere, back to the client's own as its tiles have it without Meld's patch, as one undo step.
 * Compiles before #526 left the patch's chunks at half the alpha resolution, which a region read from
 * the patch keeps for good; after this, the next compile writes the client's alpha maps there again.
 * The paint edits there are lost (undo brings them back).
 */
export function restoreClientPaint(engine: Engine) {
	return guarded("Restore the client's paint", async () => {
		const region = engine.activeRegion()
		if (!region || region.wmoOnly) {
			setStatus("Restore the Client's Paint needs a region opened from the client's tiles (File › Open from Client).", 6000)
			return
		}
		const id = engine.activeDocumentId()
		const paint = await regionViewPaint(await LoadBaseRegionPaint(region.mapName, region.x, region.y, region.size))
		if (engine.activeDocumentId() !== id) return
		setStatus(engine.restoreClientPaint(paint), 8000)
	})
}

/** Opens a block read from the client (LoadRegion, LoadBuildingMap) in a new tab, then its spawns. */
async function openRegionView(engine: Engine, view: vmangos.RegionView) {
	const { mapName, x, y, size } = view
	const paint = await regionViewPaint(view)
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

/** The side of the block Edit Here opens from a world view, in tiles (#15). */
const WORLD_EDIT_BLOCK = 3

/**
 * File › World View (#15): opens the world view of the active region's map, the camera where it was
 * (the region's coordinates moved by the block's corner), or of map `mapName` looking at tile
 * block `at`'s middle (the Start dialog's Part of Azeroth).
 */
export function openWorldView(engine: Engine, mapName?: string, at?: { x: number; y: number; size: number }) {
	const shift = TILE_CELLS * CELL_SIZE
	if (mapName && at) {
		ui.showNewDialog = false
		engine.openWorld(mapName, { x: (at.x + at.size / 2) * shift, z: (at.y + at.size / 2) * shift })
		setStatus(`Opened the world view of ${mapName}: its tiles load around the camera. Edit Here (File menu) opens the block around the camera to edit.`, 8000)
		return
	}
	const region = engine.activeRegion()
	if (!region || region.wmoOnly) {
		setStatus('The world view opens from a region of the client (File › Open from Client), or from the Start dialog.', 6000)
		return
	}
	const c = engine.controller
	const target = c.target.clone()
	target.x += region.x * shift
	target.z += region.y * shift
	engine.openWorld(region.mapName, { x: target.x, z: target.z }, { target, yaw: c.yaw, pitch: c.pitch, distance: c.distance })
	setStatus(`Opened the world view of ${region.mapName}. Edit Here (File menu) opens the block around the camera to edit.`, 8000)
}

/**
 * File › Edit Here (#15): from a world view, opens the block of up to WORLD_EDIT_BLOCK tiles a side
 * around the camera's target in a region tab (or switches to it), with the camera where it was. The
 * world view stays open in its tab.
 */
export function editWorldHere(engine: Engine) {
	return guarded('Edit here', async () => {
		const mapName = engine.activeWorld()
		const have = engine.worldTiles()
		if (!mapName || !have) {
			setStatus('Edit Here opens a block of a world view (File › World View).', 6000)
			return
		}
		// Editing the client's maps needs a project (#48), as the Start dialog's Open does.
		if (!ui.project) {
			ui.dialog = 'project'
			setStatus("Choose a project first: editing the client's maps needs one.", 6000)
			return
		}
		const shift = TILE_CELLS * CELL_SIZE
		const c = engine.controller
		const target = c.target.clone()
		const view = { yaw: c.yaw, pitch: c.pitch, distance: c.distance }
		const tile = { x: Math.floor(target.x / shift), y: Math.floor(target.z / shift) }
		const block = blockAround(tile, have, WORLD_EDIT_BLOCK)
		if (!block) {
			setStatus(`${mapName} has no tile at ${tile.x}_${tile.y} to edit.`, 6000)
			return
		}
		const holds = (r: RegionRef | null) => !!r && !r.wmoOnly && r.mapName.toLowerCase() === mapName.toLowerCase() && blockHolds(r, tile)
		const open = engine.documents.find((d) => holds(d.meta.region))
		if (open) engine.switchDocument(open.id)
		else await openRegionView(engine, await LoadRegion(mapName, block.x, block.y, block.size))
		const r = engine.activeRegion()
		if (!holds(r)) return
		c.setView(target.x - r!.x * shift, target.y, target.z - r!.y * shift, view.yaw, view.pitch, view.distance)
	})
}
