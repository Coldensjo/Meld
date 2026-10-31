// Run with: bun test tests/sessionHeights.test.ts
// Terrain heights in a shared session (lib/session/heights.ts, #1001): two members edit through a
// scripted host that numbers every message and delivers it to everyone, the sender too, when the test
// says; each member must end with what applying the messages in the host's order gives.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { HeightSync, KIND_HEIGHTS, type HeightGround, type HeightsData, type VertexRect } from '../src/lib/session/heights.ts'
import { floatsToBase64 } from '../src/lib/io/base64.ts'

const V = 9

/** A stand-in for Terrain: the heights and the session's change rect that `markDirty` grows. */
class Ground implements HeightGround {
	readonly verts = V
	readonly heights = new Float32Array(V * V)
	private c = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
	marks = 0
	markDirty(x0: number, z0: number, x1: number, z1: number) {
		this.marks++
		this.c.x0 = Math.min(this.c.x0, x0)
		this.c.z0 = Math.min(this.c.z0, z0)
		this.c.x1 = Math.max(this.c.x1, x1)
		this.c.z1 = Math.max(this.c.z1, z1)
	}
	takeSessionChange(out: VertexRect) {
		const any = this.c.x0 <= this.c.x1
		Object.assign(out, this.c)
		this.c = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
		return any
	}
	/** An edit: sets the rect to `v` as a brush would, and marks it. */
	edit(r: VertexRect, v: number) {
		for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) this.heights[z * V + x] = v
		this.markDirty(r.x0, r.z0, r.x1, r.z1)
	}
}

interface Msg {
	seq: number
	from: number
	kind: string
	data: HeightsData
}

/** The host's order: every send takes the next seq and queues for every member until `deliver`. */
class Host {
	seq = 0
	log: Msg[] = []
	inbox = new Map<number, Msg[]>()
	member(id: number, ground: Ground) {
		this.inbox.set(id, [])
		const sync = new HeightSync({
			send: async (data) => {
				const m = { seq: ++this.seq, from: id, kind: KIND_HEIGHTS, data: JSON.parse(JSON.stringify(data)) as HeightsData }
				this.log.push(m)
				for (const q of this.inbox.values()) q.push(m)
			},
		})
		sync.bind(ground, 0)
		return { id, ground, sync }
	}
	/** Hands member `m` its next `n` messages (all without `n`). */
	deliver(m: { id: number; sync: HeightSync }, n = Infinity) {
		const q = this.inbox.get(m.id)!
		for (const msg of q.splice(0, n)) m.sync.receive(msg.seq, msg.from, msg.data, m.id)
	}
}

/** The heights the host's order ends with, from flat ground. */
function hostOrder(log: Msg[]) {
	const g = new Ground()
	const s = new HeightSync({ send: async () => undefined })
	s.bind(g, 0)
	for (const m of log) s.receive(m.seq, m.from, m.data, 99)
	return g.heights
}

const rect = (x0: number, z0: number, x1: number, z1: number) => ({ x0, z0, x1, z1 })

test('a remote edit over two of mine still unacknowledged ends as the host order does', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	// B edits first, so the host orders it before A's two.
	b.ground.edit(rect(2, 2, 6, 6), 3)
	b.sync.flush()
	a.ground.edit(rect(0, 0, 4, 4), 1)
	a.sync.flush()
	a.ground.edit(rect(3, 3, 5, 5), 2)
	a.sync.flush()
	assert.equal(a.sync.unacknowledged, 2)
	// B's arrives at A before A's acknowledgements: A keeps its own values over it.
	host.deliver(a, 1)
	assert.equal(a.ground.heights[4 * V + 4], 2, 'my newer edit wins where all three overlap')
	assert.equal(a.ground.heights[2 * V + 2], 1, 'my older edit wins over the remote one')
	assert.equal(a.ground.heights[6 * V + 6], 3, 'the remote edit shows where mine are not')
	host.deliver(a)
	host.deliver(b)
	assert.equal(a.sync.unacknowledged, 0)
	assert.equal(b.sync.unacknowledged, 0)
	const want = hostOrder(host.log)
	assert.deepEqual(a.ground.heights, want)
	assert.deepEqual(b.ground.heights, want)
})

test('an edit not sent yet when a remote one arrives is sent and kept over it', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	b.ground.edit(rect(0, 0, 8, 8), 5)
	b.sync.flush()
	// Mid-stroke on A: written, not flushed yet.
	a.ground.edit(rect(1, 1, 2, 2), 7)
	host.deliver(a)
	assert.equal(a.ground.heights[1 * V + 1], 7)
	assert.equal(a.ground.heights[0], 5)
	assert.equal(host.log.length, 2, "the apply flushed A's edit")
	host.deliver(a)
	host.deliver(b)
	assert.deepEqual(a.ground.heights, hostOrder(host.log))
	assert.deepEqual(b.ground.heights, a.ground.heights)
})

test('both members editing at once over the same spot end the same', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	for (let i = 0; i < 6; i++) {
		a.ground.edit(rect(i % 4, 1, (i % 4) + 3, 5), 10 + i)
		b.ground.edit(rect(2, i % 5, 6, (i % 5) + 2), 20 + i)
		a.sync.flush()
		b.sync.flush()
		host.deliver(a, 1)
		host.deliver(b, 3)
	}
	host.deliver(a)
	host.deliver(b)
	const want = hostOrder(host.log)
	assert.deepEqual(a.ground.heights, want)
	assert.deepEqual(b.ground.heights, want)
})

test('an applied edit is not sent back, and a mark that changed nothing sends nothing', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	a.ground.edit(rect(0, 0, 1, 1), 4)
	a.sync.flush()
	host.deliver(b)
	assert.equal(b.ground.marks, 1, 'the apply marks the ground for the GPU')
	b.sync.flush()
	// A hole or a reload marks heights it did not change.
	b.ground.markDirty(0, 0, V - 1, V - 1)
	b.sync.flush()
	assert.equal(host.log.length, 1)
})

test('the sent rect shrinks to the vertices that changed', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	a.ground.heights[3 * V + 5] = 2
	a.ground.markDirty(0, 0, V - 1, V - 1)
	a.sync.flush()
	assert.deepEqual(host.log[0].data.rect, rect(5, 3, 5, 3))
})

test("a guest holds the messages before the host's map and drops those already in it", () => {
	const g = new Ground()
	const s = new HeightSync({ send: async () => undefined })
	s.wait()
	const msg = (r: VertexRect, v: number): HeightsData => ({ id: 1, rect: r, h: floatsToBase64(new Float32Array((r.x1 - r.x0 + 1) * (r.z1 - r.z0 + 1)).fill(v)) })
	s.receive(4, 1, msg(rect(0, 0, 0, 0), 9), 2)
	s.receive(6, 3, msg(rect(1, 0, 1, 0), 8), 2)
	// The map as it was after seq 5: the first edit is in it already (here the host's map has 1 there).
	g.heights[0] = 1
	s.bind(g, 5)
	assert.equal(g.heights[0], 1)
	assert.equal(g.heights[1], 8)
	s.receive(7, 1, msg(rect(2, 0, 2, 0), 6), 2)
	assert.equal(g.heights[2], 6)
})

test('a message that does not fit the map is ignored', () => {
	const g = new Ground()
	const s = new HeightSync({ send: async () => undefined })
	s.bind(g, 0)
	s.receive(1, 3, { id: 1, rect: rect(0, 0, V, 0), h: floatsToBase64(new Float32Array(V + 1)) }, 2)
	s.receive(2, 3, { id: 2, rect: rect(0, 0, 1, 0), h: floatsToBase64(new Float32Array(3)) }, 2)
	s.receive(3, 3, { id: 3, rect: rect(0, 0, 1, 0), h: '' }, 2)
	assert.equal(g.marks, 0)
	assert.ok(g.heights.every((v) => v === 0))
})

test('a failed send drops its values from the unacknowledged ones', async () => {
	let failed = 0
	const g = new Ground()
	const s = new HeightSync({ send: () => Promise.reject(new Error('gone')), failed: () => failed++ })
	s.bind(g, 0)
	g.edit(rect(0, 0, 0, 0), 1)
	s.flush()
	await Promise.resolve()
	await Promise.resolve()
	assert.equal(failed, 1)
	assert.equal(s.unacknowledged, 0)
})
