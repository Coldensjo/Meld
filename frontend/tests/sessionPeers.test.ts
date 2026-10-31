// Run with: bun test tests/sessionPeers.test.ts
// A shared session's page side (lib/session/peers.ts, #1000): the members that joined or left, the
// status bar's chip, and the send queue that keeps the page's sends in order.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { changeLine, peerChanges, peersLabel, peersTitle, serialQueue } from '../src/lib/session/peers.ts'

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
