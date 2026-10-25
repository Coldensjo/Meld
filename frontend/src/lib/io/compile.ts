// Writing a region back: Compile to Client, Server and All, whether it has edits the client lacks,
// the rebuild of the server's map data, and saving its spawn edits to the world database.
import { ApplySpawnEdits, SaveSQLDialog, SpawnEditSQL, WriteTextFile, RegionMapID, RegionPending, SaveRegion, UpdateRegionServer, VmangosPath } from '../../../wailsjs/go/main/App'
import { guarded } from './backend'
import type { Engine } from '../engine/Engine'
import { editor, prefs, setStatus, ui } from '../state/editor.svelte'
import { withSaving } from '../state/saving'
import { cachedPending } from './regionKey'
import { floatsToBase64 } from './base64'
import { mapToTiles } from './vmangosExport'
import { TILE_CHUNKS } from '../wow/format'
import { vmangos } from '../../../wailsjs/go/models'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { applyNote } from './applyNote'

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
 * reported, not thrown, so the client's tiles still compile; the caller then leaves the server's map
 * data alone rather than rebuilding it with half the edits.
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

/** The restart hint after spawns were saved with no server rebuild (whose end says to start the world server, #661). */
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

/**
 * The painted chunks of the active region, by block chunk index (rows of TILE_CHUNKS * size chunks), in the
 * encoding the map export uses. Each tile's own chunks are mapped into the block.
 */
function regionPaint(engine: Engine, size: number) {
	const perRow = TILE_CHUNKS * size
	const tiles = mapToTiles(engine.exportInput()).tiles
	const block = (t: { X: number; Y: number }, chunk: number) => (t.Y * TILE_CHUNKS + Math.floor(chunk / TILE_CHUNKS)) * perRow + t.X * TILE_CHUNKS + (chunk % TILE_CHUNKS)
	return {
		paint: tiles.flatMap((t) => t.Paint.map((p) => ({ chunk: block(t, p.Chunk), textures: p.Textures, weights: p.Weights, effects: p.Effects, flags: p.Flags, noEffect: p.NoEffect ?? undefined }))),
		// The chunk headers, by block chunk; for a map saved before it kept chunk data, only holes and shadows (#644).
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
export const regionName = (r: RegionBlock) => `${r.mapName} ${r.x}_${r.y}`

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
 * rebuild. Nothing is closed or restarted (#661): the rebuild waits for the author to close the game
 * (while the tiles wait for it) and stop the world server, which reads the spawns when started again.
 */
export function compileRegion(engine: Engine, target: CompileTarget) {
	const label = target === 'client' ? 'Compiling to the client' : target === 'server' ? 'Compiling to the server' : 'Compiling to the client and server'
	return guarded('Compile region', () =>
		withSaving(label, async () => {
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
			// Tiles outside the block that list a model by its edge are written too (#647).
			const outside = res.outside ? `, and ${res.outside} ${res.outside === 1 ? 'tile' : 'tiles'} beside it for the models by its edge` : ''
			// A running game holds the patch: the files wait for it to close, since Meld never closes it (#661).
			const verb = res.waiting ? 'Compiled' : 'Wrote'
			const wrote =
				(res.building
					? `${verb} ${region.mapName}'s building (its WDT) for ${res.patch}.`
					: `${verb} ${res.changed} of ${res.tiles} tiles of ${name} for the client (${res.patch})${unchanged ? `, ${unchanged} unchanged` : ''}${outside}.`) + applyNote(res)
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
		}),
	)
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
	// The spawns go first (#342); the world server reads them when the author starts it after the rebuild.
	const spawns = await compileSpawns(engine)
	const mapId = await RegionMapID(region.mapName).catch(() => -1)
	if (mapId < 0 || spawns.failed) {
		const only = mapId < 0 && !spawns.failed ? ` The client's Map.dbc has no row for ${region.mapName}, so its map data comes from update-maps.bat in the scripts folder beside the server.` : ''
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
		// Meld stops and starts no server (#661): the author starts it again.
		setStatus(msg ? `Server map update failed: ${msg}` : "The server's map data is rebuilt: start the world server to play on it.", msg ? 0 : 15000)
	})
}
