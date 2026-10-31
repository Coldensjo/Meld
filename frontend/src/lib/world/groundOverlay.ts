import type { Terrain } from '../terrain/Terrain'
import { CHUNK_CELLS } from '../terrain/chunkPaint'
import { AreaRows } from '../wails/App'
import { hasBackend } from '../io/backend'
import type { vmangos } from '../wails/models'
import type { SpawnLayer } from './SpawnLayer'
import { SpawnGround, chunkZoneLevels, groundCounts, type GroundOverlay } from './spawnGround'

/** A map's areas: each one's exploration level and parent zone, from AreaTable.dbc's rows. */
interface ZoneTable {
	level: Map<number, number>
	parent: Map<number, number>
}

/** What one terrain's overlay was last brought up to. */
interface GroundState {
	ground: SpawnGround
	layer: SpawnLayer
	version: number
	moveSeq: number
	table: ZoneTable | null
	areaVersion: number
	zones: Int16Array | null
}

/**
 * View › Ground overlay (#950) for the engine: keeps each terrain's SpawnGround up to its spawn layer
 * (all of it when the layer's `version` moved, only the spawns in its move log otherwise), the chunks'
 * zone levels up to the area IDs and AreaTable, and writes the changed cells into the terrain's cell
 * texture. `update` runs every frame and costs a few comparisons when nothing changed.
 */
export class GroundOverlayView {
	private states = new WeakMap<Terrain, GroundState>()
	/** Each map's zone table, by map ID; null while it is being read or when it can't be. */
	private tables = new Map<number, ZoneTable | null>()
	private wasOn = false
	private layer: SpawnLayer | null = null
	/** A creature counts while the world events shown show it. */
	private readonly counts = (s: vmangos.WorldSpawn) => groundCounts(s) && (this.layer?.eventShown(s) ?? true)

	/** The overlay's sums for `t`, when it has been shown on it (for the probes and tests). */
	groundOf(t: Terrain): SpawnGround | null {
		return this.states.get(t)?.ground ?? null
	}

	update(mode: GroundOverlay, stray: number, t: Terrain, layer: SpawnLayer, mapId: number | null) {
		if (mode === 'off' || !layer.spawns.length) {
			this.wasOn = false
			t.setSpawnOverlay(0, 0, 0)
			return
		}
		// Turned on again: the zones are read again, as the Zones window may have changed their levels.
		if (!this.wasOn) this.tables.clear()
		this.wasOn = true
		this.layer = layer
		let st = this.states.get(t)
		if (!st || st.layer !== layer) {
			st = { ground: new SpawnGround(t.size, t.cellSize, CHUNK_CELLS), layer, version: -1, moveSeq: -1, table: null, areaVersion: -1, zones: null }
			this.states.set(t, st)
		}
		const g = st.ground
		if (st.version !== layer.version) {
			g.sync(layer.spawns, this.counts)
			st.version = layer.version
			st.moveSeq = layer.moveSeq
		} else if (st.moveSeq !== layer.moveSeq) {
			const moved = layer.movedSince(st.moveSeq)
			if (moved) g.update(moved, this.counts)
			else g.sync(layer.spawns, this.counts)
			st.moveSeq = layer.moveSeq
		}
		const table = mapId === null ? null : this.table(mapId)
		if (table !== st.table || (table && st.areaVersion !== t.chunkDataVersion)) {
			st.table = table
			st.areaVersion = t.chunkDataVersion
			st.zones = table ? chunkZoneLevels(t.areaIds, table.level, table.parent) : null
		}
		g.setZones(st.zones, stray)
		if (g.dirty) t.touchSpawnCells(g.encode(t.spawnCellBytes()))
		const [lo, hi] = layer.levelSpread
		t.setSpawnOverlay(mode === 'level' ? 1 : 2, lo, hi)
	}

	/** Map `mapId`'s zone table, read on the first call; null until it has come. */
	private table(mapId: number): ZoneTable | null {
		const have = this.tables.get(mapId)
		if (have !== undefined) return have
		this.tables.set(mapId, null)
		if (!hasBackend()) return null
		AreaRows(mapId)
			.then((rows) => {
				const level = new Map<number, number>()
				const parent = new Map<number, number>()
				for (const r of rows ?? []) {
					level.set(r.id, r.level)
					if (r.parent) parent.set(r.id, r.parent)
				}
				if (this.tables.has(mapId)) this.tables.set(mapId, { level, parent })
			})
			.catch((err) => console.warn('zone levels not read', err))
		return null
	}
}
