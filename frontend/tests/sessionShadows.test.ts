// Run with: bun test tests/sessionShadows.test.ts
// The baked shadows in a shared session (lib/session/shadows.ts, #1018): two members shadow and light
// texels, make and drop the layer through a scripted host that numbers every message and delivers it to
// everyone, the sender too, when the test says; each member must end with what applying the messages in
// the host's order gives.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { KIND_SHADOWS, ShadowSync, type ShadowGround, type ShadowsData, type TexelRect } from '../src/lib/session/shadows.ts'
import { bytesToBase64 } from '../src/lib/io/base64.ts'

const SIDE = 16

/** A stand-in for Terrain: the shadow layer (null for none) and the session's rect that `touchShadow` grows. */
class Ground implements ShadowGround {
	readonly shadowSide = SIDE
	shadow: Uint8Array | null = null
	bakedRequested = false
	private c = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
	touches: TexelRect[] = []
	ensureShadow() {
		if (!this.shadow) this.setShadow(new Uint8Array(SIDE * SIDE))
		return this.shadow!
	}
	setShadow(bytes: Uint8Array | null) {
		this.shadow = bytes
	}
	touchShadow(r: TexelRect) {
		this.touches.push({ ...r })
		this.c.x0 = Math.min(this.c.x0, r.x0)
		this.c.z0 = Math.min(this.c.z0, r.z0)
		this.c.x1 = Math.max(this.c.x1, r.x1)
		this.c.z1 = Math.max(this.c.z1, r.z1)
	}
	takeSessionShadow(out: TexelRect) {
		const any = this.c.x0 <= this.c.x1
		Object.assign(out, this.c)
		this.c = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity }
		return any
	}
	/** A stroke: shadows (255) or lights (0) the rect as the Shadow mode would, and touches it. */
	edit(r: TexelRect, v: number) {
		const s = this.ensureShadow()
		for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) s[z * SIDE + x] = v
		this.touchShadow(r)
	}
	/** What a save keeps: none, or a bit a texel. */
	saved() {
		return this.shadow ? Array.from(this.shadow, (v) => (v >= 128 ? 1 : 0)).join('') : 'none'
	}
}

interface Msg {
	seq: number
	from: number
	kind: string
	data: ShadowsData
}

/** The host's order: every send takes the next seq and queues for every member until `deliver`. */
class Host {
	seq = 0
	log: Msg[] = []
	inbox = new Map<number, Msg[]>()
	member(id: number, ground: Ground) {
		this.inbox.set(id, [])
		const sync = new ShadowSync({
			send: async (data) => {
				const m = { seq: ++this.seq, from: id, kind: KIND_SHADOWS, data: JSON.parse(JSON.stringify(data)) as ShadowsData }
				this.log.push(m)
				for (const q of this.inbox.values()) q.push(m)
			},
		})
		sync.bind(ground, 0)
		return { id, ground, sync }
	}
	deliver(m: { id: number; sync: ShadowSync }, n = Infinity) {
		const q = this.inbox.get(m.id)!
		for (const msg of q.splice(0, n)) m.sync.receive(msg.seq, msg.from, msg.data, m.id)
	}
}

/** The shadows the host's order ends with, from a map with none, as a save keeps them. */
function hostOrder(log: Msg[]) {
	const g = new Ground()
	const s = new ShadowSync({ send: async () => undefined })
	s.bind(g, 0)
	for (const m of log) s.receive(m.seq, m.from, m.data, 99)
	return g.saved()
}

const rect = (x0: number, z0: number, x1: number, z1: number) => ({ x0, z0, x1, z1 })

test('a stroke on a map without shadows makes the layer on the others, and only the changed texels travel', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	a.ground.edit(rect(3, 4, 5, 6), 255)
	a.sync.flush()
	assert.deepEqual(host.log[0].data.rect, rect(3, 4, 5, 6))
	assert.equal(host.log[0].data.b?.length, bytesToBase64(new Uint8Array(2)).length, 'nine texels go as two bytes of bits')
	host.deliver(b)
	assert.ok(b.ground.shadow, 'the receiver made a layer')
	assert.equal(b.ground.shadow![4 * SIDE + 3], 255)
	assert.equal(b.ground.shadow![0], 0)
	assert.equal(b.ground.saved(), a.ground.saved())
	b.sync.flush()
	assert.equal(host.log.length, 1, 'an applied stroke is not sent back')
})

test("dropping the layer (an undo of the map's first stroke) goes out as none, and my strokes since stay over it", () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	a.ground.edit(rect(0, 0, 3, 3), 255)
	a.sync.flush()
	host.deliver(a)
	host.deliver(b)
	a.ground.setShadow(null)
	a.sync.flush()
	assert.equal(host.log[1].data.none, true)
	b.ground.edit(rect(8, 8, 9, 9), 255)
	b.sync.flush()
	// b gets a's none while its own stroke is unacknowledged: its stroke comes after in the order.
	host.deliver(b, 1)
	assert.equal(b.ground.shadow![8 * SIDE + 8], 255)
	assert.equal(b.ground.shadow![0], 0)
	host.deliver(a)
	host.deliver(b)
	const want = hostOrder(host.log)
	assert.equal(a.ground.saved(), want)
	assert.equal(b.ground.saved(), want)
	assert.notEqual(want, 'none')
})

test('a remote stroke under a none of mine still unacknowledged leaves none', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	a.ground.edit(rect(0, 0, 1, 1), 255)
	a.sync.flush()
	host.deliver(a)
	host.deliver(b)
	b.ground.edit(rect(5, 5, 6, 6), 255)
	b.sync.flush()
	a.ground.setShadow(null)
	a.sync.flush()
	host.deliver(a)
	assert.equal(a.ground.shadow, null)
	host.deliver(b)
	assert.equal(b.ground.saved(), 'none')
	assert.equal(hostOrder(host.log), 'none')
})

test('both members shadowing and lighting at once over the same spot end the same', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	for (let i = 0; i < 8; i++) {
		a.ground.edit(rect(i % 5, 1, (i % 5) + 6, 9), i & 1 ? 0 : 255)
		b.ground.edit(rect(4, i % 7, 12, (i % 7) + 4), i & 1 ? 255 : 0)
		if (i === 5) a.ground.setShadow(null)
		a.sync.flush()
		b.sync.flush()
		host.deliver(a, 1)
		host.deliver(b, 3)
	}
	host.deliver(a)
	host.deliver(b)
	const want = hostOrder(host.log)
	assert.equal(a.ground.saved(), want)
	assert.equal(b.ground.saved(), want)
})

test("a layer that appears untouched (the client's, read for a region) is not sent", () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const client = new Uint8Array(SIDE * SIDE)
	client[17] = 255
	a.ground.setShadow(client)
	a.sync.flush()
	assert.equal(host.log.length, 0)
	a.ground.edit(rect(0, 0, 0, 0), 255)
	a.sync.flush()
	assert.equal(host.log.length, 1)
	assert.deepEqual(host.log[0].data.rect, rect(0, 0, 0, 0), 'the mirror took the client texel in')
})

test("a guest holds the messages before the host's map and drops those already in it; a bad message is ignored", () => {
	const g = new Ground()
	const s = new ShadowSync({ send: async () => undefined })
	s.wait()
	const one = (x: number): ShadowsData => ({ id: 1, rect: rect(x, 0, x, 0), b: bytesToBase64(Uint8Array.of(1)) })
	s.receive(4, 1, one(0), 2)
	s.receive(6, 3, one(1), 2)
	s.bind(g, 5)
	assert.equal(g.shadow![0], 0)
	assert.equal(g.shadow![1], 255)
	s.receive(7, 3, { id: 2, rect: rect(0, 0, SIDE, 0), b: bytesToBase64(new Uint8Array(3)) }, 2)
	s.receive(8, 3, { id: 3, rect: rect(0, 0, 9, 0), b: bytesToBase64(new Uint8Array(1)) }, 2)
	s.receive(9, 3, { id: 4 }, 2)
	assert.equal(g.touches.length, 1)
})

test('applying a remote none keeps the client shadows from being read over it', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	a.ground.edit(rect(0, 0, 1, 1), 255)
	a.sync.flush()
	host.deliver(a)
	host.deliver(b)
	a.ground.setShadow(null)
	a.sync.flush()
	b.ground.bakedRequested = false
	host.deliver(a)
	host.deliver(b)
	assert.equal(b.ground.shadow, null)
	assert.equal(b.ground.bakedRequested, true)
})
