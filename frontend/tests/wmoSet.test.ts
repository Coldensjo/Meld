// Run with: bun test tests/wmoSet.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { baseType, doodadSetOf, withDoodadSet } from '../src/lib/models/wmoSet.ts'

// String.raw keeps the backslashes, as a client path has them (a plain literal drops every `\`).
const innPath = String.raw`World\wmo\Azeroth\Buildings\GoldshireInn\GoldshireInn.wmo`
const inn = `wmo:${innPath}`

test('the fixture is a real client path, backslashes and all', () => {
	assert.equal(innPath.split('\\').length, 6)
})

test('a WMO type carries its doodad set as a query, set 0 included', () => {
	assert.equal(withDoodadSet(inn, 2), `${inn}?set=2`)
	assert.equal(withDoodadSet(`${inn}?set=2`, 0), `${inn}?set=0`)
	assert.equal(doodadSetOf(`${inn}?set=3`), 3)
	assert.equal(doodadSetOf(inn), 0)
})

test('the type without its set is the WMO path the client reads', () => {
	assert.equal(baseType(`${inn}?set=3`), inn)
	assert.equal(baseType(withDoodadSet(inn, 1)).slice('wmo:'.length), innPath)
})

test('an M2 has no doodad set', () => {
	assert.equal(doodadSetOf(String.raw`m2:World\Generic\Tree.m2?set=2`), 0)
})
