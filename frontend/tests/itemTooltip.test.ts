// Run with: bun test tests/itemTooltip.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { money, tooltipLines } from '../src/lib/wow/itemTooltip.ts'

test('money writes gold, silver and copper as the game does', () => {
	assert.equal(money(9), '9c')
	assert.equal(money(0), '0c')
	assert.equal(money(10203), '1g 2s 3c')
	assert.equal(money(20000), '2g')
	assert.equal(money(150), '1s 50c')
})

test("a weapon's tooltip has its slot, type, damage, speed and damage per second", () => {
	// Battleworn Hammer (2361), as the world database has it.
	const lines = tooltipLines({ entry: '2361', name: 'Battleworn Hammer', quality: '1', bonding: '0', inventory_type: '17', class: '2', subclass: '5', armor: '0', dmg_min1: '3', dmg_max1: '5', dmg_type1: '0', delay: '2900', stat_type1: '0', stat_value1: '0', required_level: '1', item_level: '2', sell_price: '9', max_durability: '25', description: '' })
	assert.deepEqual(
		lines.map((l) => (l.right ? `${l.left} | ${l.right}` : l.left)),
		['Battleworn Hammer', 'Two-Hand | Mace', '3 - 5 Damage | Speed 2.90', '(1.4 damage per second)', 'Durability 25 / 25', 'Item Level 2', 'Sell Price: 9c'],
	)
	assert.equal(lines[0].color, '#ffffff')
	assert.ok(lines[0].title)
})

test('armour, stats, resistances, binding, level, effects and description show, empty columns do not', () => {
	const lines = tooltipLines({ name: 'Robe of Test', quality: '3', bonding: '2', inventory_type: '20', class: '4', subclass: '1', armor: '55', stat_type1: '7', stat_value1: '8', stat_type2: '5', stat_value2: '-2', fire_res: '5', required_level: '30', spellid_1: '7597', spelltrigger_1: '1', description: 'Soft.', max_count: '1' })
	const text = lines.map((l) => l.left)
	assert.deepEqual(text, ['Robe of Test', 'Binds when equipped', 'Unique', 'Chest', '55 Armor', '+8 Stamina', '-2 Intellect', '+5 Fire Resistance', 'Requires Level 30', 'Equip: spell 7597', '"Soft."'])
	assert.equal(lines[0].color, '#0070dd')
	assert.equal(lines[3].right, 'Cloth')
})

test('a bag says its slots, and a row without a name still gets a title', () => {
	assert.equal(tooltipLines({ name: 'Small Pouch', inventory_type: '18', class: '1', container_slots: '6' })[1].left, '6 Slot Bag')
	assert.equal(tooltipLines({ entry: '42' })[0].left, 'Item 42')
})

test("an effect shows its spell's text when given, and the spell's ID when not", () => {
	const row = { name: 'Bread', spellid_1: '433', spelltrigger_1: '0', spellid_2: '99', spelltrigger_2: '1' }
	const text = tooltipLines(row, { 433: 'Restores 61 health over 18 sec.' }).map((l) => l.left)
	assert.deepEqual(text, ['Bread', 'Use: Restores 61 health over 18 sec.', 'Equip: spell 99'])
})
