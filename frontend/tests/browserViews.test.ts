// Run with: bun test tests/browserViews.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byLevel, readView, writeView } from '../src/lib/wow/browserViews.ts'

test('each tab keeps its own view', () => {
	let views = writeView({}, 'm2', { zone: 'Durotar', category: 'Trees' })
	views = writeView(views, 'tex', { query: 'grass' })
	assert.deepEqual(readView(views, 'm2'), { query: '', category: 'Trees', zone: 'Durotar', scroll: 0, sort: '' })
	assert.deepEqual(readView(views, 'tex'), { query: 'grass', category: '', zone: '', scroll: 0, sort: '' })
	assert.deepEqual(readView(views, 'wmo'), { query: '', category: '', zone: '', scroll: 0, sort: '' }, 'a tab never used starts empty')
})

test('an unchanged write keeps the same object', () => {
	const views = writeView({}, 'm2', { scroll: 120 })
	assert.equal(writeView(views, 'm2', { scroll: 120 }), views)
	assert.notEqual(writeView(views, 'm2', { scroll: 121 }), views)
})

test('anything odd in the config file reads as an empty view', () => {
	assert.equal(readView(null, 'm2').zone, '')
	assert.equal(readView([], 'm2').zone, '')
	assert.deepEqual(readView({ m2: { query: 3, zone: 'Elwynn', scroll: -5 } }, 'm2'), { query: '', category: '', zone: 'Elwynn', scroll: 0, sort: '' })
	assert.equal(readView({ m2: { scroll: Number.NaN } }, 'm2').scroll, 0)
	assert.equal(readView({ creature: { sort: 'name' } }, 'creature').sort, '')
})

test('a sort is kept and changes the view (#659)', () => {
	const views = writeView({}, 'creature', { sort: 'level-desc' })
	assert.equal(readView(views, 'creature').sort, 'level-desc')
	assert.notEqual(writeView(views, 'creature', { sort: 'level' }), views)
	assert.equal(writeView(views, 'creature', { sort: 'level-desc' }), views)
})

test('byLevel orders by the lowest level, then the highest, then the name (#659)', () => {
	const list = [
		{ name: 'Wolf', levelMin: 5, levelMax: 6 },
		{ name: 'Boar', levelMin: 5, levelMax: 6 },
		{ name: 'Ogre', levelMin: 30, levelMax: 30 },
		{ name: 'Kobold', levelMin: 5, levelMax: 5 },
	]
	assert.deepEqual(
		[...list].sort(byLevel(false)).map((c) => c.name),
		['Kobold', 'Boar', 'Wolf', 'Ogre'],
	)
	assert.deepEqual(
		[...list].sort(byLevel(true)).map((c) => c.name),
		['Ogre', 'Boar', 'Wolf', 'Kobold'],
	)
})
