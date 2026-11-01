// The baked shadows in a shared session (#1018, docs/architecture/session.md): every change to the session
// map's baked shadows (Bake Shadows, the Map data tool's Shadow mode, Clear Shadows, a paste, an undo)
// goes out as the shadow bits of the texels it changed, and every member applies the others' in the
// host's order. Baking reads the models and is slow, so only the member who bakes runs it; the others
// take the bits.
//
// The holes' sync (holes.ts) with a shadow texel the unit and two differences:
// - The texels go as bits (in shadow from 128, as the map file and the export keep them), and the mirror
//   keeps them as bits too: a byte a texel would be 64 MB for an 8x8 tile map.
// - A map may have no shadows of its own (`shadow` null). A member whose layer goes away (an undo of the
//   first stroke on such a map) sends `none`, and a member without a layer makes one (all lit) before
//   writing another's texels. A layer that appears with nothing touched is the client's, read for a
//   region the map has none of its own for (`Engine.updateBakedShadows`): each member reads its own, so
//   it is taken into the mirror and not sent.
// Kept free of the bindings so a Bun test can run two members against a scripted host.
import { base64ToBytes, bytesToBase64 } from '../io/base64'
import { packShadowBits } from '../terrain/bakedShadows'
import type { VertexRect } from './heights'

/** The kind of a message carrying baked shadows (data: `ShadowsData`). */
export const KIND_SHADOWS = 'shadows'

/** An inclusive rect of shadow texels. */
export type TexelRect = VertexRect

/**
 * A `shadows` message's data: the sender's own count `id`, and either an inclusive texel `rect` with its
 * bits `b` (base64; a bit a texel, row by row, bit n of a byte the nth texel from it), or `none`: the map
 * has no shadows of its own any more.
 */
export interface ShadowsData {
	id: number
	rect?: TexelRect
	b?: string
	none?: true
}

/** What the sync needs of a `Terrain`. */
export interface ShadowGround {
	/** A byte a texel (255 in shadow), `shadowSide` a side; null while the map has none of its own. */
	readonly shadow: Uint8Array | null
	readonly shadowSide: number
	/** The layer to write into, made all lit first when there is none. */
	ensureShadow(): Uint8Array
	setShadow(bytes: Uint8Array | null): void
	touchShadow(r: TexelRect): void
	takeSessionShadow(out: TexelRect): boolean
}

export interface ShadowSyncHooks {
	/** Sends one message to everyone; resolves once the host has it. */
	send(data: ShadowsData): Promise<unknown>
	/** After another member's shadows were written in. */
	applied?(): void
	/** A send failed: the others never got those shadows. */
	failed?(err: unknown): void
}

/** A sent message not yet acknowledged: its rect and texel bytes, or none. */
interface Pending {
	id: number
	rect: TexelRect | null
	b: Uint8Array | null
}

interface Held {
	seq: number
	data: unknown
}

/** One member's baked shadows sync for the session's map. */
export class ShadowSync {
	private ground: ShadowGround | null = null
	/** The layer the mirror was last compared with: another one means all of it may have changed. */
	private layer: Uint8Array | null = null
	/** The shadows as this member last sent or received them, a bit a texel; null for none. */
	private mirror: Uint8Array | null = null
	/** My sent messages the host has not sent back yet, oldest first. */
	private pending: Pending[] = []
	/** Messages held while waiting for the map (a guest before its handoff opens). */
	private held: Held[] = []
	private holding = false
	/** Messages at or before this `seq` are already in the map bound (the handoff's). */
	private after = 0
	private nextId = 1
	private readonly scratch: TexelRect = { x0: 0, z0: 0, x1: 0, z1: 0 }

	constructor(private readonly hooks: ShadowSyncHooks) {}

	get bound(): ShadowGround | null {
		return this.ground
	}

	/** The sent messages not yet acknowledged (for the tests). */
	get unacknowledged(): number {
		return this.pending.length
	}

	/** Holds the shadows messages that arrive until `bind`, as a guest does until the host's map opens. */
	wait() {
		this.unbind()
		this.holding = true
	}

	/** Syncs `ground` from now on, as it stands: the map as it was after message `afterSeq`. Held messages after that are applied. */
	bind(ground: ShadowGround, afterSeq: number) {
		const held = this.held
		this.ground = ground
		this.layer = ground.shadow
		this.mirror = ground.shadow ? packShadowBits(ground.shadow) : null
		this.pending = []
		this.held = []
		this.holding = false
		this.after = afterSeq
		ground.takeSessionShadow(this.scratch)
		for (const m of held) if (m.seq > afterSeq) this.applyData(m.data)
	}

	/** Stops syncing (the session ended or its map was closed). */
	unbind() {
		this.ground = null
		this.layer = null
		this.mirror = null
		this.pending = []
		this.held = []
		this.holding = false
		this.after = 0
	}

	/** Sends the shadows changed since the last flush, if any. Runs on the heights' timer and before a remote message is applied. */
	flush() {
		const g = this.ground
		if (!g) return
		const r = this.scratch
		let touched = g.takeSessionShadow(r)
		const layer = g.shadow
		const side = g.shadowSide
		if (!layer) {
			this.layer = null
			if (!this.mirror) return
			this.mirror = null
			this.post(null, null)
			return
		}
		if (!this.mirror) {
			this.layer = layer
			// The client's shadows, which each member reads for itself, or a layer made to be written into.
			if (!touched) {
				this.mirror = packShadowBits(layer)
				return
			}
			this.mirror = new Uint8Array(Math.ceil((side * side) / 8))
		}
		if (layer !== this.layer) {
			this.layer = layer
			touched = true
			r.x0 = r.z0 = 0
			r.x1 = r.z1 = side - 1
		}
		if (!touched) return
		const mirror = this.mirror
		const x0 = Math.max(0, r.x0)
		const z0 = Math.max(0, r.z0)
		const x1 = Math.min(side - 1, r.x1)
		const z1 = Math.min(side - 1, r.z1)
		// Shrink to the texels that differ from what the session last had.
		let ax = Infinity
		let az = Infinity
		let bx = -Infinity
		let bz = -Infinity
		for (let z = z0; z <= z1; z++) {
			for (let x = x0; x <= x1; x++) {
				const i = z * side + x
				if (layer[i] >= 128 === (((mirror[i >> 3] >> (i & 7)) & 1) === 1)) continue
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
		for (let z = az; z <= bz; z++) bytes.set(layer.subarray(z * side + ax, z * side + bx + 1), (z - az) * w)
		keepBits(mirror, layer, side, rect)
		this.post(rect, bytes)
	}

	private post(rect: TexelRect | null, bytes: Uint8Array | null) {
		const id = this.nextId++
		this.pending.push({ id, rect, b: bytes })
		const data: ShadowsData = rect && bytes ? { id, rect, b: bytesToBase64(packShadowBits(bytes)) } : { id, none: true }
		this.hooks.send(data).catch((err) => {
			this.pending = this.pending.filter((p) => p.id !== id)
			this.hooks.failed?.(err)
		})
	}

	/** A `shadows` message from the session, `you` this member's id. */
	receive(seq: number, from: number, data: unknown, you: number) {
		if (from === you) {
			const id = (data as ShadowsData | null)?.id
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

	/** Writes another member's shadows in, then mine still unacknowledged over them. False for a message that doesn't fit the map. */
	private applyData(data: unknown): boolean {
		const g = this.ground
		const d = data as ShadowsData | null
		if (!g || !d || typeof d !== 'object') return false
		const side = g.shadowSide
		let rect: TexelRect | null = null
		let bytes: Uint8Array | null = null
		if (d.none !== true) {
			const r = d.rect
			if (!r || typeof d.b !== 'string') return false
			const { x0, z0, x1, z1 } = r
			if (![x0, z0, x1, z1].every((v) => Number.isInteger(v)) || x0 < 0 || z0 < 0 || x1 >= side || z1 >= side || x0 > x1 || z0 > z1) return false
			let bits: Uint8Array
			try {
				bits = base64ToBytes(d.b)
			} catch {
				return false
			}
			const n = (x1 - x0 + 1) * (z1 - z0 + 1)
			if (bits.length !== Math.ceil(n / 8)) return false
			rect = { x0, z0, x1, z1 }
			bytes = unpackBits(bits, n)
		}
		// My edits not sent yet are pending from here on, so they are written back over this one too.
		this.flush()
		// A none of mine still unacknowledged comes after this one in the host's order and wipes it: what
		// this member shows (none, and my strokes since) is already what that order ends with.
		if (this.pending.some((p) => !p.rect)) return true
		if (!rect || !bytes) {
			if (!this.pending.length) {
				g.setShadow(null)
				this.layer = null
				this.mirror = null
			} else {
				// No shadows of their own, then my strokes since: all lit but those.
				const layer = g.ensureShadow()
				layer.fill(0)
				for (const p of this.pending) writeOverlap(layer, side, p.rect!, p.b!, p.rect!)
				this.layer = layer
				this.mirror = packShadowBits(layer)
				g.touchShadow({ x0: 0, z0: 0, x1: side - 1, z1: side - 1 })
			}
		} else {
			const layer = g.ensureShadow()
			if (!this.mirror || layer !== this.layer) this.mirror = packShadowBits(layer)
			this.layer = layer
			writeOverlap(layer, side, rect, bytes, rect)
			for (const p of this.pending) writeOverlap(layer, side, p.rect!, p.b!, rect)
			keepBits(this.mirror, layer, side, rect)
			g.touchShadow(rect)
		}
		// Not an edit of mine: the flush above took every earlier touch, so this one is the apply's alone.
		g.takeSessionShadow(this.scratch)
		this.hooks.applied?.()
		return true
	}
}

/** `n` texels from their bits (bit n of a byte the nth texel from it): 255 in shadow, 0 lit. */
function unpackBits(bits: Uint8Array, n: number): Uint8Array {
	const out = new Uint8Array(n)
	for (let i = 0; i < n; i++) if ((bits[i >> 3] >> (i & 7)) & 1) out[i] = 255
	return out
}

/** Sets the mirror's bits over rect `r` from the layer (`side` texels a row). */
function keepBits(mirror: Uint8Array, layer: Uint8Array, side: number, r: TexelRect) {
	for (let z = r.z0; z <= r.z1; z++) {
		for (let x = r.x0; x <= r.x1; x++) {
			const i = z * side + x
			if (layer[i] >= 128) mirror[i >> 3] |= 1 << (i & 7)
			else mirror[i >> 3] &= ~(1 << (i & 7))
		}
	}
}

/** Writes the part of `src` (the texels of rect `sr`) that falls inside `clip` into the layer `a`, `side` a row. */
function writeOverlap(a: Uint8Array, side: number, sr: TexelRect, src: Uint8Array, clip: TexelRect) {
	const x0 = Math.max(sr.x0, clip.x0)
	const x1 = Math.min(sr.x1, clip.x1)
	const z0 = Math.max(sr.z0, clip.z0)
	const z1 = Math.min(sr.z1, clip.z1)
	if (x0 > x1 || z0 > z1) return
	const w = sr.x1 - sr.x0 + 1
	for (let z = z0; z <= z1; z++) {
		const from = (z - sr.z0) * w + (x0 - sr.x0)
		a.set(src.subarray(from, from + x1 - x0 + 1), z * side + x0)
	}
}
