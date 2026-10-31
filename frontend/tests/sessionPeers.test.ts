// Run with: bun test tests/sessionPeers.test.ts
// A shared session's page side (lib/session/peers.ts, #1000): the members that joined or left, the
// status bar's chip, and the send queue that keeps the page's sends in order.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { PartJoiner, changeLine, editGen, peerChanges, peersLabel, peersTitle, serialQueue, splitText } from '../src/lib/session/peers.ts'

const ann = { id: 1, name: 'Ann' }
const bob = { id: 2, name: 'Bob' }
const cy = { id: 3, name: 'Cy' }

test('the members that joined and left between two lists', () => {
	const c = peerChanges([ann, bob], [ann, cy])
	assert.deepEqual(c.joined, [cy])
	assert.deepEqual(c.left, [bob])
	assert.equal(changeLine(c.joined, c.left), 'Cy joined the session; Bob left the session')
	assert.equal(changeLine([], []), '')
})

test('the chip names the others, and its tooltip everyone', () => {
	assert.equal(peersLabel([ann], 1), 'Session: waiting for others')
	assert.equal(peersLabel([ann, bob, cy], 2), 'Session: Ann, Cy')
	assert.equal(peersTitle([ann, bob], 2), 'Ann (host)\nBob (you)')
	assert.equal(peersLabel([ann, { id: 4, name: '' }], 1), 'Session: Member 4')
})

test('the queue runs each send after the last has finished, past a failure', async () => {
	const q = serialQueue()
	const order: string[] = []
	const slow =
		(id: string, ms: number, fail = false) =>
		() =>
			new Promise<string>((ok, bad) =>
				setTimeout(() => {
					order.push(id)
					if (fail) bad(new Error(id))
					else ok(id)
				}, ms),
			)
	const a = q(slow('a', 30))
	const b = q(slow('b', 1, true))
	const c = q(slow('c', 1))
	assert.equal(await a, 'a')
	await assert.rejects(b)
	assert.equal(await c, 'c')
	assert.deepEqual(order, ['a', 'b', 'c'])
})

test('a map too large for one message is cut into parts and joined again (#1010)', () => {
	assert.deepEqual(splitText('abcdefg', 3), ['abc', 'def', 'g'])
	assert.deepEqual(splitText('abc', 3), ['abc'])
	assert.deepEqual(splitText('', 3), [''])
	const j = new PartJoiner()
	const parts = splitText('{"seq":4,"map":{}}', 5)
	const got = parts.map((text, part) => j.add({ part, parts: parts.length, text }))
	assert.deepEqual(got.slice(0, -1), new Array(parts.length - 1).fill(null))
	assert.equal(got.at(-1), '{"seq":4,"map":{}}')
	// A new map's first part drops one half received.
	assert.equal(j.add({ part: 0, parts: 2, text: 'xx' }), null)
	assert.equal(j.add({ part: 0, parts: 2, text: 'ab' }), null)
	assert.equal(j.add({ part: 1, parts: 2, text: 'cd' }), 'abcd')
	assert.throws(() => j.add({ part: 2, parts: 2, text: '' }))
})

test('the map an edit message was made against: its g, 0 when absent or not a count (#1008)', () => {
	assert.equal(editGen({ id: 1, g: 2 }), 2)
	assert.equal(editGen({ id: 1 }), 0)
	assert.equal(editGen(null), 0)
	assert.equal(editGen({ g: '2' }), 0)
	assert.equal(editGen({ g: 1.5 }), 0)
	assert.equal(editGen({ g: -1 }), 0)
})
