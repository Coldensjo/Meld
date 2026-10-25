// Run with: bun test tests/sheen.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySheen, sheenPath } from '../src/lib/terrain/sheen.ts'

test('a tileset texture names its sheen mask as its _s twin', () => {
	assert.equal(sheenPath('Tileset\Durotar\DurotarRock.blp'), 'Tileset\Durotar\DurotarRock_s.blp')
	assert.equal(sheenPath('Tileset\X\Y.BLP'), 'Tileset\X\Y_s.blp')
})

test('the sheen mask goes into the alpha, and is 0 without a twin', () => {
	const px = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255])
	applySheen(px, new Uint8Array([0, 0, 0, 77, 0, 0, 0, 200]))
	assert.deepEqual([...px], [10, 20, 30, 77, 40, 50, 60, 200])
	applySheen(px, null)
	assert.deepEqual([...px], [10, 20, 30, 0, 40, 50, 60, 0])
})
