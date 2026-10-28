// Run with: bun test tests/inputsKey.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { InputsKey } from '../src/lib/tools/inputsKey.ts'

const run = (k: InputsKey, vals: (string | number | boolean | object)[]) => {
	k.begin()
	for (const v of vals) k.add(v)
	return k.changed()
}

test('the first inputs are a change, the same ones again are not', () => {
	const k = new InputsKey()
	assert.equal(run(k, ['a', 1, true]), true)
	assert.equal(run(k, ['a', 1, true]), false)
})

test('a changed value, a longer or a shorter list is a change', () => {
	const k = new InputsKey()
	run(k, ['a', 1, true])
	assert.equal(run(k, ['a', 2, true]), true)
	assert.equal(run(k, ['a', 2, true, 'x']), true)
	assert.equal(run(k, ['a', 2, true]), true)
	assert.equal(run(k, ['a', 2, true]), false)
})

test('objects compare by identity, and reset forgets the inputs', () => {
	const k = new InputsKey()
	const o = {}
	run(k, [o])
	assert.equal(run(k, [o]), false)
	assert.equal(run(k, [{}]), true)
	k.reset()
	assert.equal(run(k, [o]), true)
})
