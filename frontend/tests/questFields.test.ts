// Run with: bun test tests/questFields.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moneyText, questTabs, repText, tabOfColumn } from '../src/lib/world/questFields.ts'

// quest_template's columns on VMaNGOS (SHOW COLUMNS, without entry and patch), 2026-10.
const COLUMNS = [
	'Method',
	'ZoneOrSort',
	'MinLevel',
	'MaxLevel',
	'QuestLevel',
	'Type',
	'RequiredClasses',
	'RequiredRaces',
	'RequiredSkill',
	'RequiredSkillValue',
	'RequiredCondition',
	'RepObjectiveFaction',
	'RepObjectiveValue',
	'RequiredMinRepFaction',
	'RequiredMinRepValue',
	'RequiredMaxRepFaction',
	'RequiredMaxRepValue',
	'SuggestedPlayers',
	'LimitTime',
	'QuestFlags',
	'SpecialFlags',
	'PrevQuestId',
	'NextQuestId',
	'ExclusiveGroup',
	'BreadcrumbForQuestId',
	'NextQuestInChain',
	'SrcItemId',
	'SrcItemCount',
	'SrcSpell',
	'Title',
	'Details',
	'Objectives',
	'OfferRewardText',
	'RequestItemsText',
	'EndText',
	'ObjectiveText1',
	'ObjectiveText2',
	'ObjectiveText3',
	'ObjectiveText4',
	'ReqItemId1',
	'ReqItemId2',
	'ReqItemId3',
	'ReqItemId4',
	'ReqItemCount1',
	'ReqItemCount2',
	'ReqItemCount3',
	'ReqItemCount4',
	'ReqSourceId1',
	'ReqSourceId2',
	'ReqSourceId3',
	'ReqSourceId4',
	'ReqSourceCount1',
	'ReqSourceCount2',
	'ReqSourceCount3',
	'ReqSourceCount4',
	'ReqCreatureOrGOId1',
	'ReqCreatureOrGOId2',
	'ReqCreatureOrGOId3',
	'ReqCreatureOrGOId4',
	'ReqCreatureOrGOCount1',
	'ReqCreatureOrGOCount2',
	'ReqCreatureOrGOCount3',
	'ReqCreatureOrGOCount4',
	'ReqSpellCast1',
	'ReqSpellCast2',
	'ReqSpellCast3',
	'ReqSpellCast4',
	'RewChoiceItemId1',
	'RewChoiceItemId2',
	'RewChoiceItemId3',
	'RewChoiceItemId4',
	'RewChoiceItemId5',
	'RewChoiceItemId6',
	'RewChoiceItemCount1',
	'RewChoiceItemCount2',
	'RewChoiceItemCount3',
	'RewChoiceItemCount4',
	'RewChoiceItemCount5',
	'RewChoiceItemCount6',
	'RewItemId1',
	'RewItemId2',
	'RewItemId3',
	'RewItemId4',
	'RewItemCount1',
	'RewItemCount2',
	'RewItemCount3',
	'RewItemCount4',
	'RewRepFaction1',
	'RewRepFaction2',
	'RewRepFaction3',
	'RewRepFaction4',
	'RewRepFaction5',
	'RewRepValue1',
	'RewRepValue2',
	'RewRepValue3',
	'RewRepValue4',
	'RewRepValue5',
	'RewRepSpilloverMask',
	'RewXP',
	'RewOrReqMoney',
	'RewMoneyMaxLevel',
	'RewSpell',
	'RewSpellCast',
	'RewMailTemplateId',
	'RewMailDelaySecs',
	'RewMailMoney',
	'PointMapId',
	'PointX',
	'PointY',
	'PointOpt',
	'DetailsEmote1',
	'DetailsEmote2',
	'DetailsEmote3',
	'DetailsEmote4',
	'DetailsEmoteDelay1',
	'DetailsEmoteDelay2',
	'DetailsEmoteDelay3',
	'DetailsEmoteDelay4',
	'IncompleteEmote',
	'CompleteEmote',
	'OfferRewardEmote1',
	'OfferRewardEmote2',
	'OfferRewardEmote3',
	'OfferRewardEmote4',
	'OfferRewardEmoteDelay1',
	'OfferRewardEmoteDelay2',
	'OfferRewardEmoteDelay3',
	'OfferRewardEmoteDelay4',
	'StartScript',
	'CompleteScript',
]

test('every column of quest_template has a place on a named tab', () => {
	const tabs = questTabs(COLUMNS)
	assert.deepEqual(
		tabs.map((t) => t.id),
		['quest', 'objectives', 'rewards', 'requirements', 'emotes'],
	)
	const shown = tabs.flatMap((t) => t.groups.flatMap((g) => g.fields.map((f) => f.col)))
	assert.deepEqual([...shown].sort(), [...COLUMNS].sort())
	assert.equal(new Set(shown).size, shown.length, 'a column shows once')
})

test('a column the editor does not know lands on Other, and unknown ones are left out', () => {
	const tabs = questTabs(['Title', 'ReqItemId1', 'SomethingNew'])
	assert.deepEqual(
		tabs.map((t) => t.id),
		['quest', 'objectives', 'other'],
	)
	assert.equal(tabOfColumn(tabs, 'SomethingNew'), 'other')
	assert.equal(tabOfColumn(tabs, 'ReqItemId1'), 'objectives')
	assert.equal(tabOfColumn(tabs, 'RewXP'), null)
})

test('the reference columns name what they point at', () => {
	const fields = new Map(
		questTabs(COLUMNS)
			.flatMap((t) => t.groups.flatMap((g) => g.fields))
			.map((f) => [f.col, f]),
	)
	assert.equal(fields.get('ReqCreatureOrGOId2')?.ref, 'creature or object')
	assert.equal(fields.get('ZoneOrSort')?.ref, 'zone or sort')
	assert.equal(fields.get('RewChoiceItemId6')?.ref, 'item')
	assert.equal(fields.get('RewRepFaction5')?.ref, 'faction')
	assert.equal(fields.get('OfferRewardEmote4')?.ref, 'emote')
	assert.equal(fields.get('NextQuestInChain')?.ref, 'quest')
	assert.equal(fields.get('Details')?.long, true)
	// The ids #704 gave a picker, a tick list or ranks.
	assert.equal(fields.get('PointMapId')?.ref, 'map')
	assert.equal(fields.get('RewMailTemplateId')?.ref, 'mail template')
	assert.equal(fields.get('RequiredCondition')?.ref, 'condition')
	assert.equal(fields.get('StartScript')?.ref, 'quest start script')
	assert.equal(fields.get('CompleteScript')?.ref, 'quest end script')
	assert.equal(fields.get('StartScript')?.own, 'entry')
	assert.equal(fields.get('ExclusiveGroup')?.ref, 'exclusive group')
	assert.deepEqual(
		fields.get('RewRepSpilloverMask')?.flags?.map(([bit]) => bit),
		[1, 2, 4, 8, 16],
	)
	for (const col of ['RepObjectiveValue', 'RequiredMinRepValue', 'RequiredMaxRepValue'])
		assert.ok(
			fields.get(col)?.suggest?.some((v) => Array.isArray(v) && v[1] === 'Exalted'),
			col,
		)
})

test('a reputation value reads as its rank', () => {
	assert.equal(repText('0'), 'Neutral')
	assert.equal(repText('9500'), 'Honored + 500')
	assert.equal(repText('-3000'), 'Unfriendly')
	assert.equal(repText('-42999'), 'Hated')
	assert.equal(repText('42999'), 'Exalted + 999')
	assert.equal(repText(''), '')
})

test('copper reads as gold, silver and copper', () => {
	assert.equal(moneyText('12345'), '1g 23s 45c')
	assert.equal(moneyText('-500'), 'costs 5s')
	assert.equal(moneyText('0'), '')
})
