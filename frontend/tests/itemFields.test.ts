// Run with: bun test tests/itemFields.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HONOR_RANKS, itemTabs } from '../src/lib/world/itemFields.ts'

const COLS = [
	'entry',
	'name',
	'other_team_entry',
	'set_id',
	'lock_id',
	'page_text',
	'page_language',
	'page_material',
	'random_property',
	'disenchant_id',
	'map_bound',
	'spellcategory_1',
	'spellcategory_5',
	'required_honor_rank',
	'buy_price',
]

test('the item editor names its id columns with pickers (#701)', () => {
	const fields = itemTabs(COLS, 2).flatMap((t) => t.groups.flatMap((g) => g.fields))
	const ref = (col: string) => fields.find((f) => f.col === col)?.ref
	assert.equal(ref('other_team_entry'), 'item')
	assert.equal(ref('set_id'), 'item set')
	assert.equal(ref('lock_id'), 'lock')
	assert.equal(ref('page_text'), 'page')
	assert.equal(ref('page_language'), 'language')
	assert.equal(ref('page_material'), 'page material')
	assert.equal(ref('random_property'), 'enchantment')
	assert.equal(ref('disenchant_id'), 'disenchant')
	assert.equal(ref('map_bound'), 'map')
	assert.equal(ref('spellcategory_1'), 'spell category')
	assert.equal(ref('spellcategory_5'), 'spell category')
	assert.equal(fields.find((f) => f.col === 'required_honor_rank')?.options, HONOR_RANKS)
	// A quantity stays a number.
	assert.equal(ref('buy_price'), undefined)
})

test('the honor ranks run from Private / Scout at 5 to Grand Marshal / High Warlord at 18', () => {
	assert.deepEqual(HONOR_RANKS[0], [0, 'None'])
	assert.deepEqual(HONOR_RANKS[1], [5, 'Private / Scout'])
	assert.deepEqual(HONOR_RANKS.at(-1), [18, 'Grand Marshal / High Warlord'])
	assert.equal(HONOR_RANKS.length, 15)
})
