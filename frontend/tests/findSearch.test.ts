// Run with: bun test tests/findSearch.test.ts
// The shared find-field helpers (#594): the debounced search keeps only the latest query's answer, and
// the number-input readers.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'

const { createSearch } = await import('../src/lib/ui/search.svelte.ts')
const { clamp, num, numOr0 } = await import('../src/lib/ui/inputs.ts')

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A lookup that answers each query after `slow[q]` ms (0 by default), counting its calls. */
function lookup(slow: Record<string, number> = {}) {
	const calls: string[] = []
	const run = async (q: string) => {
		calls.push(q)
		await wait(slow[q] ?? 0)
		if (q === 'bad') throw new Error('no table')
		return [q]
	}
	return { calls, run }
}

test('typing runs one search, after the delay since the last key', async () => {
	const l = lookup()
	const s = createSearch(l.run, { empty: [] as string[], delay: 20 })
	s.set('w')
	s.set('wo')
	s.set('wol')
	assert.deepEqual(l.calls, [])
	await wait(40)
	assert.deepEqual(l.calls, ['wol'])
	assert.deepEqual(s.results, ['wol'])
	assert.equal(s.searching, false)
})

test('a slow answer to an older query does not overwrite the newer one', async () => {
	const l = lookup({ old: 40 })
	const s = createSearch(l.run, { empty: [] as string[], delay: 0 })
	s.set('old')
	await wait(5)
	assert.equal(s.searching, true)
	s.set('new')
	await wait(60)
	assert.deepEqual(s.results, ['new'])
	assert.equal(s.searching, false)
})

test('null clears the results at once and drops a search in flight', async () => {
	const l = lookup({ a: 20 })
	const s = createSearch(l.run, { empty: [] as string[], delay: 0 })
	s.set('a')
	await wait(5)
	s.set(null)
	assert.deepEqual(s.results, [])
	assert.equal(s.searching, false)
	await wait(30)
	assert.deepEqual(s.results, [])
})

test('the same query asked again (a version bump) searches again', async () => {
	const l = lookup()
	const s = createSearch(l.run, { empty: [] as string[], delay: 0 })
	s.set('a')
	await wait(5)
	s.set('a')
	await wait(5)
	assert.deepEqual(l.calls, ['a', 'a'])
})

test('an error goes to error and onError, and the next answer clears it', async () => {
	const l = lookup()
	const seen: string[] = []
	const s = createSearch(l.run, { empty: [] as string[], delay: 0, onError: (e) => seen.push(String(e)) })
	s.set('bad')
	await wait(5)
	assert.match(s.error, /no table/)
	assert.equal(seen.length, 1)
	s.set('ok')
	await wait(5)
	assert.equal(s.error, '')
	assert.deepEqual(s.results, ['ok'])
})

test('a per-call delay overrides the default (0 for a local list)', async () => {
	const l = lookup()
	const s = createSearch(l.run, { empty: [] as string[], delay: 1000 })
	s.set('x', 0)
	await wait(5)
	assert.deepEqual(s.results, ['x'])
})

const input = (value: string) => ({ target: { value } }) as unknown as Event

test('num reads a field as a float, NaN when it is not a number; numOr0 gives 0', () => {
	assert.equal(num(input('1.5')), 1.5)
	assert.ok(Number.isNaN(num(input(''))))
	assert.equal(numOr0(input('7')), 7)
	assert.equal(numOr0(input('')), 0)
	assert.equal(numOr0(input('abc')), 0)
})

test('clamp keeps a value to its range, and an empty field to the low end', () => {
	assert.equal(clamp(5, 0, 10), 5)
	assert.equal(clamp(-1, 0, 10), 0)
	assert.equal(clamp(11, 0, 10), 10)
	assert.equal(clamp(NaN, 2, 10), 2)
	assert.equal(clamp(Infinity, 2, 10), 2)
})
