// Run with: bun test tests/texName.test.ts
// The texture short name every texture picker and chip shows (lib/wow/texName.ts, #593).
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { texName } from '../src/lib/wow/texName.ts'

test('a client path loses its folder and its .blp extension', () => {
	assert.equal(texName('Tileset\\Elwynn\\ElwynnGrassBase.blp'), 'ElwynnGrassBase')
	assert.equal(texName('Tileset/Elwynn/ElwynnGrassBase.BLP'), 'ElwynnGrassBase')
	assert.equal(texName('ElwynnGrassBase.blp'), 'ElwynnGrassBase')
})

test('a colour entry and an empty path come back as they are', () => {
	assert.equal(texName('#6a8f3c'), '#6a8f3c')
	assert.equal(texName(''), '')
})
