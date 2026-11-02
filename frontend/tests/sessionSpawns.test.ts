// Run with: bun test tests/sessionSpawns.test.ts
// The server's spawns in a shared session (lib/session/spawns.ts, #1020): members edit real SpawnLayers
// through a scripted host that numbers every message and delivers it to everyone, the sender too, when the
// test says. Every member must end with the spawns the host's order gives, the host's layer must list the
// guests' edits for its Save Spawns, and two members placing at once must never make the same guid.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { vmangos } from '../src/lib/wails/models'
import type { MapDocument } from '../src/lib/engine/MapDocument'
import type { SpawnsData } from '../src/lib/session/spawns.ts'

const { SpawnLayer, spawnKey } = await import('../src/lib/world/SpawnLayer.ts')
const { KIND_SPAWNS, SpawnSync } = await import('../src/lib/session/spawns.ts')
const { LANES } = await import('../src/lib/session/objects.ts')
const { SpawnActions } = await import('../src/lib/engine/SpawnActions.ts')
const { History } = await import('../src/lib/state/history.ts')
const { spawnAdd, spawnChange, spawnDelete } = await import('../src/lib/world/spawnEdits.ts')
type Layer = InstanceType<typeof SpawnLayer>
type Sync = InstanceType<typeof SpawnSync>

function spawn(kind: 'monster' | 'npc' | 'object', guid: number, x = 0): vmangos.WorldSpawn {
	return { kind, guid, entry: 100 + guid, name: `${kind}${guid}`, x, y: 0, z: 0, orientation: 0, model: '', look: '', waypoints: [], leader: 0, pool: 0, motherPool: 0, display: 1 } as Partial<vmangos.WorldSpawn> as vmangos.WorldSpawn
}

interface Msg {
	seq: number
	from: number
	kind: string
	data: SpawnsData
}

class Host {
	seq = 0
	log: Msg[] = []
	inbox = new Map<number, Msg[]>()
	member(id: number, layer: Layer) {
		this.inbox.set(id, [])
		const sync = new SpawnSync({
			send: async (data) => {
				const m = { seq: ++this.seq, from: id, kind: KIND_SPAWNS, data: JSON.parse(JSON.stringify(data)) as SpawnsData }
				this.log.push(m)
				for (const q of this.inbox.values()) q.push(m)
			},
		})
		sync.bind(layer, 0)
		return { id, layer, sync }
	}
	deliver(m: { id: number; sync: Sync }, n = Infinity) {
		const q = this.inbox.get(m.id)!
		for (const msg of q.splice(0, n)) m.sync.receive(msg.seq, msg.from, msg.data, m.id)
	}
}

/** The rows of a layer, sorted by key. */
function state(L: Layer) {
	return JSON.stringify(L.spawns.slice().sort((a, b) => spawnKey(a).localeCompare(spawnKey(b))))
}

const START = () => [spawn('monster', 10, 5), spawn('object', 20, 6)]

/** The spawns the host's order ends with, from the start rows. */
function hostOrder(log: Msg[]) {
	const L = new SpawnLayer()
	L.set(START())
	const s = new SpawnSync({ send: async () => undefined })
	s.bind(L, 0)
	for (const m of log) s.receive(m.seq, m.from, m.data, 99)
	return state(L)
}

/** Two layers holding the same database rows: the host's (member 1) and a guest's (member 2). */
function pair() {
	const host = new Host()
	const la = new SpawnLayer()
	const lb = new SpawnLayer()
	la.set(START())
	lb.set(START())
	return { host, la, lb, a: host.member(1, la), b: host.member(2, lb) }
}

test("a guest's move, field change and delete reach the host as edits its Save Spawns writes", () => {
	const { host, la, lb, a, b } = pair()
	const hb = new History()
	hb.push(spawnChange(lb, 'monster/10', { x: 40, z: 9 }, 'Move')!)
	hb.push(spawnDelete(lb, 'object/20', 'Delete')!)
	b.sync.flush()
	host.deliver(a)
	assert.equal(la.get('monster/10')!.x, 40)
	assert.equal(la.get('object/20'), undefined)
	const edits = la.edits()
	assert.equal(edits.length, 2)
	const moved = edits.find((e) => !e.deleted)!
	assert.equal(moved.original!.x, 5, "the host's save compares against the row as the database had it")
	assert.equal(edits.find((e) => e.deleted)!.spawn.guid, 20)
	// The guest's undo brings the deleted row back as the database's again: no edit for it on the host.
	hb.undo()
	b.sync.flush()
	host.deliver(a)
	assert.equal(la.edits().length, 1)
})

test('two members moving one spawn at once both end with the later move in the host order', () => {
	const { host, la, lb, a, b } = pair()
	spawnChange(la, 'monster/10', { x: 50 }, 'Move')
	spawnChange(lb, 'monster/10', { z: 70, orientation: 1 }, 'Turn')
	a.sync.flush()
	b.sync.flush()
	// B hears A's move while its own is unacknowledged: its own stays over it.
	host.deliver(b, 1)
	assert.equal(lb.get('monster/10')!.z, 70)
	host.deliver(a)
	host.deliver(b)
	assert.equal(state(la), state(lb))
	assert.equal(state(la), hostOrder(host.log))
	assert.equal(a.sync.unacknowledged + b.sync.unacknowledged, 0)
})

test('a spawn placed on a guest reaches the host as created, with what it was when placed', () => {
	const { host, la, lb, a, b } = pair()
	const placed = spawn('npc', 33, 7)
	spawnAdd(lb, placed, 'Place')
	spawnChange(lb, 'npc/33', { display: 2, ownDisplay: true }, 'Display')
	b.sync.flush()
	host.deliver(a)
	const e = la.edits().find((x) => x.spawn.guid === 33)!
	assert.ok(e.created)
	assert.equal(e.spawn.display, 2)
	assert.equal(e.original!.display, 1, 'the original came with the first put')
	assert.equal(state(la), state(lb))
	// A later change of it goes out without the original.
	spawnChange(lb, 'npc/33', { x: 8 }, 'Move')
	b.sync.flush()
	assert.equal(host.log.at(-1)!.data.orig, undefined)
})

test('an applied change is not sent back, and a touch that changed nothing sends nothing', () => {
	const { host, lb, a, b } = pair()
	spawnChange(a.layer, 'monster/10', { x: 3 }, 'Move')
	a.sync.flush()
	host.deliver(b)
	b.sync.flush()
	const s = lb.get('object/20')!
	lb.touch(s)
	lb.refresh(s)
	b.sync.flush()
	assert.equal(host.log.length, 1)
})

test('the host reading its spawns again sends the difference: the rows gone and the new ones', () => {
	const { host, la, lb, a, b } = pair()
	la.set([spawn('monster', 10, 5), spawn('monster', 11, 1)])
	a.sync.flush()
	assert.equal(host.log.length, 1)
	assert.deepEqual(host.log[0].data.del, ['object/20'])
	assert.deepEqual(
		host.log[0].data.put.map((s) => s.guid),
		[11],
	)
	host.deliver(b)
	assert.equal(state(la), state(lb))
})

test('two members placing at once take different guids, each in its lane, from the floors', async () => {
	const docs = (L: Layer) => [{ spawnLayer: L, history: new History() }] as unknown as MapDocument[]
	const actions = (L: Layer) => {
		const documents = docs(L)
		return new SpawnActions({ documents, doc: documents[0], cameraPos: new THREE.Vector3(), menuSeq: 0, focus: () => {}, deselect: () => {}, teleport: () => {} })
	}
	const { la, lb } = pair()
	const hostActs = actions(la)
	const guestActs = actions(lb)
	// The host knows its database's next guids; the guest takes them from the handoff and reads no database.
	hostActs.setLane(0, LANES, { creature: 500, object: 300, pool: 40 })
	const floors = await hostActs.floors()
	assert.deepEqual(floors, { creature: 500, object: 300, pool: 40 })
	guestActs.setLane(1, LANES, floors)
	const hostIds = await hostActs.pasteIds({ creatures: 2, objects: 1, pools: true })
	const guestIds = await guestActs.pasteIds({ creatures: 2, objects: 1, pools: true })
	const h = [hostIds.guid('creature'), hostIds.guid('creature'), hostIds.guid('object'), hostIds.pool()]
	const g = [guestIds.guid('creature'), guestIds.guid('creature'), guestIds.guid('object'), guestIds.pool()]
	assert.deepEqual(h, [512, 528, 304, 48])
	assert.deepEqual(g, [513, 529, 305, 49])
	// Out of the session, counting goes on one by one.
	guestActs.setLane(0, 1)
	assert.equal((await guestActs.pasteIds({ creatures: 1, objects: 0, pools: false })).guid('creature'), 530)
})
