// Run with: bun test tests/sessionChunkData.test.ts
// The ground's chunk data in a shared session (lib/session/chunkData.ts, #1018): two members set zones,
// impassable flags and no-effect cells through a scripted host that numbers every message and delivers
// it to everyone, the sender too, when the test says; each member must end with what applying the
// messages in the host's order gives.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { ChunkDataSync, KIND_CHUNK_DATA, type ChunkDataData, type ChunkDataGround, type GridRect } from '../src/lib/session/chunkData.ts'
import { bytesToBase64 } from '../src/lib/io/base64.ts'

const SIDE = 4
const S = 16

const empty = () => ({ x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity })
function grow(g: GridRect, r: GridRect) {
	g.x0 = Math.min(g.x0, r.x0)
	g.z0 = Math.min(g.z0, r.z0)
	g.x1 = Math.max(g.x1, r.x1)
	g.z1 = Math.max(g.z1, r.z1)
}

/** A stand-in for Terrain: the chunk data and the session's rects that `touchChunkData` grows. */
class Ground implements ChunkDataGround {
	readonly size = S
	readonly paintChunksPerSide = SIDE
	readonly areaIds = new Uint32Array(SIDE * SIDE)
	readonly chunkFlags = new Uint8Array(SIDE * SIDE)
	readonly noEffect = new Uint8Array(S * S)
	readonly biomeMap = new Uint8Array(S * S)
	private c = empty()
	private n = empty()
	touches: { rect: GridRect | null; cells: boolean }[] = []
	touchChunkData(rect?: GridRect | null, cells = false) {
		this.touches.push({ rect: rect ? { ...rect } : null, cells })
		if (!rect) {
			grow(this.c, { x0: 0, z0: 0, x1: SIDE - 1, z1: SIDE - 1 })
			grow(this.n, { x0: 0, z0: 0, x1: S - 1, z1: S - 1 })
		} else grow(cells ? this.n : this.c, rect)
	}
	biomeTouches: GridRect[] = []
	touchBiomeMap(rect: GridRect) {
		this.biomeTouches.push({ ...rect })
		grow(this.n, rect)
	}
	takeSessionChunkData(chunks: GridRect, cells: GridRect) {
		const any = this.c.x0 <= this.c.x1 || this.n.x0 <= this.n.x1
		Object.assign(chunks, this.c)
		Object.assign(cells, this.n)
		this.c = empty()
		this.n = empty()
		return any
	}
	/** A zone and flag stroke over a chunk rect, as the Map data tool makes. */
	zone(r: GridRect, id: number, flag: number) {
		for (let z = r.z0; z <= r.z1; z++) {
			for (let x = r.x0; x <= r.x1; x++) {
				this.areaIds[z * SIDE + x] = id
				this.chunkFlags[z * SIDE + x] = flag
			}
		}
		this.touchChunkData(r)
	}
	/** A no-tufts stroke over a cell rect. */
	cells(r: GridRect, v: number) {
		for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) this.noEffect[z * S + x] = v
		this.touchChunkData(r, true)
	}
	/** A Biome Brush stroke over a cell rect (#1036): biome `v` (1 plus its index, 0 for none). */
	biome(r: GridRect, v: number) {
		for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) this.biomeMap[z * S + x] = v
		this.touchBiomeMap(r)
	}
}

interface Msg {
	seq: number
	from: number
	kind: string
	data: ChunkDataData
}

/** The host's order: every send takes the next seq and queues for every member until `deliver`. */
class Host {
	seq = 0
	log: Msg[] = []
	inbox = new Map<number, Msg[]>()
	member(id: number, ground: Ground) {
		this.inbox.set(id, [])
		const sync = new ChunkDataSync({
			send: async (data) => {
				const m = { seq: ++this.seq, from: id, kind: KIND_CHUNK_DATA, data: JSON.parse(JSON.stringify(data)) as ChunkDataData }
				this.log.push(m)
				for (const q of this.inbox.values()) q.push(m)
			},
		})
		sync.bind(ground, 0)
		return { id, ground, sync }
	}
	deliver(m: { id: number; sync: ChunkDataSync }, n = Infinity) {
		const q = this.inbox.get(m.id)!
		for (const msg of q.splice(0, n)) m.sync.receive(msg.seq, msg.from, msg.data, m.id)
	}
}

/** The chunk data the host's order ends with, from an empty map. */
function hostOrder(log: Msg[]) {
	const g = new Ground()
	const s = new ChunkDataSync({ send: async () => undefined })
	s.bind(g, 0)
	for (const m of log) s.receive(m.seq, m.from, m.data, 99)
	return g
}

function same(a: Ground, b: Ground) {
	assert.deepEqual(a.areaIds, b.areaIds)
	assert.deepEqual(a.chunkFlags, b.chunkFlags)
	assert.deepEqual(a.noEffect, b.noEffect)
	assert.deepEqual(a.biomeMap, b.biomeMap)
}

const rect = (x0: number, z0: number, x1: number, z1: number) => ({ x0, z0, x1, z1 })

test('a remote zone over a zone of mine still unacknowledged ends as the host order does', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	b.ground.zone(rect(1, 1, 3, 3), 12, 2)
	b.sync.flush()
	a.ground.zone(rect(0, 0, 1, 1), 40, 0)
	a.ground.cells(rect(2, 2, 5, 5), 1)
	a.sync.flush()
	assert.equal(a.sync.unacknowledged, 1)
	host.deliver(a, 1)
	assert.equal(a.ground.areaIds[1 * SIDE + 1], 40, 'my newer zone wins where both are')
	assert.equal(a.ground.chunkFlags[1 * SIDE + 1], 2, 'my stroke left the flag as it was, so the remote one stands')
	assert.equal(a.ground.areaIds[3 * SIDE + 3], 12, 'the remote zone shows where mine is not')
	assert.equal(a.ground.chunkFlags[3 * SIDE + 3], 2)
	host.deliver(a)
	host.deliver(b)
	const want = hostOrder(host.log)
	same(a.ground, want)
	same(b.ground, want)
	assert.equal(want.noEffect[3 * S + 3], 1)
})

test('both members editing every grid at once end the same', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	for (let i = 0; i < 6; i++) {
		a.ground.zone(rect(i % 3, 0, (i % 3) + 1, 2), 100 + i, i & 2)
		a.ground.cells(rect(i, 3, i + 6, 9), i & 1)
		b.ground.zone(rect(1, i % 4, 3, i % 4), 70000 + i, 2)
		b.ground.cells(rect(4, i, 10, i + 4), (i + 1) & 1)
		a.sync.flush()
		b.sync.flush()
		host.deliver(a, 1)
		host.deliver(b, 3)
	}
	host.deliver(a)
	host.deliver(b)
	const want = hostOrder(host.log)
	same(a.ground, want)
	same(b.ground, want)
})

test('an applied edit is not sent back, redraws the overlay, and a touch that changed nothing sends nothing', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	a.ground.zone(rect(2, 1, 2, 1), 1519, 2)
	a.ground.cells(rect(5, 6, 7, 6), 1)
	a.sync.flush()
	host.deliver(b)
	assert.equal(b.ground.areaIds[1 * SIDE + 2], 1519)
	assert.equal(b.ground.noEffect[6 * S + 6], 1)
	assert.deepEqual(b.ground.touches, [
		{ rect: rect(2, 1, 2, 1), cells: false },
		{ rect: rect(5, 6, 7, 6), cells: true },
	])
	b.sync.flush()
	b.ground.touchChunkData()
	b.sync.flush()
	assert.equal(host.log.length, 1)
})

test('only the grids that changed are sent, each shrunk to what changed', () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	a.ground.chunkFlags[2 * SIDE + 3] = 2
	a.ground.touchChunkData()
	a.sync.flush()
	const d = host.log[0].data
	assert.deepEqual(d.f?.rect, rect(3, 2, 3, 2))
	assert.equal(d.a, undefined)
	assert.equal(d.n, undefined)
})

test("a guest holds the messages before the host's map and drops those already in it", () => {
	const g = new Ground()
	const s = new ChunkDataSync({ send: async () => undefined })
	s.wait()
	const zone = (x: number, id: number): ChunkDataData => ({ id: 1, a: { rect: rect(x, 0, x, 0), b: bytesToBase64(new Uint8Array(Uint32Array.of(id).buffer)) } })
	s.receive(4, 1, zone(0, 5), 2)
	s.receive(6, 3, zone(1, 6), 2)
	s.bind(g, 5)
	assert.equal(g.areaIds[0], 0)
	assert.equal(g.areaIds[1], 6)
	s.receive(7, 1, zone(2, 7), 2)
	assert.equal(g.areaIds[2], 7)
})

test('a message that does not fit the map is ignored whole', () => {
	const g = new Ground()
	const s = new ChunkDataSync({ send: async () => undefined })
	s.bind(g, 0)
	const flags = { rect: rect(0, 0, 0, 0), b: bytesToBase64(Uint8Array.of(2)) }
	s.receive(1, 3, { id: 1, f: flags, a: { rect: rect(0, 0, 0, 0), b: bytesToBase64(Uint8Array.of(1)) } }, 2)
	s.receive(2, 3, { id: 2, f: { rect: rect(0, 0, SIDE, 0), b: bytesToBase64(new Uint8Array(SIDE + 1)) } }, 2)
	s.receive(3, 3, { id: 3, n: { rect: rect(0, 0, 1, 0), b: 7 as unknown as string } }, 2)
	s.receive(4, 3, { id: 4 }, 2)
	assert.equal(g.touches.length, 0)
	assert.equal(g.chunkFlags[0], 0)
})

test('a failed send drops its values from the unacknowledged ones', async () => {
	let failed = 0
	const g = new Ground()
	const s = new ChunkDataSync({ send: () => Promise.reject(new Error('gone')), failed: () => failed++ })
	s.bind(g, 0)
	g.zone(rect(0, 0, 0, 0), 9, 2)
	s.flush()
	await Promise.resolve()
	await Promise.resolve()
	assert.equal(failed, 1)
	assert.equal(s.unacknowledged, 0)
})

test("the Biome Brush's cells reach the other member, and two strokes at once end as the host order does (#1036)", () => {
	const host = new Host()
	const a = host.member(1, new Ground())
	const b = host.member(2, new Ground())
	a.ground.biome(rect(2, 2, 6, 6), 1)
	a.sync.flush()
	assert.deepEqual(Object.keys(host.log[0].data).sort(), ['id', 'm'])
	assert.deepEqual(host.log[0].data.m?.rect, rect(2, 2, 6, 6))
	b.ground.biome(rect(5, 5, 9, 9), 2)
	b.ground.cells(rect(0, 0, 1, 1), 1)
	b.sync.flush()
	host.deliver(a)
	host.deliver(b)
	same(a.ground, b.ground)
	same(a.ground, hostOrder(host.log))
	assert.equal(a.ground.biomeMap[5 * S + 5], 2)
	assert.equal(a.ground.biomeMap[2 * S + 2], 1)
	// The apply marks the cells for the session, but takes the mark itself, so nothing goes back.
	assert.deepEqual(a.ground.biomeTouches.at(-1), rect(5, 5, 9, 9))
	const sent = host.log.length
	a.sync.flush()
	b.sync.flush()
	assert.equal(host.log.length, sent)
	// An undo writes the cells back and touches them: it goes out like the stroke.
	a.ground.biome(rect(2, 2, 6, 6), 0)
	a.ground.biome(rect(5, 5, 6, 6), 2)
	a.sync.flush()
	host.deliver(b)
	host.deliver(a)
	same(a.ground, b.ground)
	assert.equal(b.ground.biomeMap[2 * S + 2], 0)
})
