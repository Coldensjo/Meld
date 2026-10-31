// Run with: bun test tests/sessionObjects.test.ts
// Placed objects in a shared session (lib/session/objects.ts, #1003): members edit real ObjectLayers through
// a scripted host that numbers every message and delivers it to everyone, the sender too, when the test
// says. Every member must end with the objects the host's order gives, and two members adding at once
// must never make the same id.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import type { Terrain } from '../src/lib/terrain/Terrain.ts'
import type { ObjectsData, IdLane } from '../src/lib/session/objects.ts'

const { ObjectLayer, inLane } = await import('../src/lib/world/ObjectLayer.ts')
const { KIND_OBJECTS, LANES, Lanes, ObjectSync, wireOf } = await import('../src/lib/session/objects.ts')
type Layer = InstanceType<typeof ObjectLayer>
type Sync = InstanceType<typeof ObjectSync>

const TYPE = 'helper:cube:4'
const terrain = { heightAt: () => 0 } as unknown as Terrain
const at = (x: number, z: number) => ({ type: TYPE, x, z, yOff: 0, rotY: 0, scale: 1 })

interface Msg {
	seq: number
	from: number
	kind: string
	data: ObjectsData
}

class Host {
	seq = 0
	log: Msg[] = []
	inbox = new Map<number, Msg[]>()
	member(id: number, layer: Layer, ids: IdLane = { lane: id - 1, nextId: 0, nextGroup: 0 }) {
		this.inbox.set(id, [])
		const sync = new ObjectSync({
			send: async (data) => {
				const m = { seq: ++this.seq, from: id, kind: KIND_OBJECTS, data: JSON.parse(JSON.stringify(data)) as ObjectsData }
				this.log.push(m)
				for (const q of this.inbox.values()) q.push(m)
			},
		})
		sync.bind(layer, 0, ids)
		return { id, layer, sync }
	}
	deliver(m: { id: number; sync: Sync }, n = Infinity) {
		const q = this.inbox.get(m.id)!
		for (const msg of q.splice(0, n)) m.sync.receive(msg.seq, msg.from, msg.data, m.id)
	}
}

/** The objects of a layer in their saved form, sorted by id. */
function state(L: Layer) {
	return JSON.stringify(
		L.list()
			.map(wireOf)
			.sort((a, b) => a.id - b.id),
	)
}

/** The objects the host's order ends with, from `start`. */
function hostOrder(start: (L: Layer) => void, log: Msg[]) {
	const L = new ObjectLayer(terrain)
	start(L)
	const s = new ObjectSync({ send: async () => undefined })
	s.bind(L, 0, { lane: 15, nextId: 0, nextGroup: 0 })
	for (const m of log) s.receive(m.seq, m.from, m.data, 99)
	return state(L)
}

/** Two layers holding the same start map: one model, id 1. */
function pair() {
	const start = (L: Layer) => void L.add({ ...at(5, 5), id: 1 })
	const a = new ObjectLayer(terrain)
	const b = new ObjectLayer(terrain)
	start(a)
	start(b)
	return { start, a, b }
}

test('inLane gives the least number at or above n in the lane', () => {
	assert.equal(inLane(1, 0, 16), 16)
	assert.equal(inLane(16, 0, 16), 16)
	assert.equal(inLane(17, 0, 16), 32)
	assert.equal(inLane(1, 3, 16), 3)
	assert.equal(inLane(4, 3, 16), 19)
	assert.equal(inLane(7, 5, 1), 7)
})

test('two members placing at once make different ids, and both end with both models', () => {
	const host = new Host()
	const { start, a: la, b: lb } = pair()
	const a = host.member(1, la)
	const b = host.member(2, lb)
	const oa = la.add(at(10, 10))
	const ob = lb.add(at(20, 20))
	assert.notEqual(oa.id, ob.id)
	assert.equal(oa.id % LANES, 0)
	assert.equal(ob.id % LANES, 1)
	a.sync.flush()
	b.sync.flush()
	host.deliver(a)
	host.deliver(b)
	assert.equal(la.objects.size, 3)
	assert.equal(state(la), state(lb))
	assert.equal(state(la), hostOrder(start, host.log))
	assert.equal(a.sync.unacknowledged, 0)
	assert.equal(b.sync.unacknowledged, 0)
	// Each goes on counting in its own lane, past the other's ids.
	assert.equal(la.add(at(1, 1)).id % LANES, 0)
	assert.equal(lb.add(at(1, 1)).id % LANES, 1)
})

test("two members moving one model at once both end with the later move in the host's order", () => {
	const host = new Host()
	const { start, a: la, b: lb } = pair()
	const a = host.member(1, la)
	const b = host.member(2, lb)
	la.objects.get(1)!.x = 50
	la.touch(1)
	lb.objects.get(1)!.z = 70
	lb.objects.get(1)!.rotY = 1
	lb.touch(1)
	a.sync.flush()
	b.sync.flush()
	// B hears A's move while its own is unacknowledged: its own stays over it.
	host.deliver(b, 1)
	assert.equal(lb.objects.get(1)!.z, 70)
	assert.equal(lb.objects.get(1)!.x, 5)
	host.deliver(a)
	host.deliver(b)
	assert.equal(state(la), state(lb))
	assert.equal(state(la), hostOrder(start, host.log))
	assert.equal(la.objects.get(1)!.z, 70)
})

test('a delete and a move of one model at once end the same on both', () => {
	const host = new Host()
	const { start, a: la, b: lb } = pair()
	const a = host.member(1, la)
	const b = host.member(2, lb)
	la.remove(1)
	lb.objects.get(1)!.x = 9
	lb.touch(1)
	b.sync.flush()
	a.sync.flush()
	host.deliver(a)
	host.deliver(b)
	assert.equal(state(la), state(lb))
	assert.equal(state(la), hostOrder(start, host.log))
	// B's move came first in the order, A's delete after: the model is gone.
	assert.equal(la.objects.size, 0)
})

test('an applied change is not sent back, and a touch that changed nothing sends nothing', () => {
	const host = new Host()
	const { a: la, b: lb } = pair()
	const a = host.member(1, la)
	const b = host.member(2, lb)
	la.add(at(3, 3))
	a.sync.flush()
	host.deliver(b)
	b.sync.flush()
	lb.touch(1)
	lb.markRegionDirty(0, 0, 100, 100)
	b.sync.flush()
	assert.equal(host.log.length, 1)
})

test('an attachment, a new model and a group arrive with the parent, and a removed object leaves', () => {
	const host = new Host()
	const { start, a: la, b: lb } = pair()
	const a = host.member(1, la)
	const b = host.member(2, lb)
	const parent = la.add(at(40, 40))
	la.add({ ...at(1, 2), yOff: 3, parent: parent.id, tiltX: 0.25 })
	const g = la.newGroup()
	assert.equal(g % LANES, 0)
	la.setGroup(1, g)
	la.setType(1, 'helper:sphere:2')
	a.sync.flush()
	host.deliver(b)
	assert.equal(state(la), state(lb))
	const kid = [...lb.objects.values()].find((o) => o.parent === parent.id)!
	assert.ok(lb.descendantIds(parent.id).has(kid.id), 'the child is filed under its parent')
	assert.ok(lb.groupMembers(g).has(1))
	assert.equal(lb.objects.get(1)!.type, 'helper:sphere:2')
	// B's own next group is in its lane, past A's.
	assert.equal(lb.newGroup() % LANES, 1)
	lb.remove(kid.id)
	b.sync.flush()
	host.deliver(a)
	assert.equal(state(la), state(lb))
	assert.equal(state(la), hostOrder(start, host.log))
})

test('an undo brings a model back under its id, written over in place where it stands', () => {
	const host = new Host()
	const { a: la, b: lb } = pair()
	const a = host.member(1, la)
	const b = host.member(2, lb)
	const saved = { ...la.objects.get(1)! }
	la.remove(1)
	a.sync.flush()
	host.deliver(b)
	assert.equal(lb.objects.size, 0)
	la.add({ ...saved })
	a.sync.flush()
	host.deliver(b)
	assert.equal(state(la), state(lb))
	// A change to an object B holds keeps B's object, which History's steps and the Inspector may hold.
	const held = lb.objects.get(1)!
	la.objects.get(1)!.scale = 2
	la.touch(1)
	a.sync.flush()
	host.deliver(b)
	assert.equal(lb.objects.get(1), held)
	assert.equal(held.scale, 2)
})

test('clearing and refilling the layer sends only what changed', () => {
	const host = new Host()
	const { a: la, b: lb } = pair()
	const a = host.member(1, la)
	host.member(2, lb)
	la.add({ ...at(8, 8), id: 2 })
	a.sync.flush()
	const objs = la.list().map((o) => ({ ...o }))
	la.clear()
	for (const o of objs) la.add(o.id === 2 ? { ...o, x: 99 } : o)
	a.sync.flush()
	assert.equal(host.log.length, 2)
	assert.deepEqual(
		host.log[1].data.put.map((w) => w.id),
		[2],
	)
	assert.deepEqual(host.log[1].data.del, [])
})

test("a guest holds the messages before the host's map and drops those already in it", () => {
	const L = new ObjectLayer(terrain)
	const s = new ObjectSync({ send: async () => undefined })
	s.wait()
	s.receive(4, 1, { id: 1, put: [{ id: 16, ...at(1, 1) }], del: [] }, 2)
	s.receive(6, 1, { id: 2, put: [{ id: 32, ...at(2, 2) }], del: [] }, 2)
	s.bind(L, 5, { lane: 1, nextId: 100, nextGroup: 7 })
	assert.deepEqual([...L.objects.keys()], [32])
	// It counts from above the host's ids, in its lane.
	const o = L.add(at(0, 0))
	assert.ok(o.id >= 100 && o.id % LANES === 1, `id ${o.id}`)
	const g = L.newGroup()
	assert.ok(g >= 7 && g % LANES === 1, `group ${g}`)
	// Unbound, the layer counts on plainly.
	s.unbind()
	assert.equal(L.add(at(0, 0)).id, o.id + 1)
})

test('a message that does not fit is ignored', () => {
	const L = new ObjectLayer(terrain)
	L.add({ ...at(5, 5), id: 1 })
	const before = state(L)
	const s = new ObjectSync({ send: async () => undefined })
	s.bind(L, 0, { lane: 0, nextId: 0, nextGroup: 0 })
	s.receive(1, 3, { id: 1, put: [{ id: 0, ...at(1, 1) }], del: [] }, 2)
	s.receive(2, 3, { id: 2, put: [{ id: 5, type: TYPE, x: 'a' }], del: [-1, 1.5] }, 2)
	s.receive(3, 3, { id: 3 }, 2)
	assert.equal(state(L), before)
})

test('the host hands out the lowest free lane, and a freed one again', () => {
	const lanes = new Lanes()
	assert.equal(lanes.take(1), 0)
	assert.equal(lanes.take(2), 1)
	assert.equal(lanes.take(3), 2)
	assert.equal(lanes.take(2), 1)
	lanes.free(2)
	assert.equal(lanes.take(4), 1)
	for (let id = 5; id < 5 + LANES - 3; id++) assert.notEqual(lanes.take(id), null)
	assert.equal(lanes.take(99), null)
})
