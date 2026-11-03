// Placed objects in a shared session (#1003): every change to the session
// map's models, WMOs and helper shapes (placing, deleting, moving, turning, scaling, attaching, a new
// model or group, an undo) goes out as the changed objects whole, a few times a second while it lasts,
// and every member applies the others' in the host's order, as heights and paint do (heights.ts, #1001).
//
// State, not commands: an `objects` message holds each added or changed object in its saved form (the
// `.wmap`'s fields, local to its parent when attached) and the ids of the removed ones. The changed ids
// come from `ObjectLayer`'s own marks (`takeSessionChanges`: add, remove, touch, setType, setGroup),
// compared against `mirror`, the objects as this member last sent or received them, so a touch that
// changed nothing sends nothing.
//
// Ids: each member makes new ids and selection groups in a lane of its own (`ObjectLayer.setLane`), the
// numbers equal to its lane modulo LANES, counted from above every id the host's layer has held (the
// handoff's `IdLane`), so two members placing at once never make the same id. The host hands out the
// lanes (`Lanes`). An id is the editor's alone: the client export gives a new model its unique ID itself,
// and the host keeps the ones its map read from the client (`RegionRef.uids`) by id.
//
// The order, the replay of one's own unacknowledged objects over another member's and the guest's held
// messages are the heights'. Kept free of the bindings so a Bun test can run two members against a
// scripted host.
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import { HOST_ID } from './peers'

/** The kind of a message carrying objects (data: `ObjectsData`). */
export const KIND_OBJECTS = 'objects'

/** The id lanes: one for each member a session holds at once, the host and `session.MaxGuests` (15) guests. */
export const LANES = 16

/** One object on the wire, as the `.wmap` saves it (`mapfile.PlacedObject` without the client's unique ID). */
export interface WireObject {
	id: number
	type: string
	parent?: number
	x: number
	z: number
	yOff: number
	rotY: number
	tiltX?: number
	tiltZ?: number
	scale: number
	group?: number
}

/** An `objects` message's data: the sender's own count `id`, the objects added or changed (`put`) and the ids removed (`del`). */
export interface ObjectsData {
	id: number
	put: WireObject[]
	del: number[]
}

/** A member's id lane and the counts to start it from, which the host hands a guest with the map. */
export interface IdLane {
	lane: number
	nextId: number
	nextGroup: number
}

/** What the sync needs of an `ObjectLayer`. */
export type ObjectGround = Pick<ObjectLayer, 'objects' | 'add' | 'remove' | 'touch' | 'setType' | 'setGroup' | 'setLane' | 'raiseCounts' | 'trackSession' | 'takeSessionChanges'>

export interface ObjectSyncHooks {
	/** Sends one message to everyone; resolves once the host has it. */
	send(data: ObjectsData): Promise<unknown>
	/** After another member's objects were written in: the ids added, changed or removed. */
	applied?(ids: readonly number[]): void
	/** A send failed: the others never got those objects. */
	failed?(err: unknown): void
}

interface Pending {
	id: number
	put: WireObject[]
	del: number[]
}

interface Held {
	seq: number
	data: unknown
}

/** An object's saved form, a new object (never the layer's own). */
export function wireOf(o: WorldObject): WireObject {
	const w: WireObject = { id: o.id, type: o.type, x: o.x, z: o.z, yOff: o.yOff, rotY: o.rotY, scale: o.scale }
	if (o.parent !== undefined) w.parent = o.parent
	if (o.tiltX) w.tiltX = o.tiltX
	if (o.tiltZ) w.tiltZ = o.tiltZ
	if (o.group) w.group = o.group
	return w
}

function same(a: WireObject, b: WireObject): boolean {
	return (
		a.type === b.type &&
		a.x === b.x &&
		a.z === b.z &&
		a.yOff === b.yOff &&
		a.rotY === b.rotY &&
		a.scale === b.scale &&
		a.parent === b.parent &&
		(a.tiltX ?? 0) === (b.tiltX ?? 0) &&
		(a.tiltZ ?? 0) === (b.tiltZ ?? 0) &&
		(a.group ?? 0) === (b.group ?? 0)
	)
}

const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isOptNum = (v: unknown) => v === undefined || isNum(v)

/** A wire object as received, checked, with only its known fields; null when it doesn't fit. */
function readWire(v: unknown): WireObject | null {
	const o = v as Partial<WireObject> | null
	if (!o || !isId(o.id) || typeof o.type !== 'string' || !o.type) return null
	if (!isNum(o.x) || !isNum(o.z) || !isNum(o.yOff) || !isNum(o.rotY) || !isNum(o.scale)) return null
	if (!isOptNum(o.tiltX) || !isOptNum(o.tiltZ) || (o.parent !== undefined && !isId(o.parent)) || (o.group !== undefined && !isId(o.group))) return null
	return wireOf(o as WorldObject)
}

/** One member's objects sync for the session's map. */
export class ObjectSync {
	private layer: ObjectGround | null = null
	/** The objects as this member last sent or received them, by id. */
	private mirror = new Map<number, WireObject>()
	private pending: Pending[] = []
	private held: Held[] = []
	private holding = false
	private after = 0
	private nextId = 1
	private readonly marks = new Set<number>()

	constructor(private readonly hooks: ObjectSyncHooks) {}

	get bound(): ObjectGround | null {
		return this.layer
	}

	/** The sent messages not yet acknowledged (for the tests). */
	get unacknowledged(): number {
		return this.pending.length
	}

	/** Holds the objects messages that arrive until `bind`, as a guest does until the host's map opens. */
	wait() {
		this.unbind()
		this.holding = true
	}

	/**
	 * Syncs `layer` from now on, as it stands, making new ids in `ids`' lane: the map as it was after
	 * message `afterSeq`. Held messages after that are applied, older ones are already in it.
	 */
	bind(layer: ObjectGround, afterSeq: number, ids: IdLane) {
		const held = this.held
		this.unbind()
		this.layer = layer
		for (const o of layer.objects.values()) this.mirror.set(o.id, wireOf(o))
		layer.setLane(ids.lane, LANES)
		layer.raiseCounts(ids.nextId, ids.nextGroup)
		layer.trackSession(true)
		this.after = afterSeq
		for (const m of held) if (m.seq > afterSeq) this.applyData(m.data)
	}

	/** Stops syncing (the session ended or its map was closed): the layer counts ids as before. */
	unbind() {
		if (this.layer) {
			this.layer.trackSession(false)
			this.layer.setLane(0, 1)
		}
		this.layer = null
		this.mirror.clear()
		this.marks.clear()
		this.pending = []
		this.held = []
		this.holding = false
		this.after = 0
	}

	/** Sends the objects changed since the last flush, if any. Runs every `HEIGHTS_FLUSH_MS` and before a remote message is applied. */
	flush() {
		const L = this.layer
		if (!L) return
		const marked = L.takeSessionChanges(this.marks)
		if (marked === false) return
		if (marked === null) {
			// The layer was cleared and filled again: anything may have changed.
			for (const id of this.mirror.keys()) this.marks.add(id)
			for (const id of L.objects.keys()) this.marks.add(id)
		}
		const put: WireObject[] = []
		const del: number[] = []
		for (const id of this.marks) {
			const o = L.objects.get(id)
			const was = this.mirror.get(id)
			if (o) {
				const w = wireOf(o)
				if (was && same(was, w)) continue
				put.push(w)
				this.mirror.set(id, w)
			} else if (was) {
				del.push(id)
				this.mirror.delete(id)
			}
		}
		this.marks.clear()
		if (!put.length && !del.length) return
		const id = this.nextId++
		this.pending.push({ id, put, del })
		this.hooks.send({ id, put, del }).catch((err) => {
			this.pending = this.pending.filter((p) => p.id !== id)
			this.hooks.failed?.(err)
		})
	}

	/** An `objects` message from the session, `you` this member's id. */
	receive(seq: number, from: number, data: unknown, you: number) {
		if (from === you) {
			const id = (data as ObjectsData | null)?.id
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

	/** Writes another member's objects in, then mine still unacknowledged over them. False for a message that doesn't fit. */
	private applyData(data: unknown): boolean {
		const L = this.layer
		const d = data as Partial<ObjectsData> | null
		if (!L || !d || !Array.isArray(d.put) || !Array.isArray(d.del)) return false
		const put: WireObject[] = []
		for (const v of d.put) {
			const w = readWire(v)
			if (w) put.push(w)
		}
		const del = d.del.filter(isId)
		if (!put.length && !del.length) return false
		// My changes not sent yet are pending from here on, so they are written back over this one too.
		this.flush()
		const ids = new Set<number>()
		for (const id of del) {
			L.remove(id)
			ids.add(id)
		}
		for (const w of put) {
			this.write(L, w)
			ids.add(w.id)
		}
		for (const p of this.pending) {
			for (const id of p.del) if (ids.has(id)) L.remove(id)
			for (const w of p.put) if (ids.has(w.id)) this.write(L, w)
		}
		for (const id of ids) {
			const o = L.objects.get(id)
			if (o) {
				// After every write, so an object attached to one in the same message is filed under it.
				L.touch(id)
				this.mirror.set(id, wireOf(o))
			} else this.mirror.delete(id)
		}
		// Not an edit of mine: the flush above took every earlier mark, so these are the apply's alone.
		L.takeSessionChanges(this.marks)
		this.marks.clear()
		this.hooks.applied?.([...ids])
		return true
	}

	/**
	 * Writes a wire object into the layer: a new one is added under its id, an existing one is written
	 * over in place (History's steps and the Inspector find it by id, and some hold the object itself).
	 * Its fields are the sender's saved form, local to its parent when attached, so this is not a move
	 * (`ObjectLayer.place`) but a state copied, as an undo's snapshot is.
	 */
	private write(L: ObjectGround, w: WireObject) {
		const o = L.objects.get(w.id)
		if (!o) {
			L.add({ ...w })
			return
		}
		const { type, group, ...rest } = w
		delete o.parent
		delete o.tiltX
		delete o.tiltZ
		Object.assign(o, rest)
		if (o.type !== type) L.setType(w.id, type)
		if ((o.group ?? 0) !== (group ?? 0)) L.setGroup(w.id, group)
	}
}

/**
 * The host's lanes: which member makes ids in which. The host's is 0; a guest that joins takes the lowest
 * lane no member holds, and frees it when it leaves. A guest taking a freed lane starts counting above
 * every id the host's layer has held (`IdLane.nextId`), so it never makes one its lane's last holder made.
 */
export class Lanes {
	private byMember = new Map<number, number>([[HOST_ID, 0]])

	/** The lane of member `id`, taken now if it has none; null when every lane is held. */
	take(id: number): number | null {
		const had = this.byMember.get(id)
		if (had !== undefined) return had
		const held = new Set(this.byMember.values())
		for (let lane = 1; lane < LANES; lane++) {
			if (held.has(lane)) continue
			this.byMember.set(id, lane)
			return lane
		}
		return null
	}

	/** Member `id` left: its lane is free again. */
	free(id: number) {
		if (id !== HOST_ID) this.byMember.delete(id)
	}
}
