// The server's spawns in a shared session (#1020): the creatures and game
// objects of the session map's region, which are rows of the host's world database and not in the `.wmap`.
// The host sends its spawn layer's rows with the map (`MapHandoff.spawns`), each row holding what it needs
// to draw (name, model, look), so a guest needs no server of its own; every member's spawn edits (placing,
// the spawn brush, moving, turning, deleting, waypoints, the creature editor's fields, an area paste, an
// undo) go out as the changed rows whole, and the host's Save Spawns writes them all (the owner's choice A).
//
// State, not commands, as the placed objects (objects.ts, #1003): a `spawns` message holds each added or
// changed row whole, keyed by `spawnKey`, and the keys of the removed ones. The changed keys come from
// `SpawnLayer`'s own marks (`takeSessionChanges`: add, remove, touch, refresh), compared against `mirror`,
// the rows as this member last sent or received them, so a touch that changed nothing sends nothing.
//
// Guids: a new spawn takes a guid in its member's lane (`SpawnActions.setLane`, the object id lanes'
// numbers), counted from the host's next guids (`SpawnFloors`, sent in the handoff), so two members placing
// at once never make the same one. A spawn made in the editor goes out the first time with what it was
// when placed (`orig`), which the host's save compares against, as its own layer would.
//
// The order, the replay of one's own unacknowledged spawns over another member's and the guest's held
// messages are the heights'. Kept free of the bindings so a Bun test can run two members against a
// scripted host.
import type { vmangos } from '../wails/models'
import { cloneSpawn, type SpawnLayer } from '../world/SpawnLayer'
import { spawnKey } from '../world/spawnKey'

/** The kind of a message carrying spawns (data: `SpawnsData`). */
export const KIND_SPAWNS = 'spawns'

/** A `spawns` message's data: the sender's own count `id`, the rows added or changed (`put`), the keys removed (`del`), and what each new spawn among `put` was when placed (`orig`, by key). */
export interface SpawnsData {
	id: number
	put: vmangos.WorldSpawn[]
	del: string[]
	orig?: Record<string, vmangos.WorldSpawn>
}

/** The host's next creature guid, game object guid and pool entry, from which a guest counts in its lane. */
export interface SpawnFloors {
	creature: number
	object: number
	pool: number
}

/** The spawns the host sends with the map: its layer's rows, and the floors a joining guest counts its guids from. */
export interface SpawnHandoff {
	rows: vmangos.WorldSpawn[]
	floors?: SpawnFloors
}

/** What the sync needs of a `SpawnLayer`. */
export type SpawnGround = Pick<SpawnLayer, 'spawns' | 'get' | 'add' | 'remove' | 'touch' | 'refresh' | 'batch' | 'trackSession' | 'takeSessionChanges' | 'createdOriginal'>

export interface SpawnSyncHooks {
	/** Sends one message to everyone; resolves once the host has it. */
	send(data: SpawnsData): Promise<unknown>
	/** After another member's spawns were written in: the keys added, changed or removed. */
	applied?(keys: readonly string[]): void
	/** A send failed: the others never got those spawns. */
	failed?(err: unknown): void
}

interface Pending {
	id: number
	put: vmangos.WorldSpawn[]
	del: string[]
}

interface Held {
	seq: number
	data: unknown
}

const KINDS = new Set(['monster', 'npc', 'object'])
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A row as received, checked for what its key and its place need; null when it doesn't fit. */
function readRow(v: unknown): vmangos.WorldSpawn | null {
	const s = v as Partial<vmangos.WorldSpawn> | null
	if (!s || typeof s !== 'object' || typeof s.kind !== 'string' || !KINDS.has(s.kind)) return null
	if (!Number.isInteger(s.guid) || (s.guid as number) <= 0 || !isNum(s.x) || !isNum(s.y) || !isNum(s.z) || !isNum(s.orientation)) return null
	return s as vmangos.WorldSpawn
}

/** One member's spawns sync for the session's map. */
export class SpawnSync {
	private layer: SpawnGround | null = null
	/** The rows as this member last sent or received them, as JSON, by key. */
	private mirror = new Map<string, string>()
	private pending: Pending[] = []
	private held: Held[] = []
	private holding = false
	private after = 0
	private nextId = 1
	private readonly marks = new Set<string>()

	constructor(private readonly hooks: SpawnSyncHooks) {}

	get bound(): SpawnGround | null {
		return this.layer
	}

	/** The sent messages not yet acknowledged (for the tests). */
	get unacknowledged(): number {
		return this.pending.length
	}

	/** Holds the spawns messages that arrive until `bind`, as a guest does until the host's map opens. */
	wait() {
		this.unbind()
		this.holding = true
	}

	/** Syncs `layer` from now on, as it stands: the map as it was after message `afterSeq`. Held messages after that are applied, older ones are already in it. */
	bind(layer: SpawnGround, afterSeq: number) {
		const held = this.held
		this.unbind()
		this.layer = layer
		for (const s of layer.spawns) this.mirror.set(spawnKey(s), JSON.stringify(s))
		layer.trackSession(true)
		this.after = afterSeq
		for (const m of held) if (m.seq > afterSeq) this.applyData(m.data)
	}

	/** Stops syncing (the session ended or its map was closed). */
	unbind() {
		this.layer?.trackSession(false)
		this.layer = null
		this.mirror.clear()
		this.marks.clear()
		this.pending = []
		this.held = []
		this.holding = false
		this.after = 0
	}

	/** Sends the spawns changed since the last flush, if any. Runs every `HEIGHTS_FLUSH_MS` and before a remote message is applied. */
	flush() {
		const L = this.layer
		if (!L) return
		const marked = L.takeSessionChanges(this.marks)
		if (marked === false) return
		if (marked === null) {
			// The layer was filled again (spawns read from the database): anything may have changed.
			for (const k of this.mirror.keys()) this.marks.add(k)
			for (const s of L.spawns) this.marks.add(spawnKey(s))
		}
		const put: vmangos.WorldSpawn[] = []
		const del: string[] = []
		let orig: Record<string, vmangos.WorldSpawn> | undefined
		for (const key of this.marks) {
			const s = L.get(key)
			const was = this.mirror.get(key)
			if (s) {
				const json = JSON.stringify(s)
				if (was === json) continue
				put.push(JSON.parse(json) as vmangos.WorldSpawn)
				this.mirror.set(key, json)
				// A spawn made here goes out the first time with what it was when placed, which the host's save compares against.
				const o = was === undefined ? L.createdOriginal(key) : undefined
				if (o) (orig ??= {})[key] = cloneSpawn(o)
			} else if (was !== undefined) {
				del.push(key)
				this.mirror.delete(key)
			}
		}
		this.marks.clear()
		if (!put.length && !del.length) return
		const id = this.nextId++
		this.pending.push({ id, put, del })
		const data: SpawnsData = orig ? { id, put, del, orig } : { id, put, del }
		this.hooks.send(data).catch((err) => {
			this.pending = this.pending.filter((p) => p.id !== id)
			this.hooks.failed?.(err)
		})
	}

	/** A `spawns` message from the session, `you` this member's id. */
	receive(seq: number, from: number, data: unknown, you: number) {
		if (from === you) {
			const id = (data as SpawnsData | null)?.id
			const i = this.pending.findIndex((p) => p.id === id)
			if (i >= 0) this.pending.splice(i, 1)
			return
		}
		if (!this.layer) {
			if (this.holding) this.held.push({ seq, data })
			return
		}
		if (seq <= this.after) return
		this.applyData(data)
	}

	/** Writes another member's spawns in, then mine still unacknowledged over them. False for a message that doesn't fit. */
	private applyData(data: unknown): boolean {
		const L = this.layer
		const d = data as Partial<SpawnsData> | null
		if (!L || !d || !Array.isArray(d.put) || !Array.isArray(d.del)) return false
		const put: vmangos.WorldSpawn[] = []
		for (const v of d.put) {
			const s = readRow(v)
			if (s) put.push(s)
		}
		const del = d.del.filter((k): k is string => typeof k === 'string' && k !== '')
		if (!put.length && !del.length) return false
		const orig = d.orig && typeof d.orig === 'object' ? d.orig : {}
		// My changes not sent yet are pending from here on, so they are written back over this one too.
		this.flush()
		const keys = new Set<string>()
		// One redraw for the whole message, not one for each spawn added or removed (#193).
		L.batch(() => {
			for (const key of del) {
				const s = L.get(key)
				if (s) L.remove(s)
				keys.add(key)
			}
			for (const s of put) {
				const key = spawnKey(s)
				this.write(L, s, readRow(orig[key]) ?? undefined)
				keys.add(key)
			}
			for (const p of this.pending) {
				for (const key of p.del) {
					const s = keys.has(key) ? L.get(key) : undefined
					if (s) L.remove(s)
				}
				for (const s of p.put) if (keys.has(spawnKey(s))) this.write(L, s)
			}
		})
		for (const key of keys) {
			const s = L.get(key)
			if (s) this.mirror.set(key, JSON.stringify(s))
			else this.mirror.delete(key)
		}
		// Not an edit of mine: the flush above took every earlier mark, so these are the apply's alone.
		L.takeSessionChanges(this.marks)
		this.marks.clear()
		this.hooks.applied?.([...keys])
		return true
	}

	/**
	 * Writes a row into the layer: a new spawn is added (with what it was when placed, `orig`, for one made
	 * in the editor), an existing one is written over in place, as an edit (History's steps and the
	 * Inspector find it by key, and some hold the spawn itself).
	 */
	private write(L: SpawnGround, row: vmangos.WorldSpawn, orig?: vmangos.WorldSpawn) {
		const w = cloneSpawn(row)
		const s = L.get(spawnKey(w))
		if (!s) {
			L.add(w, orig ? cloneSpawn(orig) : w)
			return
		}
		L.touch(s)
		// The sender's row whole: a field it lacks goes here too.
		for (const k of Object.keys(s)) if (!(k in w)) Reflect.deleteProperty(s, k)
		Object.assign(s, w)
		L.refresh(s)
	}
}
