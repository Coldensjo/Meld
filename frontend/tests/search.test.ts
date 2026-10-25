// Run with: bun test tests/search.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { indexCatalog, scoreItem, searchAssets, tokenize } from '../src/lib/wow/search.ts'
import { buildCatalog, categoryOrder } from '../src/lib/wow/catalog.ts'

const paths = [
	'World\\Azeroth\\Elwynn\\PassiveDoodads\\Trees\\ElwynnTree01.m2',
	'World\\Azeroth\\Elwynn\\PassiveDoodads\\Trees\\ElwynnPine02.m2',
	'World\\Kalimdor\\Durotar\\PassiveDoodads\\Tents\\OrcTentLarge.m2',
	'World\\Azeroth\\Westfall\\PassiveDoodads\\Rocks\\WestfallBoulder03.m2',
	'World\\Azeroth\\Elwynn\\PassiveDoodads\\Rocks\\ElwynnRock01.m2',
	'World\\Generic\\Human\\PassiveDoodads\\Crates\\Crate01.m2',
]
const all = indexCatalog('m2', buildCatalog('m2', paths))
const order = categoryOrder('m2')
const search = (query: string, extra: Partial<{ kind: 'all' | 'm2' | 'wmo' | 'tex'; category: string; zone: string }> = {}) =>
	searchAssets(all, { kind: 'all', query, category: '', zone: '', ...extra }, order).items.map((it) => it.path.slice(it.path.lastIndexOf('\\') + 1))

test('tokens come from folders, file-name words and camel case', () => {
	assert.deepEqual(tokenize('World\\Azeroth\\Elwynn\\PassiveDoodads\\Trees\\ElwynnTree01.m2'), ['world', 'azeroth', 'elwynn', 'passive', 'doodads', 'trees', 'elwynn', 'tree', '01'])
})

test('an exact file-name word outranks a folder word, which outranks a prefix', () => {
	assert.deepEqual(search('tree'), ['ElwynnTree01.m2', 'ElwynnPine02.m2'])
	const tree = all[0]
	const pine = all[1]
	assert.ok(scoreItem(tree, ['tree']) > scoreItem(pine, ['tree']), 'the name word beats the folder word')
	assert.ok(scoreItem(pine, ['tree']) > 0, 'the Trees folder still matches')
})

test('synonyms find what the typed word means, and every word must match', () => {
	// "pine" is a kind of tree, so the tree is found by it too, after the pine itself.
	assert.deepEqual(search('tree pine'), ['ElwynnPine02.m2', 'ElwynnTree01.m2'])
	assert.deepEqual(search('rock'), ['ElwynnRock01.m2', 'WestfallBoulder03.m2'])
	assert.deepEqual(search('elwynn rock'), ['ElwynnRock01.m2'])
	assert.deepEqual(search('orc tent'), ['OrcTentLarge.m2'])
	assert.deepEqual(search('nothing here'), [])
})

test('with no words the items come in name order, and the filters still apply', () => {
	assert.deepEqual(search(''), ['Crate01.m2', 'ElwynnPine02.m2', 'ElwynnRock01.m2', 'ElwynnTree01.m2', 'OrcTentLarge.m2', 'WestfallBoulder03.m2'])
	assert.deepEqual(search('', { category: 'Rocks' }), ['ElwynnRock01.m2', 'WestfallBoulder03.m2'])
	assert.deepEqual(search('', { zone: 'Elwynn' }), ['ElwynnPine02.m2', 'ElwynnRock01.m2', 'ElwynnTree01.m2'])
	assert.deepEqual(search('', { kind: 'wmo' }), [])
})

test('facet counts cover the query matches before the other filter', () => {
	const r = searchAssets(all, { kind: 'all', query: '', category: 'Rocks', zone: '' }, order)
	assert.deepEqual(
		r.categories.map((c) => `${c.name}:${c.count}`),
		['Trees:2', 'Rocks:2', 'Containers:1', 'Structures:1'],
	)
	assert.deepEqual(
		r.zones.map((z) => `${z.name}:${z.count}`),
		['Elwynn:1', 'Westfall:1'],
	)
})
