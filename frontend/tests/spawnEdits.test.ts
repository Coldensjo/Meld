// Run with: bun test tests/spawnEdits.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SpawnChanges } from '../src/lib/world/spawnChanges.ts'

type S = { x: number }

function setup() {
	const spawns = new Map<string, S>([
		['a', { x: 1 }],
		['b', { x: 2 }],
	])
	const originals = new Map<string, S>(Object.entries({ a: { x: 1 }, b: { x: 2 } }))
	const created = new Set<string>()
	const c = new SpawnChanges<S>()
	const settle = () =>
		c.settle(
			(k) => spawns.get(k),
			(k) => originals.get(k),
			(k) => created.has(k),
		)
	return { spawns, originals, created, c, settle }
}

test('only marked spawns are compared, and one set back drops out', () => {
	const { spawns, c, settle } = setup()
	spawns.get('a')!.x = 5
	settle()
	assert.equal(c.size, 0) // not marked yet, so not looked at
	c.mark('a')
	settle()
	assert.equal(c.size, 1)
	assert.ok(c.has('a'))
	spawns.get('a')!.x = 1
	c.mark('a')
	settle()
	assert.equal(c.size, 0)
})

test('created spawns count, removed ones do not, clear forgets', () => {
	const { spawns, created, c, settle } = setup()
	created.add('b')
	c.mark('b')
	settle()
	assert.equal(c.size, 1)
	spawns.delete('b')
	c.mark('b')
	settle()
	assert.equal(c.size, 0)
	created.add('a')
	c.mark('a')
	settle()
	c.clear()
	assert.equal(c.size, 0)
})
