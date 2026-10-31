// Run with: bun test tests/sessionPaint.test.ts
// Texture paint in a shared session (lib/session/paint.ts, #1002): members paint through a scripted host
// that numbers every message and delivers it to everyone, the sender too, when the test says. The
// palettes are each member's own, so the paint is compared by texture path: every member must end with
// the paint the host's order gives, whatever index each palette gave a texture.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { KIND_PAINT, PaintSync, type PaintData, type PaintGround } from '../src/lib/session/paint.ts'
import { NO_TEXTURE, SLOTS } from '../src/lib/terrain/chunkPaint.ts'
import { DirtyRegion, type DirtyRect } from '../src/lib/terrain/dirtyRect.ts'
import { bytesToBase64 } from '../src/lib/io/base64.ts'

const SIDE = 2
const PER = 4
const RES = SIDE * PER

/** A stand-in for Terrain: the weights, the chunk slots, the palette, and the session's mark that `markSplatDirty` grows. */
class Ground implements PaintGround {
	readonly splatRes = RES
	readonly paintChunksPerSide = SIDE
	readonly weights = new Uint8Array(RES * RES * SLOTS)
	readonly chunkSlots = new Uint8Array(SIDE * SIDE * SLOTS).fill(NO_TEXTURE)
	palette: string[] = ['base']
	marks = 0
	private session = new DirtyRegion()
	constructor() {
		for (let i = 0; i < this.weights.length; i += SLOTS) this.weights[i] = 255
		for (let c = 0; c < SIDE * SIDE; c++) this.chunkSlots[c * SLOTS] = 0
	}
	markSplatDirty(rect?: DirtyRect | null) {
		this.marks++
		this.session.mark(rect)
	}
	takeSessionPaint(out: DirtyRect) {
		if (!this.session.dirty) return false
		const r = this.session.rect
		this.session.clear()
		if (!r) return null
		Object.assign(out, r)
		return true
	}
	/** Adds `path` to the palette as useTexture does; its index. */
	use(path: string) {
		const i = this.palette.indexOf(path)
		if (i >= 0) return i
		this.palette = [...this.palette, path]
		return this.palette.length - 1
	}
	/** Paints chunk c's slot `slot` with `path` at full weight in texel column x of the chunk, as a stroke would. */
	paint(c: number, slot: number, path: string, x: number) {
		this.chunkSlots[c * SLOTS + slot] = this.use(path)
		const x0 = (c % SIDE) * PER
		const z0 = Math.floor(c / SIDE) * PER
		for (let z = z0; z < z0 + PER; z++) {
			const o = (z * RES + x0 + x) * SLOTS
			for (let k = 0; k < SLOTS; k++) this.weights[o + k] = k === slot ? 255 : 0
		}
		this.markSplatDirty({ x0: x0 + x, z0, x1: x0 + x, z1: z0 + PER - 1 })
	}
	/** Every texel's weights by texture path, for comparing members whose palettes differ. */
	byPath(): string {
		const out: string[] = []
		for (let z = 0; z < RES; z++) {
			for (let x = 0; x < RES; x++) {
				const c = Math.floor(z / PER) * SIDE + Math.floor(x / PER)
				const o = (z * RES + x) * SLOTS
				const t: string[] = []
				for (let k = 0; k < SLOTS; k++) {
					const s = this.chunkSlots[c * SLOTS + k]
					if (this.weights[o + k]) t.push(`${s === NO_TEXTURE ? '?' : this.palette[s]}=${this.weights[o + k]}`)
				}
				out.push(t.sort().join(','))
			}
		}
		return out.join(' ')
	}
	/** How many different textures each chunk holds, at most SLOTS by construction. */
	slotsOf(c: number) {
		return Array.from(this.chunkSlots.subarray(c * SLOTS, (c + 1) * SLOTS), (s) => (s === NO_TEXTURE ? '' : this.palette[s]))
	}
}

interface Msg {
	seq: number
	from: number
	kind: string
	data: PaintData
}

class Host {
	seq = 0
	log: Msg[] = []
	inbox = new Map<number, Msg[]>()
	member(id: number, ground: Ground) {
		this.inbox.set(id, [])
		const sync = new PaintSync({
			send: async (data) => {
				const m = { seq: ++this.seq, from: id, kind: KIND_PAINT, data: JSON.parse(JSON.stringify(data)) as PaintData }
				this.log.push(m)
				for (const q of this.inbox.values()) q.push(m)
			},
			palette: () => ground.palette,
			setPalette: (p) => (ground.palette = p),
		})
		sync.bind(ground, 0)
		return { id, ground, sync }
	}
	deliver(m: { id: number; sync: PaintSync }, n = Infinity) {
		const q = this.inbox.get(m.id)!
		for (const msg of q.splice(0, n)) m.sync.receive(msg.seq, msg.from, msg.data, m.id)
	}
}

/** The paint the host's order ends with, from the start map, by path. */
function hostOrder(log: Msg[]) {
	const g = new Ground()
	const s = new PaintSync({ send: async () => undefined, palette: () => g.palette, setPalette: (p) => (g.palette = p) })
	s.bind(g, 0)
	for (const m of log) s.receive(m.seq, m.from, m.data, 99)
	return g.byPath()
}

test('two members adding different new textures at once each end with both, in the same paint', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	// Both add a texture of their own at index 1 and paint it, A in chunk 0 and B in chunk 1.
	a.ground.paint(0, 1, 'grass', 0)
	b.ground.paint(1, 1, 'rock', 2)
	assert.equal(a.ground.palette[1], 'grass')
	assert.equal(b.ground.palette[1], 'rock')
	a.sync.flush()
	b.sync.flush()
	host.deliver(a)
	host.deliver(b)
	assert.deepEqual(a.ground.palette, ['base', 'grass', 'rock'])
	assert.deepEqual(b.ground.palette, ['base', 'rock', 'grass'])
	assert.equal(a.ground.byPath(), b.ground.byPath())
	assert.equal(a.ground.byPath(), hostOrder(host.log))
	assert.deepEqual(b.ground.slotsOf(0), ['base', 'grass', '', ''])
})

test('two members painting new textures into one chunk at once end with the later chunk on both', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	// The same chunk, a texture each into slot 1 and slot 2 (with the base, three of four).
	a.ground.paint(0, 1, 'grass', 0)
	b.ground.paint(0, 2, 'rock', 3)
	b.sync.flush()
	a.sync.flush()
	assert.equal(a.sync.unacknowledged, 1)
	// B's comes first in the host's order and reaches A while A's is unacknowledged: A's chunk stays.
	host.deliver(a, 1)
	assert.deepEqual(a.ground.slotsOf(0), ['base', 'grass', '', ''])
	host.deliver(a)
	host.deliver(b)
	assert.equal(a.ground.byPath(), b.ground.byPath())
	assert.equal(a.ground.byPath(), hostOrder(host.log))
	for (const g of [a.ground, b.ground]) assert.ok(g.slotsOf(0).filter(Boolean).length <= SLOTS)
	assert.ok(b.ground.palette.includes('rock'), "B's palette keeps the texture it added")
})

test('both members painting over each other many times end the same', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	const tex = ['grass', 'rock', 'dirt', 'sand', 'snow']
	for (let i = 0; i < 8; i++) {
		a.ground.paint(i % 4, 1 + (i % 3), tex[i % 5], i % PER)
		b.ground.paint((i + 1) % 4, 1 + ((i + 1) % 3), tex[(i + 2) % 5], (i + 1) % PER)
		a.sync.flush()
		b.sync.flush()
		host.deliver(a, 1)
		host.deliver(b, 3)
	}
	host.deliver(a)
	host.deliver(b)
	assert.equal(a.sync.unacknowledged, 0)
	assert.equal(b.sync.unacknowledged, 0)
	const want = hostOrder(host.log)
	assert.equal(a.ground.byPath(), want)
	assert.equal(b.ground.byPath(), want)
})

test('a paint stroke not sent yet when a remote one arrives is sent and kept over it', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	b.ground.paint(0, 1, 'rock', 1)
	b.sync.flush()
	a.ground.paint(0, 1, 'grass', 2)
	host.deliver(a)
	assert.deepEqual(a.ground.slotsOf(0), ['base', 'grass', '', ''])
	assert.equal(host.log.length, 2, "the apply flushed A's chunk")
	host.deliver(a)
	host.deliver(b)
	assert.equal(b.ground.byPath(), a.ground.byPath())
})

test('an applied chunk is not sent back, a mark that changed nothing sends nothing, and only changed chunks go', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	a.ground.paint(3, 1, 'grass', 0)
	// A whole-map mark (a reload) with one chunk changed sends that chunk alone.
	a.ground.markSplatDirty()
	a.sync.flush()
	assert.deepEqual(
		host.log[0].data.chunks.map((c) => c.c),
		[3],
	)
	host.deliver(b)
	assert.equal(b.ground.marks, 1, 'the apply marks the paint for the GPU')
	b.sync.flush()
	b.ground.markSplatDirty()
	b.sync.flush()
	assert.equal(host.log.length, 1)
})

test('an undo of Add Texture keeps a texture another member painted with since, so the palette only grows', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	// A adds X (index 1), not painted; B paints Y, which lands at A's index 2.
	a.ground.use('x')
	a.sync.flush()
	b.ground.paint(1, 1, 'y', 0)
	b.sync.flush()
	host.deliver(a)
	assert.deepEqual(a.ground.palette, ['base', 'x', 'y'])
	// A undoes its Add Texture: the palette as it was before, which drops Y too.
	a.ground.palette = ['base']
	a.sync.flush()
	assert.deepEqual(a.ground.palette, ['base', 'x', 'y'])
	// With nothing painted past it, an undo's shrink stands.
	const c = host.member(3, new Ground())
	c.ground.use('z')
	c.sync.flush()
	c.ground.palette = ['base']
	c.sync.flush()
	assert.deepEqual(c.ground.palette, ['base'])
})

test("a guest holds the messages before the host's map and drops those already in it", () => {
	const g = new Ground()
	const s = new PaintSync({ send: async () => undefined, palette: () => g.palette, setPalette: (p) => (g.palette = p) })
	s.wait()
	const w = new Uint8Array(PER * PER * SLOTS)
	for (let i = 0; i < w.length; i += SLOTS) w[i + 1] = 255
	const msg = (c: number, path: string): PaintData => ({ id: 1, chunks: [{ c, slots: ['base', path, '', ''], w: bytesToBase64(w) }] })
	s.receive(4, 1, msg(0, 'old'), 2)
	s.receive(6, 3, msg(1, 'new'), 2)
	s.bind(g, 5)
	assert.deepEqual(g.slotsOf(0), ['base', '', '', ''])
	assert.deepEqual(g.slotsOf(1), ['base', 'new', '', ''])
	assert.deepEqual(g.palette, ['base', 'new'])
})

test('a message that does not fit the map is ignored', () => {
	const g = new Ground()
	const s = new PaintSync({ send: async () => undefined, palette: () => g.palette, setPalette: (p) => (g.palette = p) })
	s.bind(g, 0)
	const w = bytesToBase64(new Uint8Array(PER * PER * SLOTS))
	s.receive(1, 3, { id: 1, chunks: [{ c: SIDE * SIDE, slots: ['', '', '', ''], w }] }, 2)
	s.receive(2, 3, { id: 2, chunks: [{ c: 0, slots: ['a', '', ''], w }] }, 2)
	s.receive(3, 3, { id: 3, chunks: [{ c: 0, slots: ['a', '', '', ''], w: bytesToBase64(new Uint8Array(3)) }] }, 2)
	s.receive(4, 3, { id: 4 }, 2)
	assert.equal(g.marks, 0)
	assert.deepEqual(g.palette, ['base'])
})

test('a failed send drops its chunks from the unacknowledged ones', async () => {
	let failed = 0
	const g = new Ground()
	const s = new PaintSync({ send: () => Promise.reject(new Error('gone')), palette: () => g.palette, setPalette: (p) => (g.palette = p), failed: () => failed++ })
	s.bind(g, 0)
	g.paint(0, 1, 'grass', 0)
	s.flush()
	await Promise.resolve()
	await Promise.resolve()
	assert.equal(failed, 1)
	assert.equal(s.unacknowledged, 0)
})
