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
	const lines = tooltipLines({
		entry: '2361',
		name: 'Battleworn Hammer',
		quality: '1',
		bonding: '0',
		inventory_type: '17',
		class: '2',
		subclass: '5',
		armor: '0',
		dmg_min1: '3',
		dmg_max1: '5',
		dmg_type1: '0',
		delay: '2900',
		stat_type1: '0',
		stat_value1: '0',
		required_level: '1',
		item_level: '2',
		sell_price: '9',
		max_durability: '25',
		description: '',
	})
	assert.deepEqual(
		lines.map((l) => (l.right ? `${l.left} | ${l.right}` : l.left)),
		['Battleworn Hammer', 'Two-Hand | Mace', '3 - 5 Damage | Speed 2.90', '(1.4 damage per second)', 'Durability 25 / 25', 'Item Level 2', 'Sell Price:'],
	)
	assert.equal(lines.at(-1)?.money, 9)
	assert.equal(lines[0].color, '#ffffff')
	assert.ok(lines[0].title)
})

test('armour, stats, resistances, binding, level, effects and description show, empty columns do not', () => {
	const lines = tooltipLines({
		name: 'Robe of Test',
		quality: '3',
		bonding: '2',
		inventory_type: '20',
		class: '4',
		subclass: '1',
		armor: '55',
		stat_type1: '7',
		stat_value1: '8',
		stat_type2: '5',
		stat_value2: '-2',
		fire_res: '5',
		required_level: '30',
		spellid_1: '7597',
		spelltrigger_1: '1',
		description: 'Soft.',
		max_count: '1',
	})
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
	const text = tooltipLines(row, { spells: { 433: 'Restores 61 health over 18 sec.' } }).map((l) => l.left)
	assert.deepEqual(text, ['Bread', 'Use: Restores 61 health over 18 sec.', 'Equip: spell 99'])
})

test("stats and resistances follow the client's order, and six equal resistances are one line", () => {
	const row = { name: 'Ring', inventory_type: '11', class: '4', subclass: '0', stat_type1: '5', stat_value1: '3', stat_type2: '4', stat_value2: '2', holy_res: '4', arcane_res: '1', fire_res: '2' }
	assert.deepEqual(
		tooltipLines(row).map((l) => l.left),
		// Strength before Intellect; Arcane first, and Holy alone never shows; Miscellaneous armour has no type.
		['Ring', 'Finger', '+2 Strength', '+3 Intellect', '+1 Arcane Resistance', '+2 Fire Resistance'],
	)
	const all = { name: 'Cloak', holy_res: '5', fire_res: '5', nature_res: '5', frost_res: '5', shadow_res: '5', arcane_res: '5' }
	assert.deepEqual(
		tooltipLines(all).map((l) => l.left),
		['Cloak', '+5 to All Resistances'],
	)
})

test("a gun shows only its type, damage rounds as the client's does, and ammunition adds damage per second", () => {
	const gun = tooltipLines({ name: 'Gun', inventory_type: '26', class: '2', subclass: '3', dmg_min1: '38.7', dmg_max1: '85.7', delay: '3000' })
	assert.deepEqual(
		gun.map((l) => (l.right ? `${l.left} | ${l.right}` : l.left)),
		['Gun', 'Gun', '38 - 86 Damage | Speed 3.00', '(20.7 damage per second)'],
	)
	const arrow = tooltipLines({ name: 'Arrow', inventory_type: '24', class: '6', subclass: '2', dmg_min1: '1', dmg_max1: '2' })
	assert.deepEqual(
		arrow.map((l) => (l.right ? `${l.left} | ${l.right}` : l.left)),
		['Arrow', 'Projectile | Arrow', 'Adds 1.5 damage per second'],
	)
})

test('who may use an item, its requirements by name, uniqueness, quest binding and charges show', () => {
	const row = {
		name: 'Totem',
		bonding: '4',
		max_count: '2',
		allowable_class: '64',
		allowable_race: '-1',
		required_skill: '164',
		required_skill_rank: '50',
		required_reputation_faction: '72',
		required_reputation_rank: '5',
		spellcharges_1: '3',
		page_text: '1',
	}
	assert.deepEqual(
		tooltipLines(row, { skill: 'Blacksmithing', faction: 'Stormwind' }).map((l) => l.left),
		['Totem', 'Quest Item', 'Unique (2)', 'Classes: Shaman', 'Requires Blacksmithing (50)', 'Requires Stormwind - Honored', '3 Charges', '<Right Click to Read>'],
	)
	// A requirement whose name isn't known yet is left out, as the client leaves out an unresolved line.
	assert.ok(!tooltipLines(row).some((l) => l.left.startsWith('Requires')))
})

test('a set piece shows its set: the gold name with nothing worn, the members gray and indented, the bonuses by count', () => {
	const set = {
		name: 'Defias Leather',
		members: ['Blackened Defias Armor', undefined, 'Blackened Defias Belt'],
		bonuses: [
			{ threshold: 5, text: '+15 Attack Power.' },
			{ threshold: 2, text: '+10 Armor.' },
		],
		skill: 'Leatherworking',
		skillRank: 200,
	}
	const row = { name: 'Blackened Defias Belt', set_id: '161', spellcharges_1: '1', description: 'Dark.' }
	const lines = tooltipLines(row, { set })
	assert.deepEqual(
		lines.map((l) => l.left),
		['Blackened Defias Belt', '1 Charge', ' ', 'Defias Leather (0/3)', 'Requires Leatherworking (200)', '  Blackened Defias Armor', '  Blackened Defias Belt', ' ', '(2) Set: +10 Armor.', '(5) Set: +15 Attack Power.', '"Dark."'],
	)
	assert.equal(lines[3].color, '#ffd200')
	assert.equal(lines[5].color, '#808080')
	assert.equal(lines[8].color, '#808080')
	// No set_id, or a set the client doesn't have: no block.
	assert.equal(tooltipLines({ name: 'X' }, { set }).length, 1)
	assert.equal(tooltipLines({ name: 'X', set_id: '161' }).length, 1)
})
