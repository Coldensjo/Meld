// Run with: bun test tests/biomeBrushAddUndo.test.ts
// The Biome Brush's Add biome step in a shared session (#1049): undoing it drops only the biome the stroke
// added, so a biome another member added meanwhile stays in the map's list.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { newBiome, withoutAddedBiome } from '../src/lib/terrain/biome.ts'

const names = (l: { name: string }[] | null) => l?.map((b) => b.name)

test('the biome goes when it is the last and no cell names it', () => {
	assert.deepEqual(names(withoutAddedBiome([newBiome('A')], Uint8Array.of(0, 0), 'A')), [])
	assert.deepEqual(names(withoutAddedBiome([newBiome('A'), newBiome('B')], Uint8Array.of(1, 0), 'B')), ['A'])
})

test('it stays when another member added a biome after it, or a cell still names it', () => {
	assert.equal(withoutAddedBiome([newBiome('A'), newBiome('B')], Uint8Array.of(0, 0), 'A'), null)
	assert.equal(withoutAddedBiome([newBiome('A'), newBiome('B')], Uint8Array.of(1, 2), 'B'), null)
	assert.equal(withoutAddedBiome([newBiome('A')], Uint8Array.of(0), 'Z'), null)
})
