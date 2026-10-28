// Run with: bun test tests/loadProgress.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { beginLoad, endLoad, readLoad, type LoadBatch } from '../src/lib/wow/loadProgress.ts'

const read = () => readLoad({} as LoadBatch)

test('a batch counts its reads, its failures and the latest file, and the next batch starts over', () => {
	beginLoad('model', 'a.m2', 100)
	beginLoad('texture', 'b.blp', 110)
	let b = read()
	assert.deepEqual([b.started, b.done, b.since, b.kind, b.path], [2, 0, 100, 'texture', 'b.blp'])
	endLoad(false)
	endLoad(true)
	b = read()
	assert.deepEqual([b.started, b.done, b.failed, b.since], [2, 2, 1, 0], 'idle once every read ended')
	beginLoad('model', 'c.m2', 500)
	b = read()
	assert.deepEqual([b.started, b.done, b.failed, b.since], [1, 0, 0, 500], 'a new batch')
	endLoad(false)
})
