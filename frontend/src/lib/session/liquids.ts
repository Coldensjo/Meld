// Painted liquids in a shared session (#1017, docs/architecture/session.md): every liquid change to the
// session's map (the water brush, Crop water, Import watermap, Regenerate opacity, the Clear tool, a
// paste, a script, an undo) goes out as the changed chunks' layers whole, and every member applies the
// others' in the host's order.
//
// The paint sync's rule (paint.ts) with a liquid chunk (an MCNK's 8x8 cells) the unit: the chunks come
// from the set `LiquidMap.touch` grows (`takeSessionLiquids`), compared against `mirror`, the layers as
// this member last sent or received them, so a touch that changed nothing sends nothing. Two members
// changing one chunk at once both end with the later message's chunk; one's own unacknowledged chunks are
// written back over another's that the host ordered before them. A chunk's layers go out in the map
// file's record layout (liquids.ts `writeLiquidRecord`: depth as a byte), so every member's save holds the
// same bytes. A building's liquid ID (#540) goes with its kind, for a member whose client lacks the row.
// Kept free of the bindings so a Bun test can run two members against a scripted host.
import { base64ToBytes, bytesToBase64 } from '../io/base64'
import { LIQUID_SLIME, cloneLayer, knownLiquidKind, learnLiquidKinds, readLiquidRecord, writeLiquidRecord, type LiquidClass, type LiquidLayer } from '../water/liquids'
import { sameLayers } from '../water/liquidStroke'
import { LIQUID_RECORD_BYTES } from '../wow/format'

/** The kind of a message carrying liquids (data: `LiquidsData`). */
export const KIND_LIQUIDS = 'liquids'

/** One liquid chunk on the wire: its index and its layers as map file records (base64; empty for a chunk with none). */
export interface LiquidChunk {
	c: number
	layers: string
}

/** A `liquids` message's data: the sender's own count `id`, the chunks it changed, and the kinds of the liquid IDs past the base four they use. */
export interface LiquidsData {
	id: number
	chunks: LiquidChunk[]
	kinds?: Record<number, LiquidClass>
}

/** What the sync needs of a `LiquidMap`. */
export interface LiquidSyncMap {
	/** Chunks a side. */
	readonly side: number
	layers(c: number): readonly LiquidLayer[]
	set(c: number, layers: readonly LiquidLayer[]): void
	takeSessionLiquids(out: number[]): boolean
}

export interface LiquidSyncHooks {
	/** Sends one message to everyone; resolves once the host has it. */
	send(data: LiquidsData): Promise<unknown>
	/** After another member's liquids were written in, with the chunks. */
	applied?(chunks: number[]): void
	/** A send failed: the others never got those liquids. */
	failed?(err: unknown): void
}

interface PendingChunk {
	c: number
	layers: LiquidLayer[]
}

interface Pending {
	id: number
	chunks: PendingChunk[]
}

interface Held {
	seq: number
	data: unknown
}

const NONE: readonly LiquidLayer[] = []

/** One member's liquids sync for the session's map. */
export class LiquidSync {
	private map: LiquidSyncMap | null = null
	/** Each chunk's layers as this member last sent or received them. */
	private mirror: Array<readonly LiquidLayer[] | undefined> = []
	private pending: Pending[] = []
	private held: Held[] = []
	private holding = false
	private after = 0
	private nextId = 1
	private readonly scratch: number[] = []

	constructor(private readonly hooks: LiquidSyncHooks) {}

	get bound(): LiquidSyncMap | null {
		return this.map
	}

	/** The sent messages not yet acknowledged (for the tests). */
	get unacknowledged(): number {
		return this.pending.length
	}

	/** Holds the liquids messages that arrive until `bind`, as a guest does until the host's map opens. */
	wait() {
		this.unbind()
		this.holding = true
	}

	/** Syncs `map` from now on, as it stands: the map as it was after message `afterSeq`. Held messages after that are applied. */
	bind(map: LiquidSyncMap, afterSeq: number) {
		const held = this.held
		this.map = map
		const n = map.side * map.side
		this.mirror = new Array(n)
		for (let c = 0; c < n; c++) {
			const l = map.layers(c)
			if (l.length) this.mirror[c] = l.map(cloneLayer)
		}
		this.pending = []
		this.held = []
		this.holding = false
		this.after = afterSeq
		map.takeSessionLiquids(this.scratch)
		for (const m of held) if (m.seq > afterSeq) this.applyData(m.data)
	}

	/** Stops syncing (the session ended or its map was closed). */
	unbind() {
		this.map = null
		this.mirror = []
		this.pending = []
		this.held = []
		this.holding = false
		this.after = 0
	}

	/** Sends the liquid chunks changed since the last flush, if any. Runs on the session's timer and before a remote message is applied. */
	flush() {
		const m = this.map
		if (!m || !m.takeSessionLiquids(this.scratch)) return
		const n = m.side * m.side
		const chunks: LiquidChunk[] = []
		const mine: PendingChunk[] = []
		let kinds: Record<number, LiquidClass> | undefined
		for (const c of this.scratch) {
			if (c < 0 || c >= n) continue
			const now = m.layers(c)
			if (sameLayers(this.mirror[c] ?? NONE, now)) continue
			const copy = now.map(cloneLayer)
			this.mirror[c] = copy.length ? copy : undefined
			mine.push({ c, layers: copy })
			chunks.push({ c, layers: encodeLayers(c, copy) })
			for (const l of copy) {
				if (l.id <= LIQUID_SLIME || kinds?.[l.id]) continue
				const k = knownLiquidKind(l.id)
				if (k) (kinds ??= {})[l.id] = k
			}
		}
		if (!chunks.length) return
		const id = this.nextId++
		this.pending.push({ id, chunks: mine })
		const data: LiquidsData = { id, chunks }
		if (kinds) data.kinds = kinds
		this.hooks.send(data).catch((err) => {
			this.pending = this.pending.filter((p) => p.id !== id)
			this.hooks.failed?.(err)
		})
	}

	/** A `liquids` message from the session, `you` this member's id. */
	receive(seq: number, from: number, data: unknown, you: number) {
		if (from === you) {
			const id = (data as LiquidsData | null)?.id
			const i = this.pending.findIndex((p) => p.id === id)
			if (i >= 0) this.pending.splice(i, 1)
			return
		}
		if (!this.map) {
			if (this.holding) this.held.push({ seq, data })
			return
		}
		if (seq <= this.after) return
		this.applyData(data)
	}

	/** Writes another member's chunks in, then mine still unacknowledged over them. False for a message that doesn't fit the map. */
	private applyData(data: unknown): boolean {
		const m = this.map
		const d = data as LiquidsData | null
		if (!m || !d || !Array.isArray(d.chunks)) return false
		const n = m.side * m.side
		// Decode and check every chunk before anything is written.
		const chunks: PendingChunk[] = []
		for (const ch of d.chunks) {
			if (!ch || !Number.isInteger(ch.c) || ch.c < 0 || ch.c >= n || typeof ch.layers !== 'string') return false
			const layers = decodeLayers(ch.layers)
			if (!layers) return false
			chunks.push({ c: ch.c, layers })
		}
		if (!chunks.length) return false
		learnLiquidKinds(d.kinds)
		// My edits not sent yet are pending from here on, so they are written back over this one too.
		this.flush()
		const done: number[] = []
		for (const ch of chunks) {
			m.set(ch.c, ch.layers)
			for (const p of this.pending) for (const mc of p.chunks) if (mc.c === ch.c) m.set(mc.c, mc.layers.map(cloneLayer))
			const now = m.layers(ch.c)
			this.mirror[ch.c] = now.length ? now.map(cloneLayer) : undefined
			done.push(ch.c)
		}
		// Not an edit of mine: the flush above took every earlier touch, so these are the apply's alone.
		m.takeSessionLiquids(this.scratch)
		this.hooks.applied?.(done)
		return true
	}
}

/** Chunk c's layers as map file records, base64. */
export function encodeLayers(c: number, layers: readonly LiquidLayer[]): string {
	const out = new Uint8Array(layers.length * LIQUID_RECORD_BYTES)
	const dv = new DataView(out.buffer)
	layers.forEach((l, k) => writeLiquidRecord(dv, k * LIQUID_RECORD_BYTES, c, l))
	return bytesToBase64(out)
}

/** The layers of a chunk's records (`encodeLayers`), or null when they don't read as records. */
export function decodeLayers(b64: string): LiquidLayer[] | null {
	let bytes: Uint8Array
	try {
		bytes = base64ToBytes(b64)
	} catch {
		return null
	}
	if (bytes.length % LIQUID_RECORD_BYTES) return null
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const out: LiquidLayer[] = []
	for (let o = 0; o < bytes.length; o += LIQUID_RECORD_BYTES) {
		const { layer } = readLiquidRecord(dv, o)
		if (layer.id < 1) return null
		out.push(layer)
	}
	return out
}
