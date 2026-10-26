import type { CreatureField, CreatureFieldGroup } from './creatureFields'
import { RACE_MASK, fieldGroups } from './creatureFields'

/**
 * How the quest editor (#259) shows quest_template's columns: on tabs, grouped, with plain labels,
 * and a picker for every column that names an item, creature, object, spell, quest, faction, zone,
 * skill or emote (`ref`). The names and flags follow VMaNGOS' QuestDef.h for 1.12. A column not
 * listed still shows, on the Other tab, so every column of the table can be edited.
 */

export interface QuestTab {
	id: string
	title: string
	groups: CreatureFieldGroup[]
}

/** RequiredClasses' bits (1.12's playable classes). */
export const CLASS_MASK: Array<[number, string]> = [
	[1, 'Warrior'],
	[2, 'Paladin'],
	[4, 'Hunter'],
	[8, 'Rogue'],
	[16, 'Priest'],
	[64, 'Shaman'],
	[128, 'Mage'],
	[256, 'Warlock'],
	[1024, 'Druid'],
]

/** QuestFlags (QUEST_FLAGS_*): the ones the 1.12 server and client act on, and the unused ones by their names. */
const QUEST_FLAGS: Array<[number, string]> = [
	[0x2, 'Group accepts together'],
	[0x8, 'Can be shared'],
	[0x200, 'Rewards hidden until turn-in'],
	[0x400, 'Rewarded at once, never in the log'],
	[0x1, 'Stay alive (unused)'],
	[0x4, 'Exploration (unused)'],
	[0x20, 'Epic (unused)'],
	[0x40, 'Raid (unused)'],
	[0x100, 'Deliver more (unused)'],
]

/** SpecialFlags: the two the database may set (QUEST_SPECIAL_FLAG_DB_ALLOWED). */
const SPECIAL_FLAGS: Array<[number, string]> = [
	[0x1, 'Repeatable'],
	[0x2, 'Completed by exploring or an event'],
]

/** Type: QuestInfo.dbc's 1.12 rows, as the quest log names them. */
const QUEST_TYPES: Array<[number, string]> = [
	[0, 'Normal'],
	[1, 'Elite (group)'],
	[21, 'Life'],
	[41, 'PvP'],
	[62, 'Raid'],
	[81, 'Dungeon'],
	[82, 'World event'],
	[83, 'Legendary'],
	[84, 'Escort'],
]

/** The reputation ranks by the value each starts at (VMaNGOS' ReputationMgr::PointsInRank). */
export const REP_RANKS: Array<[number, string]> = [
	[-42000, 'Hated'],
	[-6000, 'Hostile'],
	[-3000, 'Unfriendly'],
	[0, 'Neutral'],
	[3000, 'Friendly'],
	[9000, 'Honored'],
	[21000, 'Revered'],
	[42000, 'Exalted'],
]

/** A reputation value as its rank and how far into it, such as "Honored + 500". */
export function repText(v: string): string {
	if (v.trim() === '') return ''
	const n = Number(v)
	if (!Number.isFinite(n)) return ''
	let rank = REP_RANKS[0]
	for (const r of REP_RANKS) if (n >= r[0]) rank = r
	const over = n - rank[0]
	return over > 0 ? `${rank[1]} + ${over}` : rank[1]
}

/** The ranks for a reputation value's datalist: a rank picked, any number typed. */
const REP_SUGGEST: Array<[string, string]> = REP_RANKS.map(([v, n]) => [String(v), n])

/** A reputation value: the ranks offered, the rank shown (#704). */
const rep = (col: string, label: string): CreatureField => ({ col, label, suggest: REP_SUGGEST, note: repText, hint: 'Pick a rank or type a number' })

/** RewRepSpilloverMask: bit i stops reputation faction i + 1's reward spilling over to its allies (Player::RewardReputation). */
const SPILLOVER_MASK: Array<[number, string]> = [1, 2, 3, 4, 5].map((i) => [1 << (i - 1), `No spillover from faction ${i}`] as [number, string])

/** Copper as gold, silver and copper. */
export function moneyText(v: string): string {
	const n = Number(v) || 0
	if (!n) return ''
	const a = Math.abs(n)
	const parts = [
		[Math.floor(a / 10000), 'g'],
		[Math.floor(a / 100) % 100, 's'],
		[a % 100, 'c'],
	]
		.filter(([x]) => x)
		.map(([x, u]) => `${x}${u}`)
	return (n < 0 ? 'costs ' : '') + parts.join(' ')
}

/** Seconds as minutes and seconds. */
function timeText(v: string): string {
	const n = Number(v) || 0
	if (!n) return ''
	const m = Math.floor(n / 60)
	return m ? `${m} min${n % 60 ? ` ${n % 60} s` : ''}` : `${n} s`
}

/** Milliseconds as seconds. */
const msText = (v: string) => ((Number(v) || 0) > 0 ? `${(Number(v) / 1000).toFixed(1)} s` : '')

/** `n` item (or creature…) slots: a picker and its count side by side. */
function pairs(n: number, idCol: string, countCol: string, ref: CreatureField['ref'], label: string, countLabel = 'Count', hint?: string): CreatureField[] {
	const out: CreatureField[] = []
	for (let i = 1; i <= n; i++) {
		out.push({ col: `${idCol}${i}`, label: `${label}${n > 1 ? ` ${i}` : ''}`, ref, hint })
		out.push({ col: `${countCol}${i}`, label: countLabel })
	}
	return out
}

export const QUEST_TABS: QuestTab[] = [
	{
		id: 'quest',
		title: 'Quest',
		groups: [
			{
				title: 'The quest',
				fields: [
					{ col: 'Title', label: 'Title', wide: true },
					{ col: 'QuestLevel', label: 'Level', hint: 'The level the quest log shows; it sets the experience and the colour' },
					{ col: 'MinLevel', label: 'Players from level' },
					{ col: 'MaxLevel', label: 'Players up to level', hint: '0: no upper level' },
					{ col: 'ZoneOrSort', label: 'Quest log heading', ref: 'zone or sort', hint: 'A zone, or a sort such as Warlock or Seasonal (a negative number)' },
					{ col: 'Type', label: 'Type', options: QUEST_TYPES },
					{ col: 'SuggestedPlayers', label: 'Suggested players', hint: '0: none shown' },
					{
						col: 'Method',
						label: 'How it ends',
						options: [
							[2, 'Handed in to an ender'],
							[0, 'Completes by itself'],
							[1, 'Disabled'],
						],
					},
					{ col: 'LimitTime', label: 'Time limit (s)', note: timeText, hint: '0: no time limit' },
					{ col: 'QuestFlags', label: 'Flags', flags: QUEST_FLAGS },
					{ col: 'SpecialFlags', label: 'Server flags', flags: SPECIAL_FLAGS },
				],
			},
			{
				title: 'What it says',
				fields: [
					{ col: 'Details', label: 'When offered (what the giver says)', long: true, hint: "$N is the player's name, $C the class, $R the race, $B a new line" },
					{ col: 'Objectives', label: "Objectives (the quest log's summary)", long: true },
					{ col: 'RequestItemsText', label: 'While in progress (asked at the ender)', long: true },
					{ col: 'OfferRewardText', label: 'On turn-in (with the rewards)', long: true },
					{ col: 'EndText', label: 'End text', long: true },
				],
			},
		],
	},
	{
		id: 'objectives',
		title: 'Objectives',
		groups: [
			{ title: 'Items to bring', fields: pairs(4, 'ReqItemId', 'ReqItemCount', 'item', 'Item') },
			{
				title: 'Creatures to kill, objects to use',
				fields: [
					...pairs(4, 'ReqCreatureOrGOId', 'ReqCreatureOrGOCount', 'creature or object', 'Target', 'Count', 'A creature to kill (or talk to, with a script), or an object to use'),
					...[1, 2, 3, 4].map((i) => ({ col: `ReqSpellCast${i}`, label: `Spell to cast on target ${i}`, ref: 'spell' as const, wide: true })),
					...[1, 2, 3, 4].map((i) => ({ col: `ObjectiveText${i}`, label: `Objective text ${i}`, hint: "Shown in the log instead of the target's name" })),
				],
			},
			{ title: 'Items gathered along the way', fields: pairs(4, 'ReqSourceId', 'ReqSourceCount', 'item', 'Item', 'Count', 'Items the quest needs that are not handed in (such as a container)') },
			{
				title: 'Reputation to reach',
				fields: [{ col: 'RepObjectiveFaction', label: 'Faction', ref: 'faction' }, rep('RepObjectiveValue', 'Reputation')],
			},
			{
				title: 'Given at the start',
				fields: [
					{ col: 'SrcItemId', label: 'Item given', ref: 'item' },
					{ col: 'SrcItemCount', label: 'Count' },
					{ col: 'SrcSpell', label: 'Spell cast on the player', ref: 'spell', wide: true },
				],
			},
		],
	},
	{
		id: 'rewards',
		title: 'Rewards',
		groups: [
			{ title: 'A choice of one', fields: pairs(6, 'RewChoiceItemId', 'RewChoiceItemCount', 'item', 'Choice') },
			{ title: 'Always given', fields: pairs(4, 'RewItemId', 'RewItemCount', 'item', 'Item') },
			{
				title: 'Money and experience',
				fields: [
					{ col: 'RewOrReqMoney', label: 'Money', money: 'signed', hint: 'Negative: the quest costs this much to hand in' },
					{ col: 'RewMoneyMaxLevel', label: 'Money at level 60', money: true, hint: 'Given instead of experience at the top level' },
					{ col: 'RewXP', label: 'Experience', hint: '0: worked out from the level' },
				],
			},
			{
				title: 'Spells',
				fields: [
					{ col: 'RewSpell', label: 'Spell taught (shown as the reward)', ref: 'spell', wide: true },
					{ col: 'RewSpellCast', label: 'Spell cast on the player', ref: 'spell', wide: true },
				],
			},
			{
				title: 'Reputation',
				fields: [
					...[1, 2, 3, 4, 5].flatMap((i) => [
						{ col: `RewRepFaction${i}`, label: `Faction ${i}`, ref: 'faction' as const },
						{ col: `RewRepValue${i}`, label: 'Reputation' },
					]),
					{ col: 'RewRepSpilloverMask', label: "Spillover (the faction's allies gain a share too)", flags: SPILLOVER_MASK },
				],
			},
			{
				title: 'Mail afterwards',
				fields: [
					{ col: 'RewMailTemplateId', label: 'Mail template', ref: 'mail template', wide: true, hint: "A letter of the client's MailTemplate.dbc, by its first line" },
					{ col: 'RewMailDelaySecs', label: 'Delay (s)', note: timeText },
					{ col: 'RewMailMoney', label: 'Mail money', money: true },
				],
			},
		],
	},
	{
		id: 'requirements',
		title: 'Requirements',
		groups: [
			{
				title: 'Who may take it',
				fields: [
					{ col: 'RequiredRaces', label: 'Races (none ticked: every race)', flags: RACE_MASK },
					{ col: 'RequiredClasses', label: 'Classes (none ticked: every class)', flags: CLASS_MASK, classes: 'mask' },
					{ col: 'RequiredSkill', label: 'Skill', ref: 'skill' },
					{ col: 'RequiredSkillValue', label: 'Skill level' },
					{ col: 'RequiredMinRepFaction', label: 'Reputation at least with', ref: 'faction' },
					rep('RequiredMinRepValue', 'At least'),
					{ col: 'RequiredMaxRepFaction', label: 'Reputation below with', ref: 'faction' },
					rep('RequiredMaxRepValue', 'Below'),
					{ col: 'RequiredCondition', label: 'Condition', ref: 'condition', wide: true, hint: 'A row of the conditions table, by what it tests' },
				],
			},
			{
				title: 'Quest chain',
				fields: [
					{ col: 'PrevQuestId', label: 'After quest', ref: 'quest', wide: true, hint: 'Must be done first; negative: must be on it' },
					{ col: 'NextQuestId', label: 'Opens quest', ref: 'quest', wide: true, hint: 'Done, this one makes that one available; negative: while on this one' },
					{ col: 'NextQuestInChain', label: 'Next in the chain', ref: 'quest', wide: true, hint: 'Offered at once on turn-in' },
					{ col: 'BreadcrumbForQuestId', label: 'Leads to quest', ref: 'quest', wide: true, hint: 'A breadcrumb: it points the player to that quest' },
					{
						col: 'ExclusiveGroup',
						label: 'Exclusive group',
						ref: 'exclusive group',
						wide: true,
						hint: 'Quests sharing a positive group: only one can be done; negative: all must be done. A number you choose (often a quest of the group); the name lists the quests that share it',
					},
				],
			},
		],
	},
	{
		id: 'emotes',
		title: 'Emotes and map',
		groups: [
			{
				title: 'When offered',
				fields: [1, 2, 3, 4].flatMap((i) => [
					{ col: `DetailsEmote${i}`, label: `Emote ${i}`, ref: 'emote' as const },
					{ col: `DetailsEmoteDelay${i}`, label: 'After (ms)', note: msText },
				]),
			},
			{
				title: 'At the ender',
				fields: [
					{ col: 'IncompleteEmote', label: 'While in progress', ref: 'emote' },
					{ col: 'CompleteEmote', label: 'When complete', ref: 'emote' },
					...[1, 2, 3, 4].flatMap((i) => [
						{ col: `OfferRewardEmote${i}`, label: `On turn-in ${i}`, ref: 'emote' as const },
						{ col: `OfferRewardEmoteDelay${i}`, label: 'After (ms)', note: msText },
					]),
				],
			},
			{
				title: 'Point on the map',
				fields: [
					{ col: 'PointMapId', label: 'Map', ref: 'map' },
					{ col: 'PointX', label: 'X' },
					{ col: 'PointY', label: 'Y' },
					{ col: 'PointOpt', label: 'Icon' },
				],
			},
			{
				title: 'Scripts',
				fields: [
					{ col: 'StartScript', label: 'When accepted', ref: 'quest start script', own: 'entry', wide: true, hint: "An ID of quest_start_scripts, usually the quest's own entry" },
					{ col: 'CompleteScript', label: 'When handed in', ref: 'quest end script', own: 'entry', wide: true, hint: "An ID of quest_end_scripts, usually the quest's own entry" },
				],
			},
		],
	},
]

/** The tabs for a quest_template's columns: the known ones, then every other column on Other. */
export function questTabs(columns: string[]): QuestTab[] {
	const have = new Set(columns)
	const tabs = QUEST_TABS.map((t) => ({ ...t, groups: t.groups.map((g) => ({ ...g, fields: g.fields.filter((f) => have.has(f.col)) })).filter((g) => g.fields.length) }))
	const known = new Set(QUEST_TABS.flatMap((t) => t.groups.flatMap((g) => g.fields.map((f) => f.col))))
	const other = fieldGroups(
		columns.filter((c) => !known.has(c)),
		[],
	)
	if (other.length) tabs.push({ id: 'other', title: 'Other', groups: other })
	return tabs.filter((t) => t.groups.length)
}

/** The tab a column is on, for a Save refused on that column. */
export function tabOfColumn(tabs: QuestTab[], col: string): string | null {
	return tabs.find((t) => t.groups.some((g) => g.fields.some((f) => f.col === col)))?.id ?? null
}
