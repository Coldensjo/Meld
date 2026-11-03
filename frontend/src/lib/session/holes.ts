// Holes in a shared session (#1016): every hole cut or filled in the
// session's map (the hole brush, Hole walls, the Clear tool, a paste, a script, an undo) goes out as the
// hole bytes of the cells it touched, and every member applies the others' in the host's order.
//
// The heights' sync (heights.ts) with a cell the unit instead of a vertex: state, not commands; the
// changed rect comes from the one `Terrain.touchHoles` grows (`takeSessionHoles`), compared against
// `mirror`, the holes as this member last sent or received them, so a touch that changed nothing sends
// nothing. One's own come back as the acknowledgement; another member's arriving while some of mine are
// unacknowledged is ordered before them, so mine are written back over it.
// Kept free of the bindings so a Bun test can run two members against a scripted host.
import { base64ToBytes, bytesToBase64 } from '../io/base64'
import type { VertexRect } from './heights'

/** The kind of a message carrying holes (data: `HolesData`). */
export const KIND_HOLES = 'holes'

/** An inclusive rect of the cell grid. */
export type CellRect = VertexRect

/** A `holes` message's data: the sender's own count `id`, the inclusive cell `rect`, and its hole bytes `b` (base64, row by row). */
export interface HolesData {
	id: number
	rect: CellRect
	b: string
}

/** What the sync needs of a `Terrain`. */
export interface HoleGround {
	readonly holes: Uint8Array
	/** Cells a side. */
	readonly size: number
	touchHoles(r: CellRect): void
	markDirty(x0: number, z0: number, x1: number, z1: number): void
	takeSessionHoles(out: CellRect): boolean
}

export interface HoleSyncHooks {
	/** Sends one message to everyone; resolves once the host has it. */
	send(data: HolesData): Promise<unknown>
	/** After another member's holes were written in. */
	applied?(rect: CellRect): void
	/** A send failed: the others never got those holes. */
	failed?(err: unknown): void
}

interface Pending {
	id: number
	rect: CellRect
	b: Uint8Array
}

interface Held {
	seq: number
	data: unknown
}

/** One member's holes sync for the session's map. */
export class HoleSync {
	private ground: HoleGround | null = null
	/** The holes as this member last sent or received them, the size of `ground.holes`. */
	private mirror: Uint8Array | null = null
	/** My sent messages the host has not sent back yet, oldest first, with their bytes. */
	private pending: Pending[] = []
	/** Messages held while waiting for the map (a guest before its handoff opens). */
	private held: Held[] = []
	private holding = false
	/** Messages at or before this `seq` are already in the map bound (the handoff's). */
	private after = 0
	private nextId = 1
	private readonly scratch: CellRect = { x0: 0, z0: 0, x1: 0, z1: 0 }

	constructor(private readonly hooks: HoleSyncHooks) {}

	get bound(): HoleGround | null {
		return this.ground
	}

	/** The sent messages not yet acknowledged (for the tests). */
	get unacknowledged(): number {
		return this.pending.length
	}

	/** Holds the holes messages that arrive until `bind`, as a guest does until the host's map opens. */
	wait() {
		this.unbind()
		this.holding = true
	}

	/** Syncs `ground` from now on, as it stands: the map as it was after message `afterSeq`. Held messages after that are applied. */
	bind(ground: HoleGround, afterSeq: number) {
		const held = this.held
		this.ground = ground
		this.mirror = ground.holes.slice()
		this.pending = []
		this.held = []
		this.holding = false
		this.after = afterSeq
		ground.takeSessionHoles(this.scratch)
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

	/** Sends the holes changed since the last flush, if any. Runs on the heights' timer and before a remote message is applied. */
	flush() {
		const g = this.ground
		const mirror = this.mirror
		if (!g || !mirror || !g.takeSessionHoles(this.scratch)) return
		const S = g.size
		const r = this.scratch
		const x0 = Math.max(0, r.x0)
		const z0 = Math.max(0, r.z0)
		const x1 = Math.min(S - 1, r.x1)
		const z1 = Math.min(S - 1, r.z1)
		const holes = g.holes
		// Shrink to the cells that differ from what the session last had.
		let ax = Infinity
		let az = Infinity
		let bx = -Infinity
		let bz = -Infinity
		for (let z = z0; z <= z1; z++) {
			const row = z * S
			for (let x = x0; x <= x1; x++) {
				if (holes[row + x] === mirror[row + x]) continue
				if (x < ax) ax = x
				if (x > bx) bx = x
				if (z < az) az = z
				bz = z
			}
		}
		if (ax > bx) return
		const rect = { x0: ax, z0: az, x1: bx, z1: bz }
		const w = bx - ax + 1
		const bytes = new Uint8Array(w * (bz - az + 1))
		for (let z = az; z <= bz; z++) {
			const from = z * S + ax
			bytes.set(holes.subarray(from, from + w), (z - az) * w)
			mirror.set(holes.subarray(from, from + w), from)
		}
		const id = this.nextId++
		this.pending.push({ id, rect, b: bytes })
		this.hooks.send({ id, rect, b: bytesToBase64(bytes) }).catch((err) => {
			this.pending = this.pending.filter((p) => p.id !== id)
			this.hooks.failed?.(err)
		})
	}

	/** A `holes` message from the session, `you` this member's id. */
	receive(seq: number, from: number, data: unknown, you: number) {
		if (from === you) {
			const id = (data as HolesData | null)?.id
			const i = this.pending.findIndex((p) => p.id === id)
			if (i >= 0) this.pending.splice(i, 1)
			return
		}
		if (!this.ground) {
			if (this.holding) this.held.push({ seq, data })
			return
		}
		if (seq <= this.after) return
		this.applyData(data)
	}

	/** Writes another member's holes in, then mine still unacknowledged over them. False for a message that doesn't fit the map. */
	private applyData(data: unknown): boolean {
		const g = this.ground
		const d = data as HolesData | null
		const r = d?.rect
		if (!g || !r || typeof d.b !== 'string') return false
		const S = g.size
		const { x0, z0, x1, z1 } = r
		if (![x0, z0, x1, z1].every((v) => Number.isInteger(v)) || x0 < 0 || z0 < 0 || x1 >= S || z1 >= S || x0 > x1 || z0 > z1) return false
		let bytes: Uint8Array
		try {
			bytes = base64ToBytes(d.b)
		} catch {
			return false
		}
		const w = x1 - x0 + 1
		if (bytes.length !== w * (z1 - z0 + 1)) return false
		// My edits not sent yet are pending from here on, so they are written back over this one too.
		this.flush()
		const holes = g.holes
		for (let z = z0; z <= z1; z++) holes.set(bytes.subarray((z - z0) * w, (z - z0 + 1) * w), z * S + x0)
		for (const p of this.pending) writeOverlap(holes, S, p.rect, p.b, r)
		const mirror = this.mirror!
		for (let z = z0; z <= z1; z++) mirror.set(holes.subarray(z * S + x0, z * S + x1 + 1), z * S + x0)
		const rect = { x0, z0, x1, z1 }
		g.touchHoles(rect)
		// The chunk rebuild runs off vertices; a cell's far corner is one past it (as TerrainStroke's undo does).
		g.markDirty(x0, z0, x1 + 1, z1 + 1)
		// Not an edit of mine: the flush above took every earlier touch, so this one is the apply's alone.
		g.takeSessionHoles(this.scratch)
		this.hooks.applied?.(rect)
		return true
	}
}

/** Writes the part of `src` (the bytes of rect `sr`) that falls inside `clip` into the grid `a`, `S` a row. */
function writeOverlap(a: Uint8Array, S: number, sr: CellRect, src: Uint8Array, clip: CellRect) {
	const x0 = Math.max(sr.x0, clip.x0)
	const x1 = Math.min(sr.x1, clip.x1)
	const z0 = Math.max(sr.z0, clip.z0)
	const z1 = Math.min(sr.z1, clip.z1)
	if (x0 > x1 || z0 > z1) return
	const w = sr.x1 - sr.x0 + 1
	for (let z = z0; z <= z1; z++) {
		const from = (z - sr.z0) * w + (x0 - sr.x0)
		a.set(src.subarray(from, from + x1 - x0 + 1), z * S + x0)
	}
}
