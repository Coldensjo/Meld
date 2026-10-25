// Run with: bun test tests/modelSets.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatSet, newSet, parseSet, validSets, withModel, withoutModel } from '../src/lib/wow/modelSets.ts'

test('a model joins a set once, whatever its case or old extension', () => {
	let s = withModel(newSet('Camp'), 'm2:World\\Generic\\Tent.m2')
	s = withModel(s, 'm2:world\\generic\\tent.mdx')
	s = withModel(s, 'wmo:World\\wmo\\Hut.wmo')
	assert.deepEqual(s.models, ['m2:World\\Generic\\Tent.m2', 'wmo:World\\wmo\\Hut.wmo'])
	assert.equal(withModel(s, 'tex:Tileset\\Grass.blp'), s, 'a texture is not a model')
	assert.equal(withModel(s, 'helper:cube'), s, 'nor is a helper shape')
	assert.deepEqual(withoutModel(s, 'm2:WORLD\\GENERIC\\TENT.M2').models, ['wmo:World\\wmo\\Hut.wmo'])
})

test('the set file round-trips, with literal strings for the client paths', () => {
	const s = withModel(withModel(newSet("Ogre's camp"), 'm2:World\\Generic\\Tent.m2'), 'wmo:World\\wmo\\Hut.wmo')
	const text = formatSet(s)
	assert.match(text, /'m2:World\\Generic\\Tent\.m2'/)
	const { set, errors } = parseSet(text)
	assert.deepEqual(errors, [])
	assert.deepEqual(set, s)
})

test('a bad file says what is wrong and keeps what it can', () => {
	assert.equal(parseSet('name = [').set, null)
	const { set, errors } = parseSet("name = 'X'\nmodels = ['m2:a.m2', 3, 'tex:b.blp']")
	assert.deepEqual(set?.models, ['m2:a.m2'])
	assert.equal(errors.length, 2)
	assert.equal(parseSet('models = []').set?.name, 'Imported set')
})

test('sets from the config file are checked', () => {
	assert.deepEqual(validSets(null), [])
	assert.deepEqual(validSets([{ name: 'A', models: ['m2:a.m2', 1, 'x'] }, { models: [] }, 'junk']), [{ name: 'A', models: ['m2:a.m2'] }])
})
