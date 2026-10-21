// Run with: bun test tests/regionKey.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cachedPending, contentKey, type PendingAnswer } from '../src/lib/io/regionKey.ts'

test('the same content gives the same key, and any changed byte another', () => {
	const heights = new Float32Array([1, 2, 3, 4.5])
	const weights = new Uint8Array([0, 255, 7, 9, 11])
	const key = contentKey([heights, weights, '["a","b"]', null])
	assert.equal(contentKey([new Float32Array(heights), new Uint8Array(weights), '["a","b"]', null]), key)
	assert.match(key, /^[0-9a-f]{16}$/)
	const raised = new Float32Array(heights)
	raised[2] += 0.01
	assert.notEqual(contentKey([raised, weights, '["a","b"]', null]), key)
	const repainted = new Uint8Array(weights)
	repainted[4] = 12
	assert.notEqual(contentKey([heights, repainted, '["a","b"]', null]), key)
	assert.notEqual(contentKey([heights, weights, '["a","c"]', null]), key)
})

test('a byte moved from one part to the next, or an absent array given, changes the key', () => {
	assert.notEqual(contentKey([new Uint8Array([1, 2]), new Uint8Array([3])]), contentKey([new Uint8Array([1]), new Uint8Array([2, 3])]))
	assert.notEqual(contentKey([new Uint8Array([]), 'x']), contentKey([null, 'x']))
})

test('an unaligned view is read by its own bytes, as an aligned copy of them is', () => {
	const buf = new Uint8Array([9, 1, 2, 3, 4, 5, 6, 7, 8])
	const view = new Uint8Array(buf.buffer, 1, 8)
	assert.equal(contentKey([view]), contentKey([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]))
})

test('a remembered RegionPending answer holds until the history moves to another fingerprint (#531)', () => {
	let asked = 0
	const key = (k: string) => () => {
		asked++
		return k
	}
	assert.equal(cachedPending(null, 3, key('a')), null)
	const answer: PendingAnswer = { key: 'a', changes: 3, files: 2 }
	// The same step: no fingerprint worked out.
	assert.equal(cachedPending(answer, 3, key('a')), 2)
	assert.equal(asked, 0)
	// A step that leaves the fingerprint (a spawn edit, an undo back): still the answer, now at that step.
	assert.equal(cachedPending(answer, 5, key('a')), 2)
	assert.equal(asked, 1)
	assert.equal(answer.changes, 5)
	assert.equal(cachedPending(answer, 5, key('a')), 2)
	assert.equal(asked, 1)
	// An edit Compile would write: ask again.
	assert.equal(cachedPending(answer, 6, key('b')), null)
	assert.equal(answer.changes, 5)
})
