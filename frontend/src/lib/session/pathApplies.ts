// The paths' last applies in a shared session (#1022, docs/architecture/session.md). What an apply writes
// (heights, paint, liquids, models) syncs as those edits, but the record of what it replaced (`appliesOf`,
// pathRecord.ts) stays with the member who applied: another member re-applying that path could not take
// the first apply back and would lay the road a second time. So each member tells the others which paths
// it has a live apply of (kind `pathapply`, data `{id, on, off}`: the path ids whose apply became its own
// since the last flush, and those whose apply it no longer has in the map), and a receiver notes the
// sender as the path's applier (`othersApplies`). The Path tool refuses to apply a path another member
// applied last, naming them, rather than doubling it.
//
// The change is found by comparing this member's live applies against `mirror` on the heights' timer, so
// the Path tool needs no hook and an undo or redo of an apply syncs like any edit. The later message in
// the host's order wins per path: another member's `on` for a path whose `on` of mine is still
// unacknowledged is ordered before mine and dropped; one that is not takes my apply of it out of my map's
// record (`live` false), since theirs was laid over it. Kept free of the bindings so a Bun test can run
// two members against a scripted host.
import type { OthersApply, PathApply } from '../tools/pathRecord'

/** The kind of a message carrying path applies (data: `PathApplyData`). */
export const KIND_PATH_APPLY = 'pathapply'

/** A `pathapply` message's data: the sender's own count `id`, the paths it now has the live apply of, and those it no longer has. */
export interface PathApplyData {
	id: number
	on: number[]
	off: number[]
}

/** What the sync works on: one map's own applies (`appliesOf`) and the others' (`othersApplies`). */
export interface PathApplyMap {
	own: Map<number, PathApply>
	others: Map<number, OthersApply>
}

export interface PathApplySyncHooks {
	/** Sends one message to everyone; resolves once the host has it. */
	send(data: PathApplyData): Promise<unknown>
	/** The name of member `id`, to show. */
	nameOf(id: number): string
	/** A send failed: the others never got those applies. */
	failed?(err: unknown): void
}

interface Pending {
	id: number
	on: number[]
}

interface Held {
	seq: number
	from: number
	data: unknown
}

/** One member's path apply sync for the session's map. */
export class PathApplySync {
	private map: PathApplyMap | null = null
	/** My live applies as last sent (or as the map opened), by path id. */
	private mirror = new Map<number, PathApply>()
	private pending: Pending[] = []
	private held: Held[] = []
	private holding = false
	private after = 0
	private nextId = 1

	constructor(private readonly hooks: PathApplySyncHooks) {}

	get bound(): PathApplyMap | null {
		return this.map
	}

	/** The sent messages not yet acknowledged (for the tests). */
	get unacknowledged(): number {
		return this.pending.length
	}

	/** Holds the messages that arrive until `bind`, as a guest does until the host's map opens. */
	wait() {
		this.unbind()
		this.holding = true
	}

	/**
	 * Syncs `map` from now on, as it stands: the map as it was after message `afterSeq`. Its live applies
	 * are not sent (a guest's came with the host's map, whose members have them as the host's own). Held
	 * messages after that are applied.
	 */
	bind(map: PathApplyMap, afterSeq: number) {
		const held = this.held
		this.map = map
		this.mirror = liveOf(map.own)
		this.pending = []
		this.held = []
		this.holding = false
		this.after = afterSeq
		for (const m of held) if (m.seq > afterSeq) this.applyData(m.from, m.data)
	}

	/** Stops syncing (the session ended or its map was closed). The others' applies noted stay with the map. */
	unbind() {
		this.map = null
		this.mirror = new Map()
		this.pending = []
		this.held = []
		this.holding = false
		this.after = 0
	}

	/** Sends the paths whose live apply of mine changed since the last flush, if any. Runs on the heights' timer and before a remote message is applied. */
	flush() {
		const map = this.map
		if (!map) return
		const now = liveOf(map.own)
		const on: number[] = []
		const off: number[] = []
		for (const [id, a] of now) if (this.mirror.get(id) !== a) on.push(id)
		for (const id of this.mirror.keys()) if (!now.has(id)) off.push(id)
		if (!on.length && !off.length) return
		this.mirror = now
		// My apply is the path's latest as far as I know: another member's noted before it is under it now.
		for (const id of on) map.others.delete(id)
		const id = this.nextId++
		this.pending.push({ id, on })
		this.hooks.send({ id, on, off }).catch((err) => {
			this.pending = this.pending.filter((p) => p.id !== id)
			this.hooks.failed?.(err)
		})
	}

	/** A `pathapply` message from the session, `you` this member's id. */
	receive(seq: number, from: number, data: unknown, you: number) {
		if (from === you) {
			const id = (data as PathApplyData | null)?.id
			const i = this.pending.findIndex((p) => p.id === id)
			if (i >= 0) this.pending.splice(i, 1)
			return
		}
		if (!this.map) {
			if (this.holding) this.held.push({ seq, from, data })
			return
		}
		if (seq <= this.after) return
		this.applyData(from, data)
	}

	private applyData(from: number, data: unknown) {
		const map = this.map
		const d = data as PathApplyData | null
		if (!map || !d) return
		this.flush()
		const mine = new Set<number>()
		for (const p of this.pending) for (const id of p.on) mine.add(id)
		const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [])
		for (const id of ids(d.off)) if (map.others.get(id)?.by === from) map.others.delete(id)
		for (const id of ids(d.on)) {
			// Mine, still unacknowledged, comes after theirs in the host's order.
			if (mine.has(id)) continue
			map.others.set(id, { by: from, name: this.hooks.nameOf(from) })
			// Their apply was laid over mine: my record no longer says what the map held before the path.
			const own = map.own.get(id)
			if (own?.live) own.live = false
			this.mirror.delete(id)
		}
	}
}

/** The applies in `own` that are in the map now. */
function liveOf(own: Map<number, PathApply>): Map<number, PathApply> {
	const out = new Map<number, PathApply>()
	for (const [id, a] of own) if (a.live) out.set(id, a)
	return out
}

/** One note of another member's apply in a map handoff (#1023): the path id and the member who applied it. */
export interface ApplyNote {
	id: number
	by: number
}

/** The notes of `others` to send a joining member with the map, or undefined when there are none. */
export function notesOf(others: Map<number, OthersApply>): ApplyNote[] | undefined {
	if (!others.size) return undefined
	const out: ApplyNote[] = []
	for (const [id, o] of others) out.push({ id, by: o.by })
	return out
}

/**
 * Notes the host's `notes` in a joining member's `map`: the host's notes of the paths another member
 * applied last. The member's own id (`you`) and paths it holds a live apply of (the host's own, which came
 * with the map) are left out; a malformed entry is ignored.
 */
export function adoptNotes(map: PathApplyMap, notes: unknown, you: number, nameOf: (id: number) => string) {
	if (!Array.isArray(notes)) return
	for (const n of notes as Array<Partial<ApplyNote> | null>) {
		if (!n || !Number.isInteger(n.id) || !Number.isInteger(n.by) || n.by === you) continue
		const id = n.id as number
		const by = n.by as number
		if (map.own.get(id)?.live) continue
		map.others.set(id, { by, name: nameOf(by) })
	}
}
