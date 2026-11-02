// The session map's settings in a shared session (#1019, docs/architecture/session.md): the sea, the
// texture roles, the ground effects per texture, zone and tile, the texture looks, the paths, and on a map
// made for the client its Map Properties facts and its tile mask. Every member's save holds them, so a
// change one member makes goes out and every member applies the others' in the host's order.
//
// They are small and rarely change, so a changed field goes out whole: kind `settings`, data
// `{id, set: {<field>: value}}`. The change is found by comparing each field's JSON against `mirror` (the
// field as this member last sent or received it) on the heights' timer, so no setter needs a hook and an
// undo syncs like any edit. The later message in the host's order wins per field; a field of mine still
// unacknowledged stays over another member's, which the host's order puts before mine.
//
// What stays the member's own (the tab's name and file, the palette, bookmarks, the reference image, the
// paint layer choices, the locks, the path pick) is not here. Kept free of the bindings and the runes
// state so a Bun test can run two members against a scripted host.
import { paletteIndex } from '../terrain/chunkPaint'
import { readPaths, type MapPath } from '../terrain/paths'
import { NO_ROLE, type TextureRoles } from '../terrain/roles'
import type { ScopedEffects, TextureEffects } from '../world/groundEffects'
import type { TextureLooks } from '../world/textureLooks'
import type { MapInfo } from '../engine/mapInfo'
import type { VmangosRef } from '../engine/MapDocument'

/** The kind of a message carrying map settings (data: `SettingsData`). */
export const KIND_SETTINGS = 'settings'

/** The synced fields. `info` and `tiles` only on a map made for the client (a `vmangos` ref). */
export const SETTINGS_FIELDS = ['waterLevel', 'waterEnabled', 'roles', 'textureEffects', 'textureLooks', 'scopedEffects', 'paths', 'info', 'tiles'] as const
export type SettingsField = (typeof SETTINGS_FIELDS)[number]

/** The fields as they go out: plain JSON, the roles as texture paths ('' for none) since each member keeps its own palette (#1002). */
export type MapSettings = Partial<Record<SettingsField, unknown>>

/** A `settings` message's data: the sender's own count `id` and the changed fields whole. */
export interface SettingsData {
	id: number
	set: MapSettings
}

/** Where a map's settings live: `editor` while the map is the active tab, its document's `meta` otherwise; both have these keys. */
export interface SettingsStore {
	palette: string[]
	waterLevel: number
	waterEnabled: boolean
	roles: TextureRoles
	textureEffects: TextureEffects
	textureLooks: TextureLooks
	scopedEffects: ScopedEffects
	paths: MapPath[]
}

/** The synced fields of a map as they go out. `vmangos` is the map's client ref (Map Properties' facts and tile mask), null for none. */
export function readSettings(s: SettingsStore, vmangos: VmangosRef | null): MapSettings {
	const role = (i: number) => (i === NO_ROLE ? '' : (s.palette[i] ?? ''))
	const out: MapSettings = {
		waterLevel: s.waterLevel,
		waterEnabled: s.waterEnabled,
		roles: { rock: role(s.roles.rock), dirt: role(s.roles.dirt) },
		textureEffects: s.textureEffects,
		textureLooks: s.textureLooks,
		scopedEffects: s.scopedEffects,
		paths: s.paths,
	}
	if (vmangos) {
		out.info = vmangos.info ?? null
		out.tiles = vmangos.tiles ?? ''
	}
	return out
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A path-to-number record (ground effects, looks) as a fresh object, its entries that are not numbers dropped. */
function numbers(v: Record<string, unknown>): Record<string, number> {
	const out: Record<string, number> = {}
	for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n
	return out
}

/**
 * Writes the fields of `set` that fit into the map: fresh objects, replaced whole, since the engine tells a
 * change of the ground effects and looks by identity. `setTiles` applies a tile mask ('' for every tile) to
 * the terrain. Returns the fields written; one that doesn't fit (a wrong type, `info` on a map without a
 * client ref) is skipped.
 */
export function writeSettings(s: SettingsStore, vmangos: VmangosRef | null, set: MapSettings, setTiles: (tiles: string) => void): SettingsField[] {
	const done: SettingsField[] = []
	for (const f of SETTINGS_FIELDS) {
		if (!(f in set)) continue
		const v = set[f]
		switch (f) {
			case 'waterLevel':
				if (typeof v !== 'number' || !Number.isFinite(v)) continue
				s.waterLevel = v
				break
			case 'waterEnabled':
				if (typeof v !== 'boolean') continue
				s.waterEnabled = v
				break
			case 'roles': {
				if (!isObject(v) || typeof v.rock !== 'string' || typeof v.dirt !== 'string') continue
				// A texture this member's palette lacks is no role here (the paint sync's `add` makes that rare).
				const at = (path: string) => (path ? paletteIndex(s.palette, path) : NO_ROLE)
				s.roles = { rock: at(v.rock), dirt: at(v.dirt) }
				break
			}
			case 'textureEffects':
				if (!isObject(v)) continue
				s.textureEffects = numbers(v)
				break
			case 'textureLooks':
				if (!isObject(v)) continue
				s.textureLooks = numbers(v)
				break
			case 'scopedEffects': {
				if (!isObject(v) || !isObject(v.zones) || !isObject(v.tiles)) continue
				const scope = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).flatMap(([k, e]) => (isObject(e) ? [[k, numbers(e)]] : [])))
				s.scopedEffects = { zones: scope(v.zones), tiles: scope(v.tiles) }
				break
			}
			case 'paths':
				if (!Array.isArray(v)) continue
				s.paths = readPaths(v)
				break
			case 'info':
				if (!vmangos || (v !== null && !isObject(v))) continue
				if (v === null) delete vmangos.info
				else vmangos.info = { ...(v as Partial<MapInfo>) } as MapInfo
				break
			case 'tiles':
				if (!vmangos || typeof v !== 'string' || !/^[01]*$/.test(v)) continue
				if (v) vmangos.tiles = v
				else delete vmangos.tiles
				setTiles(v)
				break
		}
		done.push(f)
	}
	return done
}

export interface SettingsSyncHooks {
	/** The bound map's synced fields now (`readSettings`), or null while it is not open. */
	read(): MapSettings | null
	/** Writes another member's fields into the map (`writeSettings`); returns the fields written. */
	write(set: MapSettings): SettingsField[]
	/** Sends one message to everyone; resolves once the host has it. */
	send(data: SettingsData): Promise<unknown>
	/** After another member's fields were written in. */
	applied?(fields: SettingsField[]): void
	/** A send failed: the others never got those fields. */
	failed?(err: unknown): void
}

interface Pending {
	id: number
	fields: string[]
}

interface Held {
	seq: number
	data: unknown
}

/** One member's settings sync for the session's map. */
export class SettingsSync {
	/** What the sync is bound to (the session map's document): the session code checks it is still the map open. */
	private token: object | null = null
	/** Each field's JSON as this member last sent or received it. */
	private mirror: Map<string, string> | null = null
	/** My sent messages the host has not sent back yet, oldest first, with their fields. */
	private pending: Pending[] = []
	private held: Held[] = []
	private holding = false
	private after = 0
	private nextId = 1

	constructor(private readonly hooks: SettingsSyncHooks) {}

	get bound(): object | null {
		return this.token
	}

	/** The sent messages not yet acknowledged (for the tests). */
	get unacknowledged(): number {
		return this.pending.length
	}

	/** Holds the settings messages that arrive until `bind`, as a guest does until the host's map opens. */
	wait() {
		this.unbind()
		this.holding = true
	}

	/** Syncs the map `token` stands for from now on, as it stands: the map as it was after message `afterSeq`. Held messages after that are applied. */
	bind(token: object, afterSeq: number) {
		const held = this.held
		this.token = token
		this.mirror = jsonOf(this.hooks.read())
		this.pending = []
		this.held = []
		this.holding = false
		this.after = afterSeq
		for (const m of held) if (m.seq > afterSeq) this.applyData(m.data)
	}

	/** Stops syncing (the session ended or its map was closed). */
	unbind() {
		this.token = null
		this.mirror = null
		this.pending = []
		this.held = []
		this.holding = false
		this.after = 0
	}

	/** Sends the fields changed since the last flush, if any. Runs on the heights' timer and before a remote message is applied. */
	flush() {
		const mirror = this.mirror
		const now = this.token && mirror ? this.hooks.read() : null
		if (!now || !mirror) return
		const set: MapSettings = {}
		const fields: string[] = []
		for (const f of SETTINGS_FIELDS) {
			if (!(f in now)) continue
			const j = JSON.stringify(now[f])
			if (mirror.get(f) === j) continue
			mirror.set(f, j)
			// A copy, since the send's JSON is made later in the queue and the field can change in place before then.
			set[f] = JSON.parse(j) as unknown
			fields.push(f)
		}
		if (!fields.length) return
		const id = this.nextId++
		this.pending.push({ id, fields })
		this.hooks.send({ id, set }).catch((err) => {
			this.pending = this.pending.filter((p) => p.id !== id)
			this.hooks.failed?.(err)
		})
	}

	/** A `settings` message from the session, `you` this member's id. */
	receive(seq: number, from: number, data: unknown, you: number) {
		if (from === you) {
			const id = (data as SettingsData | null)?.id
			const i = this.pending.findIndex((p) => p.id === id)
			if (i >= 0) this.pending.splice(i, 1)
			return
		}
		if (!this.token) {
			if (this.holding) this.held.push({ seq, data })
			return
		}
		if (seq <= this.after) return
		this.applyData(data)
	}

	/** Writes another member's fields in, but for those of mine still unacknowledged, which come after it in the host's order. False for a message with nothing to write. */
	private applyData(data: unknown): boolean {
		const d = data as SettingsData | null
		if (!this.token || !d || !isObject(d.set)) return false
		// My edits not sent yet are pending from here on, so they stay over this one too.
		this.flush()
		const mine = new Set<string>()
		for (const p of this.pending) for (const f of p.fields) mine.add(f)
		const set: MapSettings = {}
		let any = false
		for (const f of SETTINGS_FIELDS) {
			if (!(f in d.set) || mine.has(f)) continue
			set[f] = d.set[f]
			any = true
		}
		if (!any) return false
		const done = this.hooks.write(set)
		if (!done.length) return false
		// The mirror takes the fields as written here (a role whose texture this member lacks reads back as none), so the apply is not sent back.
		const now = this.hooks.read()
		const mirror = this.mirror!
		for (const f of done) if (now && f in now) mirror.set(f, JSON.stringify(now[f]))
		this.hooks.applied?.(done)
		return true
	}
}

/** Each field's JSON. */
function jsonOf(s: MapSettings | null): Map<string, string> {
	const out = new Map<string, string>()
	if (s) for (const f of SETTINGS_FIELDS) if (f in s) out.set(f, JSON.stringify(s[f]))
	return out
}
