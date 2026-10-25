import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ThumbQueue } from '../src/lib/wow/thumbQueue.ts'

/** Work that finishes only when the test releases it, recording the order keys were started in. */
function harness(maxRunning: number) {
	const started: string[] = []
	const release = new Map<string, (ok: boolean) => void>()
	const q = new ThumbQueue<string>(
		(key) =>
			new Promise<string>((res, rej) => {
				started.push(key)
				release.set(key, (ok) => (ok ? res('url:' + key) : rej(new Error('no'))))
			}),
		maxRunning,
	)
	const settle = () => new Promise((r) => setTimeout(r, 0))
	return { q, started, release: (k: string, ok = true) => release.get(k)!(ok), settle }
}

test('the nearest tiles start first, with the running limit', async () => {
	const { q, started, release, settle } = harness(1)
	const ready: string[] = []
	q.request(
		'far',
		300,
		(u) => ready.push(u),
		() => {},
	)
	q.request(
		'near',
		10,
		(u) => ready.push(u),
		() => {},
	)
	q.request(
		'mid',
		100,
		(u) => ready.push(u),
		() => {},
	)
	assert.deepEqual(started, ['far']) // the first request started at once; the rest wait for a slot
	release('far')
	await settle()
	assert.deepEqual(started, ['far', 'near'])
	release('near')
	await settle()
	release('mid')
	await settle()
	assert.deepEqual(ready, ['url:far', 'url:near', 'url:mid'])
})

test('a key is worked once: a second request joins it and improves its priority', async () => {
	const { q, started, release, settle } = harness(1)
	const got: string[] = []
	q.request(
		'busy',
		0,
		() => {},
		() => {},
	)
	q.request(
		'a',
		50,
		(u) => got.push('a1 ' + u),
		() => {},
	)
	q.request(
		'b',
		20,
		(u) => got.push('b ' + u),
		() => {},
	)
	q.request(
		'a',
		5,
		(u) => got.push('a2 ' + u),
		() => {},
	)
	release('busy')
	await settle()
	assert.deepEqual(started, ['busy', 'a'])
	release('a')
	await settle()
	assert.deepEqual(got, ['a1 url:a', 'a2 url:a'])
	// A request after the work started or finished gets the kept result.
	q.request(
		'a',
		0,
		(u) => got.push('a3 ' + u),
		() => {},
	)
	await settle()
	assert.equal(got[2], 'a3 url:a')
	assert.deepEqual(started, ['busy', 'a', 'b']) // b took the freed slot; a was not started again
})

test('withdrawing the last request drops a pending key, unless the grid prefetches it', async () => {
	const { q, started, release, settle } = harness(1)
	q.request(
		'busy',
		0,
		() => {},
		() => {},
	)
	const cancel = q.request(
		'gone',
		1,
		() => {},
		() => {},
	)
	q.prefetch([{ key: 'kept', priority: 1e4 }])
	const cancelKept = q.request(
		'kept',
		2,
		() => {},
		() => {},
	)
	cancel()
	cancelKept()
	assert.equal(q.pendingCount, 1)
	release('busy')
	await settle()
	assert.deepEqual(started, ['busy', 'kept'])
})

test('prefetch replaces its set and never outranks a tile on screen', async () => {
	const { q, started, release, settle } = harness(1)
	q.request(
		'busy',
		0,
		() => {},
		() => {},
	)
	q.prefetch([
		{ key: 'p1', priority: 1e4 },
		{ key: 'p2', priority: 1e4 + 1 },
	])
	q.prefetch([{ key: 'p2', priority: 1e4 }])
	q.request(
		'tile',
		400,
		() => {},
		() => {},
	)
	assert.equal(q.pendingCount, 2)
	release('busy')
	await settle()
	release('tile')
	await settle()
	assert.deepEqual(started, ['busy', 'tile', 'p2'])
})

test('only the most recently asked results are kept, and an evicted one is released', async () => {
	const started: string[] = []
	const evicted: string[] = []
	const q = new ThumbQueue<string>(
		(key) => {
			started.push(key)
			return Promise.resolve('url:' + key)
		},
		3,
		2,
		(v) => evicted.push(v),
	)
	const settle = () => new Promise((r) => setTimeout(r, 0))
	for (const k of ['a', 'b'])
		q.request(
			k,
			0,
			() => {},
			() => {},
		)
	await settle()
	q.request(
		'a',
		0,
		() => {},
		() => {},
	) // a is now newer than b
	q.request(
		'c',
		0,
		() => {},
		() => {},
	)
	await settle()
	assert.equal(q.keptCount, 2)
	assert.deepEqual(evicted, ['url:b'])
	q.request(
		'b',
		0,
		() => {},
		() => {},
	) // forgotten, so it is worked again
	await settle()
	assert.deepEqual(started, ['a', 'b', 'c', 'b'])
	assert.deepEqual(evicted, ['url:b', 'url:a'])
})

test('a failed key reports the error and can be asked for again', async () => {
	const { q, started, release, settle } = harness(2)
	let errors = 0
	q.request(
		'bad',
		0,
		() => {},
		() => errors++,
	)
	release('bad', false)
	await settle()
	assert.equal(errors, 1)
	q.request(
		'bad',
		0,
		() => {},
		() => errors++,
	)
	assert.deepEqual(started, ['bad', 'bad'])
})
