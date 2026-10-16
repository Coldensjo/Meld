// Run with: node --import ./tests/register.mjs --test tests/frameLimit.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frameDue } from '../src/lib/engine/frameLimit.ts'

test('an FPS limit lets a frame through once its interval has passed, with a little slack', () => {
	assert.equal(frameDue(10, 0, 0), true, 'no limit')
	assert.equal(frameDue(16.7, 0, 60), true, 'a 60 Hz frame under a 60 limit')
	assert.equal(frameDue(16.7, 0, 30), false, 'a 60 Hz frame under a 30 limit waits')
	assert.equal(frameDue(33.4, 0, 30), true)
})
