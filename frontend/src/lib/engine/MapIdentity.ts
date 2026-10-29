import type { DocMeta } from './MapDocument'
import { TILE_YARDS } from '../wow/format'

/** What a map's identity is read from: a document's meta and, for a world view (#754), its map's folder. */
export interface MapPlace {
	readonly meta: Pick<DocMeta, 'region' | 'vmangos'>
	readonly world?: { readonly mapName: string } | null
}

/** A row of the client's map list (Map.dbc): its folder, ID and instance type. */
export interface MapRow {
	Dir: string
	ID: number
	Type: number
}

/** How long a failed read of the map list waits before the per-frame callers try again (ms). */
const RETRY_MS = 10000

/**
 * The client's map list (Map.dbc), out of Engine (#560): the map ID and instance type of a region's or a
 * world view's map by its folder, read once in the background and tried again a while after a failure.
 * Client Lighting, the minimap's light zones, Launch and the teleport command, the navmesh's server
 * tiles, the area triggers, the flight paths and the scripts all find the open map's ID through it.
 */
export class MapIdentity {
	/** Map.dbc IDs by folder name (lower case). */
	private ids: Map<string, number> | null = null
	/** The maps' instance types (0 a continent, 1 a dungeon, 2 a raid, 3 a battleground), by folder. */
	private types: Map<string, number> | null = null
	/** The list being read, once asked for. */
	private loading: Promise<void> | null = null
	/** When the last read failed, so the per-frame callers retry only every few seconds. */
	private failedAt = -Infinity

	/** `read` reads the client's map list; `failed` tells the user it could not be read. */
	constructor(
		private read: () => Promise<MapRow[] | null>,
		private failed: (err: unknown) => void,
		private now: () => number = () => performance.now(),
	) {}

	/** Reads the client's map list once; resolves (never rejects) when it is read or the read failed. */
	load(): Promise<void> {
		if (this.ids) return Promise.resolve()
		this.loading ??= this.read()
			.then((rows) => {
				this.types = new Map((rows ?? []).map((r) => [r.Dir.toLowerCase(), r.Type]))
				this.ids = new Map((rows ?? []).map((r) => [r.Dir.toLowerCase(), r.ID]))
			})
			.catch((e) => {
				// Leave the list unknown (never an empty one, which would read as map 0), and retry later.
				this.failedAt = this.now()
				this.failed(e)
			})
			.finally(() => void (this.loading = null))
		return this.loading
	}

	/** Whether the list is read; when not, starts its read, unless the last one failed a moment ago. */
	private ready(): boolean {
		if (this.ids) return true
		if (this.now() - this.failedAt > RETRY_MS) void this.load()
		return false
	}

	/**
	 * A map's Map.dbc ID: a map made for the client's own, a region's or a world view's by its folder; 0
	 * for a map of Meld's own not yet in the client; null while the client's map list is read, when it
	 * cannot be read or the folder is not in it. Allocates nothing, so a frame may ask.
	 */
	idOf(d: MapPlace): number | null {
		const m = d.meta
		if (m.vmangos) return m.vmangos.mapId
		const folder = m.region?.mapName ?? d.world?.mapName
		if (folder === undefined) return 0
		if (!this.ready()) return null
		return this.ids!.get(folder.toLowerCase()) ?? null
	}

	/** A map's ID as idOf gives it, after waiting for the client's map list when its folder needs it. */
	async resolve(d: MapPlace): Promise<number | null> {
		if (!d.meta.vmangos) await this.load()
		return this.idOf(d)
	}

	/** The ID of the map in `folder`, or undefined while the list is unread or the folder is not in it; starts no read. */
	idByFolder(folder: string): number | undefined {
		return this.ids?.get(folder.toLowerCase())
	}

	/** The instance type of the map in `folder`; -1 when it is not in the list, null while the list is unread (starting its read). */
	typeOf(folder: string): number | null {
		if (!this.ready()) return null
		return this.types!.get(folder.toLowerCase()) ?? -1
	}
}

/**
 * The client tile at a map's north-west corner: a region's first tile, a map made for the client's
 * place on the grid (#46, 0,0 for one made before), else 0,0. Written into `out`, so a frame may ask.
 */
export function tileOrigin<T extends { x: number; y: number }>(m: Pick<DocMeta, 'region' | 'vmangos'>, out: T): T {
	if (m.region) {
		out.x = m.region.x
		out.y = m.region.y
	} else {
		out.x = m.vmangos?.tileX ?? 0
		out.y = m.vmangos?.tileY ?? 0
	}
	return out
}

/**
 * How far a map's editor frame lies from the tiles' placement frame (the whole map's, in yards), which
 * the client's lights are placed in: a point's x plus `out.x` and its z plus `out.y` is its place there.
 */
export function fileFrameOffset<T extends { x: number; y: number }>(m: Pick<DocMeta, 'region' | 'vmangos'>, out: T): T {
	tileOrigin(m, out)
	out.x *= TILE_YARDS
	out.y *= TILE_YARDS
	return out
}
