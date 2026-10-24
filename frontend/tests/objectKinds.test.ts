// Run with: bun test tests/objectKinds.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OBJECT_KINDS } from '../src/lib/cubes/world.ts'

test('OBJECT_KINDS has as many kinds as the Go worldfile knows', () => {
	const go = readFileSync(new URL('../../internal/worldfile/worldfile.go', import.meta.url), 'utf8')
	const m = /ObjectKindCount\s*=\s*(\d+)/.exec(go)
	assert.ok(m)
	assert.equal(OBJECT_KINDS.length as number, Number(m[1]))
})

test('OBJECT_KINDS ends with the teleporter, id 4', () => {
	assert.equal(OBJECT_KINDS[4], 'teleporter')
})
