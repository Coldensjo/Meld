// Texture paint in a shared session (#1002, docs/architecture/session.md): every paint change to the
// session's map (a stroke, a fill, a script, an undo) goes out as whole paint chunks, a few times a
// second while it lasts, and every member applies the others' in the host's order, as heights do
// (heights.ts, #1001).
//
// Whole chunks, since a texel's weights mean nothing without its chunk's four slots, and a stroke can
// reorder those anywhere in a chunk it touches (settleSlots, compactChunk). A chunk's slots go out as
// texture paths, not palette indices: each member keeps its own palette, and a path the receiver's
// palette lacks is appended to it there. So two members adding different textures at once can't
// collide on an index, no index is ever renumbered (History's paint steps hold raw slot indices), and
// the four-texture limit holds on every member because a chunk arrives whole, as its sender had it.
// The cost: two textures added at once can sit in the two palettes in either order.
//
// The session map's palette only grows while in the session: an undo of Add Texture that would drop
// a texture the chunks still use (another member painted with it since) is put back (`checkPalette`).
// The paint mask is per-user selection state, not map content, and stays local.
// Kept free of the bindings so a Bun test can run two members against a scripted host.
import { base64ToBytes, bytesToBase64 } from '../io/base64'
import { MAX_PALETTE, NO_TEXTURE, SLOTS, chunkTexelRect, paletteIndex } from '../terrain/chunkPaint'
import type { DirtyRect } from '../terrain/dirtyRect'

/** The kind of a message carrying paint (data: `PaintData`). */
export const KIND_PAINT = 'paint'

/** One paint chunk on the wire: its index, its SLOTS texture paths ('' for an empty slot), and every texel's SLOTS weights (base64, row by row). */
export interface PaintChunk {
	c: number
	slots: string[]
	w: string
}

/** A `paint` message's data: the sender's own count `id` and the chunks it changed. */
export interface PaintData {
	id: number
	chunks: PaintChunk[]
}

/** What the sync needs of a `Terrain`. */
export interface PaintGround {
	readonly weights: Uint8Array
	readonly chunkSlots: Uint8Array
	readonly splatRes: number
	readonly paintChunksPerSide: number
	markSplatDirty(rect?: DirtyRect | null): void
	/** The texel rect marked since the last call into `out` and true; null for all of the map; false for nothing. */
	takeSessionPaint(out: DirtyRect): boolean | null
}

export interface PaintSyncHooks {
	/** Sends one message to everyone; resolves once the host has it. */
	send(data: PaintData): Promise<unknown>
	/** The session map's palette now. */
	palette(): readonly string[]
	/** Replaces the session map's palette (a new array: the engine sees a change by identity). */
	setPalette(p: string[]): void
	/** After another member's paint was written in. */
	applied?(): void
	/** A send failed, or a chunk could not be applied (the palette was full). */
	failed?(err: unknown): void
}

interface PendingChunk {
	c: number
	slots: Uint8Array
	w: Uint8Array
}

interface Pending {
	id: number
	chunks: PendingChunk[]
}

interface Held {
	seq: number
	data: unknown
}

/** One member's paint sync for the session's map. */
export class PaintSync {
	private ground: PaintGround | null = null
	/** The weights and slots as this member last sent or received them. */
	private mirrorW: Uint8Array | null = null
	private mirrorS: Uint8Array | null = null
	/** The palette as the sync last saw it (`checkPalette`). */
	private known: readonly string[] = []
	private pending: Pending[] = []
	private held: Held[] = []
	private holding = false
	private after = 0
	private nextId = 1
	private readonly scratch: DirtyRect = { x0: 0, z0: 0, x1: 0, z1: 0 }

	constructor(private readonly hooks: PaintSyncHooks) {}

	get bound(): PaintGround | null {
		return this.ground
	}

	/** The sent messages not yet acknowledged (for the tests). */
	get unacknowledged(): number {
		return this.pending.length
	}

	/** Holds the paint messages that arrive until `bind`, as a guest does until the host's map opens. */
	wait() {
		this.unbind()
		this.holding = true
	}

	/** Syncs `ground` from now on, as it stands: the map as it was after message `afterSeq`. Held messages after that are applied. */
	bind(ground: PaintGround, afterSeq: number) {
		const held = this.held
		this.ground = ground
		this.mirrorW = ground.weights.slice()
		this.mirrorS = ground.chunkSlots.slice()
		this.known = this.hooks.palette()
		this.pending = []
		this.held = []
		this.holding = false
		this.after = afterSeq
		ground.takeSessionPaint(this.scratch)
		for (const m of held) if (m.seq > afterSeq) this.applyData(m.data)
	}

	/** Stops syncing (the session ended or its map was closed). */
	unbind() {
		this.ground = null
		this.mirrorW = null
		this.mirrorS = null
		this.known = []
		this.pending = []
		this.held = []
		this.holding = false
		this.after = 0
	}

	/**
	 * Puts back the textures an undo dropped from the end of the palette while the chunks still use them
	 * (another member painted with one since): the session map's palette only grows. Any other change is
	 * taken as it is.
	 */
	checkPalette() {
		const g = this.ground
		if (!g) return
		const p = this.hooks.palette()
		const known = this.known
		if (p === known) return
		if (p.length < known.length && p.every((x, i) => x === known[i])) {
			const s = g.chunkSlots
			let used = false
			for (let i = 0; i < s.length && !used; i++) used = s[i] !== NO_TEXTURE && s[i] >= p.length
			if (used) {
				const back = [...known]
				this.hooks.setPalette(back)
				this.known = back
				return
			}
		}
		this.known = p
	}

	/** Sends the paint chunks changed since the last flush, if any. Runs on the session's timer and before a remote message is applied. */
	flush() {
		const g = this.ground
		const mw = this.mirrorW
		const ms = this.mirrorS
		if (!g || !mw || !ms) return
		this.checkPalette()
		const r = this.scratch
		const marked = g.takeSessionPaint(r)
		if (marked === false) return
		const side = g.paintChunksPerSide
		const res = g.splatRes
		const per = res / side
		const cx0 = marked ? Math.max(0, Math.floor(r.x0 / per)) : 0
		const cz0 = marked ? Math.max(0, Math.floor(r.z0 / per)) : 0
		const cx1 = marked ? Math.min(side - 1, Math.floor(r.x1 / per)) : side - 1
		const cz1 = marked ? Math.min(side - 1, Math.floor(r.z1 / per)) : side - 1
		const palette = this.hooks.palette()
		const chunks: PaintChunk[] = []
		const mine: PendingChunk[] = []
		for (let cz = cz0; cz <= cz1; cz++) {
			for (let cx = cx0; cx <= cx1; cx++) {
				const c = cz * side + cx
				if (!chunkDiffers(g, mw, ms, c)) continue
				const slots = g.chunkSlots.slice(c * SLOTS, (c + 1) * SLOTS)
				const w = readChunk(g.weights, res, side, c)
				ms.set(slots, c * SLOTS)
				writeChunk(mw, res, side, c, w)
				mine.push({ c, slots, w })
				chunks.push({ c, slots: Array.from(slots, (s) => (s === NO_TEXTURE ? '' : (palette[s] ?? ''))), w: bytesToBase64(w) })
			}
		}
		if (!chunks.length) return
		const id = this.nextId++
		this.pending.push({ id, chunks: mine })
		this.hooks.send({ id, chunks }).catch((err) => {
			this.pending = this.pending.filter((p) => p.id !== id)
			this.hooks.failed?.(err)
		})
	}

	/** A `paint` message from the session, `you` this member's id. */
	receive(seq: number, from: number, data: unknown, you: number) {
		if (from === you) {
			const id = (data as PaintData | null)?.id
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

	/** Writes another member's chunks in, then mine still unacknowledged over them. False for a message that doesn't fit the map. */
	private applyData(data: unknown): boolean {
		const g = this.ground
		const d = data as PaintData | null
		if (!g || !d || !Array.isArray(d.chunks)) return false
		const side = g.paintChunksPerSide
		const res = g.splatRes
		const per = res / side
		const size = per * per * SLOTS
		const n = side * side
		// Decode and check every chunk before anything is written.
		const chunks: Array<{ c: number; paths: string[]; w: Uint8Array }> = []
		for (const ch of d.chunks) {
			if (!ch || !Number.isInteger(ch.c) || ch.c < 0 || ch.c >= n || !Array.isArray(ch.slots) || ch.slots.length !== SLOTS || typeof ch.w !== 'string') return false
			if (!ch.slots.every((s) => typeof s === 'string')) return false
			let w: Uint8Array
			try {
				w = base64ToBytes(ch.w)
			} catch {
				return false
			}
			if (w.length !== size) return false
			chunks.push({ c: ch.c, paths: ch.slots, w })
		}
		if (!chunks.length) return false
		// My edits not sent yet are pending from here on, so they are written back over this one too.
		this.flush()
		const before = this.hooks.palette()
		const palette = [...before]
		const slots = new Uint8Array(SLOTS)
		const rect: DirtyRect = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
		let full = 0
		for (const ch of chunks) {
			let ok = true
			for (let k = 0; k < SLOTS; k++) {
				const path = ch.paths[k]
				if (!path) {
					slots[k] = NO_TEXTURE
					continue
				}
				let i = paletteIndex(palette, path)
				if (i < 0) {
					if (palette.length >= MAX_PALETTE) {
						ok = false
						break
					}
					palette.push(path)
					i = palette.length - 1
				}
				slots[k] = i
			}
			if (!ok) {
				full++
				continue
			}
			g.chunkSlots.set(slots, ch.c * SLOTS)
			writeChunk(g.weights, res, side, ch.c, ch.w)
			for (const p of this.pending) {
				for (const m of p.chunks) {
					if (m.c !== ch.c) continue
					g.chunkSlots.set(m.slots, m.c * SLOTS)
					writeChunk(g.weights, res, side, m.c, m.w)
				}
			}
			this.mirrorS!.set(g.chunkSlots.subarray(ch.c * SLOTS, (ch.c + 1) * SLOTS), ch.c * SLOTS)
			writeChunk(this.mirrorW!, res, side, ch.c, readChunk(g.weights, res, side, ch.c))
			const t = chunkTexelRect(side, res, ch.c)
			rect.x0 = Math.min(rect.x0, t.x0)
			rect.z0 = Math.min(rect.z0, t.z0)
			rect.x1 = Math.max(rect.x1, t.x0 + per - 1)
			rect.z1 = Math.max(rect.z1, t.z0 + per - 1)
		}
		if (palette.length !== before.length) {
			this.hooks.setPalette(palette)
			this.known = palette
		}
		if (full) this.hooks.failed?.(new Error(`this map's texture palette is full (${MAX_PALETTE} textures): ${full} of another member's paint chunks were left out`))
		if (rect.x0 > rect.x1) return false
		g.markSplatDirty(rect)
		// Not an edit of mine: the flush above took every earlier mark, so this one is the apply's alone.
		g.takeSessionPaint(this.scratch)
		this.hooks.applied?.()
		return true
	}
}

/** Whether chunk c's slots or weights differ from the mirror's. */
function chunkDiffers(g: PaintGround, mw: Uint8Array, ms: Uint8Array, c: number): boolean {
	const s = g.chunkSlots
	for (let k = c * SLOTS; k < (c + 1) * SLOTS; k++) if (s[k] !== ms[k]) return true
	const side = g.paintChunksPerSide
	const res = g.splatRes
	const t = chunkTexelRect(side, res, c)
	const w = g.weights
	const len = t.per * SLOTS
	for (let z = t.z0; z < t.z0 + t.per; z++) {
		const from = (z * res + t.x0) * SLOTS
		for (let i = from; i < from + len; i++) if (w[i] !== mw[i]) return true
	}
	return false
}

/** Chunk c's weights, row by row (per * per * SLOTS bytes). */
function readChunk(weights: Uint8Array, res: number, side: number, c: number): Uint8Array {
	const t = chunkTexelRect(side, res, c)
	const len = t.per * SLOTS
	const out = new Uint8Array(len * t.per)
	for (let z = 0; z < t.per; z++) {
		const from = ((t.z0 + z) * res + t.x0) * SLOTS
		out.set(weights.subarray(from, from + len), z * len)
	}
	return out
}

/** Writes chunk c's weights (`readChunk`'s layout) into `weights`. */
function writeChunk(weights: Uint8Array, res: number, side: number, c: number, w: Uint8Array) {
	const t = chunkTexelRect(side, res, c)
	const len = t.per * SLOTS
	for (let z = 0; z < t.per; z++) weights.set(w.subarray(z * len, (z + 1) * len), ((t.z0 + z) * res + t.x0) * SLOTS)
}
