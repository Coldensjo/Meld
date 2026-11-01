// Run with: bun test tests/sessionLiquids.test.ts
// Painted liquids in a shared session (lib/session/liquids.ts, #1017): two members paint water through a
// scripted host that numbers every message and delivers it to everyone, the sender too, when the test
// says; each member must end with what applying the messages in the host's order gives, chunk by chunk.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { KIND_LIQUIDS, LiquidSync, decodeLayers, encodeLayers, type LiquidsData } from '../src/lib/session/liquids.ts'
import { LiquidMap, encodeLiquids, liquidType, newLayer } from '../src/lib/water/liquids.ts'

/** 4x4 liquid chunks. */
const CELLS = 32

/** A chunk painted as a tool would: one layer of liquid `id` at `height` over the cells `from`..`to` (row-major), or none for id 0. */
function paint(map: LiquidMap, c: number, id: number, height = 1, from = 0, to = 63) {
	if (!id) return map.set(c, [])
	const l = newLayer(id, height)
	l.depth.fill(0.37)
	for (let i = from; i <= to; i++) l.cells[i] = 1
	map.set(c, [l])
}

interface Msg {
	seq: number
	from: number
	kind: string
	data: LiquidsData
}

class Host {
	seq = 0
	log: Msg[] = []
	inbox = new Map<number, Msg[]>()
	member(id: number, map = new LiquidMap(CELLS)) {
		this.inbox.set(id, [])
		const applied: number[][] = []
		const sync = new LiquidSync({
			send: async (data) => {
				const m = { seq: ++this.seq, from: id, kind: KIND_LIQUIDS, data: JSON.parse(JSON.stringify(data)) as LiquidsData }
				this.log.push(m)
				for (const q of this.inbox.values()) q.push(m)
			},
			applied: (c) => applied.push(c),
		})
		sync.bind(map, 0)
		return { id, map, sync, applied }
	}
	deliver(m: { id: number; sync: LiquidSync }, n = Infinity) {
		const q = this.inbox.get(m.id)!
		for (const msg of q.splice(0, n)) m.sync.receive(msg.seq, msg.from, msg.data, m.id)
	}
}

/** The liquids the host's order ends with, from a dry map, as the map file saves them. */
function hostOrder(log: Msg[]) {
	const map = new LiquidMap(CELLS)
	const s = new LiquidSync({ send: async () => undefined })
	s.bind(map, 0)
	for (const m of log) s.receive(m.seq, m.from, m.data, 99)
	return encodeLiquids(map)
}

test('a remote chunk over a chunk of mine still unacknowledged ends as the host order does, mine on top', () => {
	const host = new Host()
	const a = host.member(1)
	const b = host.member(2)
	paint(b.map, 0, 1, 5)
	paint(b.map, 1, 1, 5)
	b.sync.flush()
	paint(a.map, 1, 3, 9)
	a.sync.flush()
	host.deliver(a, 1)
	assert.equal(a.map.layers(0)[0]?.heights[0], 5, "the other's chunk shows where mine is not")
	assert.equal(a.map.layers(1)[0]?.id, 3, 'my newer chunk stays over the one the host ordered first')
	host.deliver(a)
	host.deliver(b)
	const want = hostOrder(host.log)
	assert.deepEqual(encodeLiquids(a.map), want)
	assert.deepEqual(encodeLiquids(b.map), want)
	assert.equal(b.map.layers(1)[0]?.id, 3)
})

test('both members painting and drying the same chunks at once end the same', () => {
	const host = new Host()
	const a = host.member(1)
	const b = host.member(2)
	for (let i = 0; i < 8; i++) {
		paint(a.map, i % 3, (i % 4) + 1, i, i, 40)
		paint(b.map, (i + 1) % 3, i & 1, -i, 10, 63 - i)
		a.sync.flush()
		b.sync.flush()
		host.deliver(a, 1)
		host.deliver(b, 3)
	}
	host.deliver(a)
	host.deliver(b)
	const want = hostOrder(host.log)
	assert.deepEqual(encodeLiquids(a.map), want)
	assert.deepEqual(encodeLiquids(b.map), want)
})

test('a dried chunk goes out with no layers, an applied one is not sent back, and a touch that changed nothing sends nothing', () => {
	const host = new Host()
	const a = host.member(1)
	const b = host.member(2)
	paint(a.map, 5, 1)
	a.sync.flush()
	host.deliver(b)
	assert.equal(b.map.layers(5).length, 1)
	assert.ok(b.map.dirty.has(5), 'the renderer redraws the chunk')
	assert.deepEqual(b.applied, [[5]])
	b.sync.flush()
	b.map.touch(5)
	b.map.touch(6)
	b.sync.flush()
	assert.equal(host.log.length, 1)
	paint(a.map, 5, 0)
	a.sync.flush()
	assert.equal(host.log[1].data.chunks[0].layers, '')
	host.deliver(b)
	assert.equal(b.map.layers(5).length, 0)
})

test("a building's liquid goes with its kind, which a member without it learns", () => {
	const host = new Host()
	const a = host.member(1)
	const b = host.member(2)
	const id = 201
	assert.equal(liquidType(id).kind, 'river', 'unknown here before')
	const l = newLayer(id, 2)
	l.cells.fill(1)
	a.map.set(3, [l])
	a.sync.flush()
	assert.equal(host.log[0].data.kinds, undefined, 'an ID of unknown kind goes without one')
	host.deliver(b)
	assert.equal(b.map.layers(3)[0].id, id)
	b.sync.receive(9, 7, { id: 1, chunks: [{ c: 2, layers: encodeLayers(2, [l]) }], kinds: { [id]: 'slime' } }, 2)
	assert.equal(liquidType(id).kind, 'slime')
	// Known now (as from a map file's liquidKinds), it goes out with its kind.
	a.map.set(4, [l])
	a.sync.flush()
	assert.deepEqual(host.log[1].data.kinds, { [id]: 'slime' })
})

test('the layers survive the wire as the map file holds them', () => {
	const l = newLayer(2, 3.25)
	l.cells[7] = 1
	l.depth[4] = 0.5
	const back = decodeLayers(encodeLayers(9, [l]))!
	assert.equal(back.length, 1)
	assert.equal(back[0].id, 2)
	assert.equal(back[0].cells[7], 1)
	assert.equal(back[0].heights[0], 3.25)
	assert.equal(back[0].depth[4], Math.fround(128 / 255))
})

test("a guest holds the messages before the host's map and drops those already in it", () => {
	const map = new LiquidMap(CELLS)
	const s = new LiquidSync({ send: async () => undefined })
	s.wait()
	const one = newLayer(1, 1)
	one.cells.fill(1)
	const msg = (c: number): LiquidsData => ({ id: 1, chunks: [{ c, layers: encodeLayers(c, [one]) }] })
	s.receive(4, 1, msg(0), 2)
	s.receive(6, 3, msg(1), 2)
	s.bind(map, 5)
	assert.equal(map.layers(0).length, 0)
	assert.equal(map.layers(1).length, 1)
	s.receive(7, 1, msg(2), 2)
	assert.equal(map.layers(2).length, 1)
})

test('a message that does not fit the map is ignored whole', () => {
	const map = new LiquidMap(CELLS)
	const s = new LiquidSync({ send: async () => undefined })
	s.bind(map, 0)
	const one = newLayer(1, 1)
	one.cells.fill(1)
	const good = { c: 0, layers: encodeLayers(0, [one]) }
	s.receive(1, 3, { id: 1, chunks: [good, { c: 16, layers: good.layers }] }, 2)
	s.receive(2, 3, { id: 2, chunks: [good, { c: 1, layers: 'AAAA' }] }, 2)
	s.receive(3, 3, { id: 3, chunks: [good, { c: 1, layers: 7 as unknown as string }] }, 2)
	s.receive(4, 3, { id: 4, chunks: 'x' as unknown as [] }, 2)
	assert.ok(map.empty)
})

test('a failed send drops its chunks from the unacknowledged ones', async () => {
	let failed = 0
	const map = new LiquidMap(CELLS)
	const s = new LiquidSync({ send: () => Promise.reject(new Error('gone')), failed: () => failed++ })
	s.bind(map, 0)
	paint(map, 0, 1)
	s.flush()
	await Promise.resolve()
	await Promise.resolve()
	assert.equal(failed, 1)
	assert.equal(s.unacknowledged, 0)
})
