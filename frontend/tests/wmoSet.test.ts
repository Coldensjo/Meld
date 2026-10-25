// Run with: bun test tests/wmoSet.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseType, doodadSetOf, withDoodadSet } from '../src/lib/models/wmoSet.ts'

const inn = 'wmo:World\wmo\Azeroth\Buildings\GoldshireInn\GoldshireInn.wmo'

test('a WMO type carries its doodad set as a query, set 0 included', () => {
	assert.equal(withDoodadSet(inn, 2), `${inn}?set=2`)
	assert.equal(withDoodadSet(`${inn}?set=2`, 0), `${inn}?set=0`)
	assert.equal(doodadSetOf(`${inn}?set=3`), 3)
	assert.equal(doodadSetOf(inn), 0)
	assert.equal(baseType(`${inn}?set=3`), inn)
})

test('an M2 has no doodad set', () => {
	assert.equal(doodadSetOf('m2:World\Tree.m2?set=2'), 0)
})
