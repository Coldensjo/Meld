// Run with: bun test tests/sessionPresence.test.ts
// Presence in a shared session (lib/session/presence.ts, #1004): the message a member sends, the key that
// tells whether it changed, the latest presence kept per member, and the members' colours.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { PresenceBook, brushOf, makePresence, memberColor, presenceKey, readPresence } from '../src/lib/session/presence.ts'

const view = (x: number) => ({ target: { x, y: 2, z: 3 }, yaw: 0.5, pitch: 0.75, distance: 90 })
const cam = { pos: { x: 10.004, y: 50, z: 20 }, dir: { x: 0, y: -0.6, z: 0.8 } }

test('a presence rounds its numbers, so a still camera sends the same key', () => {
	const a = makePresence(cam, view(1), 'sculpt', { x: 5, z: 6, r: 12, square: false })
	const b = makePresence({ ...cam, pos: { ...cam.pos, x: 10.001 } }, view(1), 'sculpt', { x: 5, z: 6, r: 12, square: false })
	assert.deepEqual(a.cam, [10, 50, 20])
	assert.deepEqual(a.dir, [0, -0.6, 0.8])
	assert.equal(presenceKey(a), presenceKey(b))
	assert.notEqual(presenceKey(a), presenceKey(makePresence(cam, view(1), 'sculpt', null)))
	assert.notEqual(presenceKey(a), presenceKey(makePresence(cam, view(2), 'sculpt', { x: 5, z: 6, r: 12, square: false })))
	assert.equal(presenceKey(null), 'away')
})

test('a presence reads back, its brush too, and a broken or away one is null', () => {
	const p = makePresence(cam, view(1), 'paint', { x: 5, z: 6, r: 12, square: true })
	const back = readPresence(JSON.parse(JSON.stringify({ ...p, g: 2 })))
	assert.ok(back)
	assert.deepEqual(brushOf(back), { x: 5, z: 6, r: 12, square: true })
	assert.equal(back.tool, 'paint')
	assert.equal(brushOf(makePresence(cam, view(1), 'select', null)), null)
	assert.equal(readPresence({}), null)
	assert.equal(readPresence(null), null)
	assert.equal(readPresence({ ...p, cam: [1, 2] }), null)
	assert.equal(readPresence({ ...p, dir: undefined }), null)
	assert.equal(readPresence({ ...p, b: [1, 2, 0, 0] }), null)
})

test('the book keeps the latest per member and drops the away, the gone and the other map', () => {
	const book = new PresenceBook()
	const at = (x: number) => makePresence({ pos: { x, y: 0, z: 0 }, dir: cam.dir }, view(x), 'sculpt', null)
	book.receive(2, at(1))
	book.receive(2, at(5))
	book.receive(3, at(7), 1)
	assert.equal(book.size, 2)
	assert.equal(book.get(2)?.cam[0], 5)
	const v = book.version
	book.receive(2, {})
	assert.equal(book.get(2), undefined)
	assert.ok(book.version > v)
	book.receive(2, at(1))
	book.keep([1, 3])
	assert.equal(book.get(2), undefined)
	book.keepGen(0)
	assert.equal(book.size, 0)
	book.receive(4, at(1))
	book.clear()
	assert.equal(book.size, 0)
})

test('each member has a colour of its own, the same on every Meld', () => {
	const colors = new Set(Array.from({ length: 16 }, (_, i) => memberColor(i + 1)))
	assert.equal(colors.size, 16)
	assert.equal(memberColor(17), memberColor(1))
	assert.match(memberColor(1), /^#[0-9a-f]{6}$/)
})
