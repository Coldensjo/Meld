// Run with: bun test tests/spellFields.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { vmangos } from '../wailsjs/go/models.ts'
import { withBit } from '../src/lib/world/creatureFields.ts'
import { FORM_MASK, SPELL_ATTRIBUTES, SPELL_ATTRIBUTES_EX, SPELL_ATTRIBUTES_EX2, SPELL_ATTRIBUTES_EX3, effectSummary, expandSpellText, miscField, spellTabs, spellTooltip, subclassMask } from '../src/lib/world/spellFields.ts'

// The client's tables as SpellTables gives them: duration 9 is 4 sec, cast time 7 is 1.5 sec, range 4 is 30 yd, radius 13 is 10 yd.
const tables = vmangos.SpellTables.createFrom({
	castTimes: [
		{ id: 1, label: 'Instant', value: 0 },
		{ id: 7, label: '1.5 sec', value: 1500 },
	],
	durations: [
		{ id: 9, label: '4 sec', value: 4000 },
		{ id: 21, label: 'until cancelled', value: -1 },
	],
	ranges: [
		{ id: 1, label: '0 yd · Self Only', value: 0 },
		{ id: 2, label: '5 yd · Combat Range', value: 5 },
		{ id: 4, label: '30 yd', value: 30 },
	],
	radii: [{ id: 13, label: '10 yd', value: 10 }],
})

// Fireball (Rank 1) as spell_template has it: 14 to 22 Fire damage, then 2 over 4 sec in ticks of 2 sec.
const fireball: Record<string, string> = {
	name: 'Fireball',
	nameSubtext: 'Rank 1',
	description: 'Hurls a fiery ball that causes $s1 Fire damage and an additional $o2 Fire damage over $d.',
	effect1: '2',
	effectBasePoints1: '13',
	effectDieSides1: '9',
	effectBaseDice1: '1',
	effectImplicitTargetA1: '6',
	effect2: '6',
	effectApplyAuraName2: '3',
	effectBasePoints2: '0',
	effectDieSides2: '0',
	effectBaseDice2: '1',
	effectAmplitude2: '2000',
	durationIndex: '9',
	castingTimeIndex: '7',
	rangeIndex: '4',
	powerType: '0',
	manaCost: '30',
	recoveryTime: '0',
}

test('a description fills in its tokens as the game does', () => {
	assert.equal(expandSpellText(fireball.description, fireball, tables), 'Hurls a fiery ball that causes 14 to 22 Fire damage and an additional 2 Fire damage over 4 sec.')
	assert.equal(expandSpellText('$a1 yards, $u $lstack:stacks;, $q', { effectRadiusIndex1: '13', stackAmount: '1' }, tables), '10 yards, 1 stack, $q')
	assert.equal(expandSpellText('lasts $d', { durationIndex: '21' }, tables), 'lasts until cancelled')
})

test('the tooltip lays out cost, range, cast time and cooldown', () => {
	const tip = spellTooltip(fireball, tables)
	assert.equal(tip.cost, '30 Mana')
	assert.equal(tip.range, '30 yd range')
	assert.equal(tip.cast, '1.5 sec cast')
	assert.equal(tip.cooldown, '')
	const strike = spellTooltip({ powerType: '1', manaCost: '150', rangeIndex: '2', castingTimeIndex: '1', recoveryTime: '6000' }, tables)
	assert.deepEqual([strike.cost, strike.range, strike.cast, strike.cooldown], ['15 Rage', 'Melee Range', 'Instant cast', '6 sec cooldown'])
	assert.equal(spellTooltip({ castingTimeIndex: '1', attributesEx: '4' }, tables).cast, 'Channeled')
})

test('an effect reads as one line', () => {
	assert.equal(effectSummary(fireball, 1, tables), 'Damage 14 to 22 · Enemy target')
	assert.equal(effectSummary(fireball, 2, tables), 'Apply aura: Periodic damage 1 every 2 sec')
	assert.equal(effectSummary(fireball, 3, tables), '')
})

test('every column shows, the unlisted ones on Other, the look ones beside the tooltip', () => {
	const tabs = spellTabs(['name', 'effect1', 'spellIconId', 'spellVisual1', 'customFlags', 'stances', 'castUI'], tables)
	assert.deepEqual(
		tabs.map((t) => t.id),
		['spell', 'effect1', 'needs', 'flags', 'other'],
	)
	const other = tabs.find((t) => t.id === 'other')!.groups.flatMap((g) => g.fields.map((f) => f.col))
	assert.deepEqual(other, ['castUI'])
})

const field = (tabs: ReturnType<typeof spellTabs>, col: string) => tabs.flatMap((t) => t.groups.flatMap((g) => g.fields)).find((f) => f.col === col)

test('the masks are tick lists of every bit, the forms by 1 << (form - 1)', () => {
	for (const list of [SPELL_ATTRIBUTES, SPELL_ATTRIBUTES_EX, SPELL_ATTRIBUTES_EX2, SPELL_ATTRIBUTES_EX3]) assert.equal(list.length, 32)
	assert.deepEqual(
		FORM_MASK.find(([, n]) => n === 'Cat'),
		[1, 'Cat'],
	)
	assert.deepEqual(
		FORM_MASK.find(([, n]) => n === 'Battle stance'),
		[0x10000, 'Battle stance'],
	)
	// Spirit of redemption (form 32) is the top bit, which ticks on and off as an unsigned column.
	const top = FORM_MASK.find(([, n]) => n === 'Spirit of redemption')![0]
	assert.equal(top, 0x80000000)
	assert.equal(withBit('1', top, true), '2147483649')
	assert.equal(withBit('2147483649', top, false), '1')
	const tabs = spellTabs(['attributes', 'procFlags', 'targetCreatureType'], tables)
	assert.ok(field(tabs, 'attributes')?.flags?.some(([b, n]) => b === 0x40 && n === 'Passive'))
	assert.ok(field(tabs, 'targetCreatureType')?.flags?.some(([b, n]) => b === 1 && n === 'Beast'))
})

test('the subclasses follow the item class', () => {
	const cols = ['equippedItemClass', 'equippedItemSubClassMask']
	assert.equal(field(spellTabs(cols, tables, { equippedItemClass: '-1' }), 'equippedItemSubClassMask')?.flags, undefined)
	const weapon = field(spellTabs(cols, tables, { equippedItemClass: '2' }), 'equippedItemSubClassMask')?.flags ?? []
	assert.deepEqual(weapon, subclassMask(2))
	assert.ok(weapon.length > 10 && weapon[0][0] === 1)
	assert.ok(
		weapon.some(([b]) => b === 2 ** 15),
		'daggers are subclass 15',
	)
})

test('a misc value gets the picker its effect or aura implies', () => {
	const misc = (v: Record<string, string>) => miscField(1, v)
	assert.equal(misc({ effect1: '28' }).ref, 'creature')
	assert.equal(misc({ effect1: '76' }).ref, 'object')
	assert.equal(misc({ effect1: '103' }).ref, 'faction')
	assert.equal(misc({ effect1: '44' }).ref, 'skill')
	assert.equal(misc({ effect1: '33' }).ref, 'lock type')
	for (const e of ['53', '54', '92']) assert.equal(misc({ effect1: e }).ref, 'item enchantment')
	assert.equal(misc({ effect1: '30' }).label, 'Power')
	assert.equal(misc({ effect1: '108' }).label, 'Mechanic')
	// An aura's misc value counts only when the effect applies the aura.
	assert.equal(misc({ effect1: '6', effectApplyAuraName1: '22' }).label, 'Schools')
	assert.equal(misc({ effect1: '6', effectApplyAuraName1: '22' }).flags?.[0]?.[0], 1)
	assert.equal(misc({ effect1: '35', effectApplyAuraName1: '29' }).options?.[0]?.[1], 'All stats')
	assert.equal(misc({ effect1: '6', effectApplyAuraName1: '56' }).ref, 'creature')
	assert.equal(misc({ effect1: '6', effectApplyAuraName1: '107' }).label, 'Modifies')
	assert.equal(misc({ effect1: '2', effectApplyAuraName1: '22' }).label, 'Misc value')
	assert.equal(misc({ effect1: '2' }).ref, undefined)
	assert.equal(misc({}).col, 'effectMiscValue1')
	assert.equal(miscField(3, { effect3: '61' }).col, 'effectMiscValue3')
	assert.equal(miscField(3, { effect3: '61' }).ref, 'event')
})
