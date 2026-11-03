// Terrain heights in a shared session (#1001): every height change to the
// session's map (a stroke, Flatten, a script, an undo) goes out as the changed heights, a few times a
// second while it lasts, and every member applies the others' in the host's order.
//
// State, not commands: History's commands are closures, so the page sends the heights a rect holds now.
// It finds what changed from the rect `Terrain.markDirty` grows (`takeSessionChange`), compared against
// `mirror`, the heights as this member last sent or received them, so a mark that changed nothing (a
// hole, a reload's markAllDirty) sends nothing, and the sent rect shrinks to the vertices that changed.
//
// The order: a member's own message comes back from the host as its acknowledgement and is not applied
// again. Another member's, arriving while some of mine are unacknowledged, is ordered before them, so it
// is applied and my unacknowledged values are written back over it: every member then shows what the
// host's order ends with. Remote edits never reach the local History, so Undo undoes only one's own.
// Kept free of the bindings so a Bun test can run two members against a scripted host.
import { base64ToFloats, floatsToBase64 } from '../io/base64'

/** The kind of a message carrying heights (data: `HeightsData`). */
export const KIND_HEIGHTS = 'heights'

/** How often the changed heights are sent while they change, in ms (about 10 Hz). */
export const HEIGHTS_FLUSH_MS = 100

/** An inclusive rect of the vertex grid. */
export interface VertexRect {
	x0: number
	z0: number
	x1: number
	z1: number
}

/** A `heights` message's data: the sender's own count `id`, the inclusive vertex `rect`, and its heights `h` (base64 float32s, little-endian, row by row). */
export interface HeightsData {
	id: number
	rect: VertexRect
	h: string
}

/** What the sync needs of a `Terrain`. */
export interface HeightGround {
	readonly heights: Float32Array
	readonly verts: number
	markDirty(x0: number, z0: number, x1: number, z1: number): void
	takeSessionChange(out: VertexRect): boolean
}

export interface HeightSyncHooks {
	/** Sends one message to everyone; resolves once the host has it. */
	send(data: HeightsData): Promise<unknown>
	/** After another member's heights were written in (for the objects standing on them). */
	applied?(rect: VertexRect): void
	/** A send failed: the others never got those heights. */
	failed?(err: unknown): void
}

interface Pending {
	id: number
	rect: VertexRect
	h: Float32Array
}

interface Held {
	seq: number
	from: number
	data: unknown
}

/** One member's heights sync for the session's map. */
export class HeightSync {
	private ground: HeightGround | null = null
	/** The heights as this member last sent or received them, the size of `ground.heights`. */
	private mirror: Float32Array | null = null
	/** My sent messages the host has not sent back yet, oldest first, with their values. */
	private pending: Pending[] = []
	/** Messages held while waiting for the map (a guest before its handoff opens). */
	private held: Held[] = []
	private holding = false
	/** Messages at or before this `seq` are already in the map bound (the handoff's). */
	private after = 0
	private nextId = 1
	private readonly scratch: VertexRect = { x0: 0, z0: 0, x1: 0, z1: 0 }

	constructor(private readonly hooks: HeightSyncHooks) {}

	get bound(): HeightGround | null {
		return this.ground
	}

	/** The sent messages not yet acknowledged (for the tests). */
	get unacknowledged(): number {
		return this.pending.length
	}

	/** Holds the heights messages that arrive until `bind`, as a guest does until the host's map opens. */
	wait() {
		this.unbind()
		this.holding = true
	}

	/**
	 * Syncs `ground` from now on, as it stands (its earlier marks are dropped): the map as it was after
	 * message `afterSeq`. Held messages after that are applied, older ones are already in it.
	 */
	bind(ground: HeightGround, afterSeq: number) {
		const held = this.held
		this.ground = ground
		this.mirror = ground.heights.slice()
		this.pending = []
		this.held = []
		this.holding = false
		this.after = afterSeq
		ground.takeSessionChange(this.scratch)
		for (const m of held) if (m.seq > afterSeq) this.applyData(m.data)
	}

	/** Stops syncing (the session ended or its map was closed). */
	unbind() {
		this.ground = null
		this.mirror = null
		this.pending = []
		this.held = []
		this.holding = false
		this.after = 0
	}

	/** Sends the heights changed since the last flush, if any. Runs every `HEIGHTS_FLUSH_MS` and before a remote message is applied. */
	flush() {
		const g = this.ground
		const mirror = this.mirror
		if (!g || !mirror || !g.takeSessionChange(this.scratch)) return
		const V = g.verts
		const r = this.scratch
		const x0 = Math.max(0, r.x0)
		const z0 = Math.max(0, r.z0)
		const x1 = Math.min(V - 1, r.x1)
		const z1 = Math.min(V - 1, r.z1)
		const h = g.heights
		// Shrink to the vertices that differ from what the session last had.
		let ax = Infinity
		let az = Infinity
		let bx = -Infinity
		let bz = -Infinity
		for (let z = z0; z <= z1; z++) {
			const row = z * V
			for (let x = x0; x <= x1; x++) {
				if (h[row + x] === mirror[row + x]) continue
				if (x < ax) ax = x
				if (x > bx) bx = x
				if (z < az) az = z
				bz = z
			}
		}
		if (ax > bx) return
		const rect = { x0: ax, z0: az, x1: bx, z1: bz }
		const w = bx - ax + 1
		const values = new Float32Array(w * (bz - az + 1))
		for (let z = az; z <= bz; z++) {
			const from = z * V + ax
			values.set(h.subarray(from, from + w), (z - az) * w)
			mirror.set(h.subarray(from, from + w), from)
		}
		const id = this.nextId++
		this.pending.push({ id, rect, h: values })
		this.hooks.send({ id, rect, h: floatsToBase64(values) }).catch((err) => {
			this.pending = this.pending.filter((p) => p.id !== id)
			this.hooks.failed?.(err)
		})
	}

	/** A `heights` message from the session, `you` this member's id. */
	receive(seq: number, from: number, data: unknown, you: number) {
		if (from === you) {
			const id = (data as HeightsData | null)?.id
			const i = this.pending.findIndex((p) => p.id === id)
			if (i >= 0) this.pending.splice(i, 1)
			return
		}
		if (!this.ground) {
			if (this.holding) this.held.push({ seq, from, data })
			return
		}
		if (seq <= this.after) return
		this.applyData(data)
	}

	/** Writes another member's heights in, then mine still unacknowledged over them. False for a message that doesn't fit the map. */
	private applyData(data: unknown): boolean {
		const g = this.ground
		const d = data as HeightsData | null
		const r = d?.rect
		if (!g || !r || typeof d.h !== 'string') return false
		const V = g.verts
		const { x0, z0, x1, z1 } = r
		if (![x0, z0, x1, z1].every((v) => Number.isInteger(v)) || x0 < 0 || z0 < 0 || x1 >= V || z1 >= V || x0 > x1 || z0 > z1) return false
		let values: Float32Array
		try {
			values = base64ToFloats(d.h)
		} catch {
			return false
		}
		const w = x1 - x0 + 1
		if (values.length !== w * (z1 - z0 + 1)) return false
		// My edits not sent yet are pending from here on, so they are written back over this one too.
		this.flush()
		const h = g.heights
		for (let z = z0; z <= z1; z++) h.set(values.subarray((z - z0) * w, (z - z0 + 1) * w), z * V + x0)
		for (const p of this.pending) writeOverlap(h, V, p.rect, p.h, r)
		const mirror = this.mirror!
		for (let z = z0; z <= z1; z++) mirror.set(h.subarray(z * V + x0, z * V + x1 + 1), z * V + x0)
		g.markDirty(x0, z0, x1, z1)
		// Not an edit of mine: the flush above took every earlier mark, so this one is the apply's alone.
		g.takeSessionChange(this.scratch)
		this.hooks.applied?.(r)
		return true
	}
}

/** Writes the part of `src` (the heights of rect `sr`) that falls inside `clip` into the grid `h`, `V` a row. */
function writeOverlap(h: Float32Array, V: number, sr: VertexRect, src: Float32Array, clip: VertexRect) {
	const x0 = Math.max(sr.x0, clip.x0)
	const x1 = Math.min(sr.x1, clip.x1)
	const z0 = Math.max(sr.z0, clip.z0)
	const z1 = Math.min(sr.z1, clip.z1)
	if (x0 > x1 || z0 > z1) return
	const w = sr.x1 - sr.x0 + 1
	for (let z = z0; z <= z1; z++) {
		const from = (z - sr.z0) * w + (x0 - sr.x0)
		h.set(src.subarray(from, from + x1 - x0 + 1), z * V + x0)
	}
}
