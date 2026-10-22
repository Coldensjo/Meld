// Run with: bun test tests/instanceHit.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type * as THREE from 'three'
import { firstPick, hitId } from '../src/lib/world/instanceHit.ts'

function hit(ids: number[] | undefined, instanceId: number | undefined, distance: number): THREE.Intersection {
	return { object: { userData: ids ? { ids } : {} }, instanceId, distance } as unknown as THREE.Intersection
}

test('a hit names the id of its instance', () => {
	assert.equal(hitId(hit([4, 9], 1, 3)), 9)
})

test('a hit off an instance, past the ids or on a mesh without ids names nothing', () => {
	assert.equal(hitId(hit([4, 9], undefined, 3)), undefined)
	assert.equal(hitId(hit([4, 9], 5, 3)), undefined)
	assert.equal(hitId(hit(undefined, 0, 3)), undefined)
})

test('a pick goes on past a stale instance to the next object along the ray (#524)', () => {
	const hits = [hit([4], 2, 1), hit([4, 9], undefined, 2), hit([4, 9], 1, 5)]
	assert.deepEqual(firstPick(hits), { id: 9, distance: 5 })
})

test('a pick with no object along the ray gives nothing', () => {
	assert.equal(firstPick([]), null)
	assert.equal(firstPick([hit([4], 3, 1)]), null)
})
