// Run with: bun test tests/probeRetry.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstAttempt, noRetryReason } from '../probes/retry.mjs'

test("a timeout of the probe's body and an error in its own code are not retried (#628)", () => {
	assert.match(noRetryReason({ timedOut: true, error: 'timed out after 300 s' }), /timed out/)
	assert.match(noRetryReason({ error: 'ReferenceError: foo is not defined' }), /own code/)
	assert.match(noRetryReason({ error: 'SyntaxError: Unexpected token' }), /own code/)
})

test('a lost page at setup, ok: false, a page error and other throws keep the retry (#388)', () => {
	assert.equal(noRetryReason({ error: 'timed out after 90 s' }), '', "the page's setup: the retry gets past a half-booted app")
	assert.equal(noRetryReason({}), '')
	assert.equal(noRetryReason({ error: "TypeError: Cannot read properties of null (reading 'x')" }), '')
	assert.equal(noRetryReason({ error: 'timed out waiting for the tile (no loads pending)' }), '')
	assert.equal(noRetryReason({ error: "SyntaxError: The requested module '/src/lib/x.ts' does not provide an export named 'y'" }), '', 'a module Vite was rebuilding')
	assert.equal(noRetryReason({ error: `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON` }), '', 'an error page read as JSON')
})

test("a retried probe's line keeps the first attempt's own numbers, less its name, ok and profile (#624)", () => {
	const first = { probe: 'release-models', ok: false, textures: 31, margin: 4, step: 'models released', profile: ['12 / 40 ms frame Engine.ts:1'] }
	assert.deepEqual(firstAttempt(first), { textures: 31, margin: 4, step: 'models released' })
})
