// Run with: bun test tests/sessionHoles.test.ts
// Holes in a shared session (lib/session/holes.ts, #1016): two members cut and fill through a scripted
// host that numbers every message and delivers it to everyone, the sender too, when the test says; each
// member must end with what applying the messages in the host's order gives.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { HoleSync, KIND_HOLES, type CellRect, type HoleGround, type HolesData } from '../src/lib/session/holes.ts'
import { bytesToBase64 } from '../src/lib/io/base64.ts'

const S = 8

/** A stand-in for Terrain: the holes and the session's rect that `touchHoles` grows. */
class Ground implements HoleGround {
	readonly size = S
	readonly holes = new Uint8Array(S * S)
	private c = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
	touches = 0
	marks: CellRect[] = []
	touchHoles(r: CellRect) {
		this.touches++
		this.c.x0 = Math.min(this.c.x0, r.x0)
		this.c.z0 = Math.min(this.c.z0, r.z0)
		this.c.x1 = Math.max(this.c.x1, r.x1)
		this.c.z1 = Math.max(this.c.z1, r.z1)
	}
	markDirty(x0: number, z0: number, x1: number, z1: number) {
		this.marks.push({ x0, z0, x1, z1 })
	}
	takeSessionHoles(out: CellRect) {
		const any = this.c.x0 <= this.c.x1
		Object.assign(out, this.c)
		this.c = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
		return any
	}
	/** An edit: cuts (1) or fills (0) the rect as a tool would, and touches it. */
	edit(r: CellRect, v: number) {
		for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) this.holes[z * S + x] = v
		this.touchHoles(r)
	}
}

interface Msg {
	seq: number
	from: number
	kind: string
	data: HolesData
}

/** The host's order: every send takes the next seq and queues for every member until `deliver`. */
class Host {
	seq = 0
	log: Msg[] = []
	inbox = new Map<number, Msg[]>()
	member(id: number, ground: Ground) {
		this.inbox.set(id, [])
		const sync = new HoleSync({
			send: async (data) => {
				const m = { seq: ++this.seq, from: id, kind: KIND_HOLES, data: JSON.parse(JSON.stringify(data)) as HolesData }
				this.log.push(m)
				for (const q of this.inbox.values()) q.push(m)
			},
		})
		sync.bind(ground, 0)
		return { id, ground, sync }
	}
	deliver(m: { id: number; sync: HoleSync }, n = Infinity) {
		const q = this.inbox.get(m.id)!
		for (const msg of q.splice(0, n)) m.sync.receive(msg.seq, msg.from, msg.data, m.id)
	}
}

/** The holes the host's order ends with, from solid ground. */
function hostOrder(log: Msg[]) {
	const g = new Ground()
	const s = new HoleSync({ send: async () => undefined })
	s.bind(g, 0)
	for (const m of log) s.receive(m.seq, m.from, m.data, 99)
	return g.holes
}

const rect = (x0: number, z0: number, x1: number, z1: number) => ({ x0, z0, x1, z1 })

test('a remote cut over a fill and a cut of mine still unacknowledged ends as the host order does', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	b.ground.edit(rect(2, 2, 6, 6), 1)
	b.sync.flush()
	a.ground.edit(rect(0, 0, 3, 3), 1)
	a.sync.flush()
	a.ground.edit(rect(3, 3, 4, 4), 0)
	a.sync.flush()
	assert.equal(a.sync.unacknowledged, 2)
	host.deliver(a, 1)
	assert.equal(a.ground.holes[3 * S + 3], 0, 'my newer fill wins where all three overlap')
	assert.equal(a.ground.holes[2 * S + 2], 1)
	assert.equal(a.ground.holes[6 * S + 6], 1, 'the remote cut shows where mine are not')
	assert.equal(a.ground.holes[5 * S + 1], 0)
	host.deliver(a)
	host.deliver(b)
	const want = hostOrder(host.log)
	assert.deepEqual(a.ground.holes, want)
	assert.deepEqual(b.ground.holes, want)
})

test('both members cutting and filling at once over the same spot end the same', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	for (let i = 0; i < 6; i++) {
		a.ground.edit(rect(i % 4, 1, (i % 4) + 3, 5), i & 1)
		b.ground.edit(rect(2, i % 5, 6, (i % 5) + 2), (i + 1) & 1)
		a.sync.flush()
		b.sync.flush()
		host.deliver(a, 1)
		host.deliver(b, 3)
	}
	host.deliver(a)
	host.deliver(b)
	const want = hostOrder(host.log)
	assert.deepEqual(a.ground.holes, want)
	assert.deepEqual(b.ground.holes, want)
})

test('an applied edit is not sent back, rebuilds the ground, and a touch that changed nothing sends nothing', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	a.ground.edit(rect(1, 2, 2, 3), 1)
	a.sync.flush()
	host.deliver(b)
	assert.equal(b.ground.holes[2 * S + 1], 1)
	assert.equal(b.ground.touches, 1, 'the apply touches the holes (walls, walkable view)')
	assert.deepEqual(b.ground.marks, [rect(1, 2, 3, 4)], 'and marks the vertices around the cells for the rebuild')
	b.sync.flush()
	b.ground.touchHoles(rect(0, 0, S - 1, S - 1))
	b.sync.flush()
	assert.equal(host.log.length, 1)
})

test('the sent rect shrinks to the cells that changed', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	a.ground.holes[3 * S + 5] = 1
	a.ground.touchHoles(rect(0, 0, S - 1, S - 1))
	a.sync.flush()
	assert.deepEqual(host.log[0].data.rect, rect(5, 3, 5, 3))
})

test("a guest holds the messages before the host's map and drops those already in it", () => {
	const g = new Ground()
	const s = new HoleSync({ send: async () => undefined })
	s.wait()
	const msg = (r: CellRect, v: number): HolesData => ({ id: 1, rect: r, b: bytesToBase64(new Uint8Array((r.x1 - r.x0 + 1) * (r.z1 - r.z0 + 1)).fill(v)) })
	s.receive(4, 1, msg(rect(0, 0, 0, 0), 1), 2)
	s.receive(6, 3, msg(rect(1, 0, 1, 0), 1), 2)
	// The map as it was after seq 5: the host's map had filled cell 0 again since the first.
	s.bind(g, 5)
	assert.equal(g.holes[0], 0)
	assert.equal(g.holes[1], 1)
	s.receive(7, 1, msg(rect(2, 0, 2, 0), 1), 2)
	assert.equal(g.holes[2], 1)
})

test('a message that does not fit the map is ignored', () => {
	const g = new Ground()
	const s = new HoleSync({ send: async () => undefined })
	s.bind(g, 0)
	s.receive(1, 3, { id: 1, rect: rect(0, 0, S, 0), b: bytesToBase64(new Uint8Array(S + 1).fill(1)) }, 2)
	s.receive(2, 3, { id: 2, rect: rect(0, 0, 1, 0), b: bytesToBase64(new Uint8Array(3).fill(1)) }, 2)
	s.receive(3, 3, { id: 3, rect: rect(0, 0, 1, 0), b: 7 as unknown as string }, 2)
	assert.equal(g.touches, 0)
	assert.ok(g.holes.every((v) => v === 0))
})

test('a failed send drops its bytes from the unacknowledged ones', async () => {
	let failed = 0
	const g = new Ground()
	const s = new HoleSync({ send: () => Promise.reject(new Error('gone')), failed: () => failed++ })
	s.bind(g, 0)
	g.edit(rect(0, 0, 0, 0), 1)
	s.flush()
	await Promise.resolve()
	await Promise.resolve()
	assert.equal(failed, 1)
	assert.equal(s.unacknowledged, 0)
})
