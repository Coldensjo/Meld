// Run with: bun test tests/sessionPathApplies.test.ts
// The paths' last applies in a shared session (lib/session/pathApplies.ts, #1022): two members apply,
// undo and re-apply paths through a scripted host that numbers every message and delivers it to everyone,
// the sender too, when the test says; each member must end knowing who has each path's live apply.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { KIND_PATH_APPLY, PathApplySync, adoptNotes, notesOf, type PathApplyData, type PathApplyMap } from '../src/lib/session/pathApplies.ts'
import type { PathApply, PathRecord } from '../src/lib/tools/pathRecord.ts'

const RECORD: PathRecord = { heights: null, paint: null, liquids: null, models: null }

/** A live apply, as the Path tool keeps one. */
function applyOf(): PathApply {
	const a: PathApply = { record: RECORD, cmd: { label: 'Apply', undo: () => (a.live = false), redo: () => (a.live = true) }, live: true }
	return a
}

interface Msg {
	seq: number
	from: number
	data: PathApplyData
}

class Host {
	seq = 0
	inbox = new Map<number, Msg[]>()
	member(id: number, map: PathApplyMap = { own: new Map(), others: new Map() }) {
		this.inbox.set(id, [])
		const sends: PathApplyData[] = []
		const sync = new PathApplySync({
			nameOf: (n) => `Member ${n}`,
			send: async (data) => {
				sends.push(data)
				const m = { seq: ++this.seq, from: id, data: JSON.parse(JSON.stringify(data)) as PathApplyData }
				for (const q of this.inbox.values()) q.push(m)
			},
		})
		sync.bind(map, 0)
		return { id, map, sync, sends }
	}
	deliver(m: { id: number; sync: PathApplySync }) {
		const q = this.inbox.get(m.id)!
		for (const msg of q.splice(0)) m.sync.receive(msg.seq, msg.from, msg.data, m.id)
	}
}

test('the kind', () => {
	assert.equal(KIND_PATH_APPLY, 'pathapply')
})

test('an apply goes out and the other member notes who has it; an undo takes the note away', () => {
	const host = new Host()
	const a = host.member(1)
	const b = host.member(2)
	const ap = applyOf()
	a.map.own.set(7, ap)
	a.sync.flush()
	assert.deepEqual(a.sends, [{ id: 1, on: [7], off: [] }])
	a.sync.flush()
	assert.equal(a.sends.length, 1, 'nothing changed: nothing sent')
	host.deliver(a)
	host.deliver(b)
	assert.equal(a.sync.unacknowledged, 0)
	assert.deepEqual(b.map.others.get(7), { by: 1, name: 'Member 1' })
	assert.equal(a.map.others.size, 0)
	b.sync.flush()
	assert.equal(b.sends.length, 0, 'the note is not sent back')
	ap.cmd.undo()
	a.sync.flush()
	assert.deepEqual(a.sends[1], { id: 2, on: [], off: [7] })
	host.deliver(b)
	assert.equal(b.map.others.size, 0)
})

test("another member's re-apply takes mine out of my map's record", () => {
	const host = new Host()
	const a = host.member(1)
	const b = host.member(2)
	// A guest that opened the host's map has the host's applies as its own, live, unsent.
	const mine = applyOf()
	const theirs = applyOf()
	a.map.own.set(3, mine)
	b.map.own.set(3, theirs)
	a.sync.bind(a.map, 0)
	b.sync.bind(b.map, 0)
	// B applies the path again: a fresh apply takes the one it had back.
	const again = applyOf()
	theirs.live = false
	b.map.own.set(3, again)
	b.sync.flush()
	assert.deepEqual(b.sends, [{ id: 1, on: [3], off: [] }])
	host.deliver(a)
	host.deliver(b)
	assert.equal(mine.live, false, "A's record no longer holds what is under B's apply")
	assert.deepEqual(a.map.others.get(3), { by: 2, name: 'Member 2' })
	a.sync.flush()
	assert.equal(a.sends.length, 0, 'losing it to B is not sent as an off')
	// B undoes: the note goes; A's own record stays out (B's undo put back what B's record held).
	again.live = false
	b.map.own.set(3, theirs)
	b.sync.flush()
	host.deliver(a)
	assert.equal(a.map.others.has(3), false)
})

test('two members applying one path at once: the later in the host order wins on both', () => {
	const host = new Host()
	const a = host.member(1)
	const b = host.member(2)
	const pa = applyOf()
	const pb = applyOf()
	a.map.own.set(5, pa)
	b.map.own.set(5, pb)
	a.sync.flush()
	b.sync.flush()
	host.deliver(a)
	host.deliver(b)
	// The host has A's first: B's is the latest.
	assert.equal(pa.live, false)
	assert.deepEqual(a.map.others.get(5), { by: 2, name: 'Member 2' })
	assert.equal(pb.live, true, "A's apply came before mine, so mine stands")
	assert.equal(b.map.others.has(5), false)
})

test('a guest holds the messages until its map opens, and applies those after the handoff', () => {
	const host = new Host()
	const a = host.member(1)
	const sends: PathApplyData[] = []
	const sync = new PathApplySync({ nameOf: (n) => `Member ${n}`, send: async (d) => void sends.push(d) })
	sync.wait()
	host.inbox.set(2, [])
	a.map.own.set(1, applyOf())
	a.sync.flush()
	a.map.own.set(2, applyOf())
	a.sync.flush()
	const map: PathApplyMap = { own: new Map(), others: new Map() }
	for (const m of host.inbox.get(2)!.splice(0)) sync.receive(m.seq, m.from, m.data, 2)
	// The handoff was made after message 1: path 1's apply came in the map, as the host's.
	sync.bind(map, 1)
	assert.deepEqual([...map.others.keys()], [2])
	assert.equal(sends.length, 0)
})

test('the host sends its notes of a third member applies in the handoff and a guest that joins takes them', () => {
	const host: PathApplyMap = { own: new Map(), others: new Map() }
	host.others.set(5, { by: 2, name: 'Member 2' })
	host.others.set(6, { by: 3, name: 'Member 3' })
	const notes = notesOf(host.others)
	assert.deepEqual(notes, [
		{ id: 5, by: 2 },
		{ id: 6, by: 3 },
	])
	assert.equal(notesOf(new Map()), undefined)
	const guest: PathApplyMap = { own: new Map(), others: new Map() }
	guest.own.set(9, applyOf())
	// Path 9 came with the map as the host's own apply; the guest's own id (3) is not noted; junk is ignored.
	const wire = JSON.parse(JSON.stringify([...(notes ?? []), { id: 9, by: 2 }, { id: 'x', by: 2 }, null]))
	adoptNotes(guest, wire, 3, (n) => `Member ${n}`)
	assert.deepEqual([...guest.others], [[5, { by: 2, name: 'Member 2' }]])
	adoptNotes(guest, undefined, 3, (n) => `Member ${n}`)
	assert.equal(guest.others.size, 1)
})
