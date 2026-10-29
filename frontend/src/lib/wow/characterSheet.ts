import type { vmangos } from '../wails/models'

// What the Characters and Accounts tool shows of a character's look, honor, skills and reputation
// (#875), as the server reckons them. Go checks every value again on save (internal/vmangos/charsheet.go).

/** The reputation ranks and the standing each starts at (ReputationMgr::PointsInRank). */
export const REP_RANKS: Array<[string, number]> = [
	['Hated', -42000],
	['Hostile', -6000],
	['Unfriendly', -3000],
	['Neutral', 0],
	['Friendly', 3000],
	['Honored', 9000],
	['Revered', 21000],
	['Exalted', 42000],
]
export const REP_MIN = -42000
export const REP_MAX = 42999

/** The rank of a standing, as an index of REP_RANKS (ReputationMgr::ReputationToRank). */
export function repRank(standing: number): number {
	for (let i = REP_RANKS.length - 1; i > 0; i--) if (standing >= REP_RANKS[i][1]) return i
	return 0
}

/** How far into its rank a standing is, and the rank's size, as the game's bar shows it. */
export function repProgress(standing: number): [number, number] {
	const i = repRank(standing)
	const end = i + 1 < REP_RANKS.length ? REP_RANKS[i + 1][1] : REP_MAX + 1
	return [standing - REP_RANKS[i][1], end - REP_RANKS[i][1]]
}

/** The faction flags a player sets (ReputationMgr.h FactionFlags); the rest come from Faction.dbc. */
export const FACTION_VISIBLE = 0x01
export const FACTION_AT_WAR = 0x02
export const FACTION_HIDDEN = 0x04
export const FACTION_INVISIBLE_FORCED = 0x08
export const FACTION_PEACE_FORCED = 0x10
export const FACTION_INACTIVE = 0x20

/** The races of the Alliance (the rest are the Horde's), for the honor ranks' names. */
const ALLIANCE = new Set([1, 3, 4, 7])

/** Whether a race is the Alliance's. */
export const isAlliance = (race: number) => ALLIANCE.has(race)

const ALLIANCE_RANKS = [
	'Private',
	'Corporal',
	'Sergeant',
	'Master Sergeant',
	'Sergeant Major',
	'Knight',
	'Knight-Lieutenant',
	'Knight-Captain',
	'Knight-Champion',
	'Lieutenant Commander',
	'Commander',
	'Marshal',
	'Field Marshal',
	'Grand Marshal',
]
const HORDE_RANKS = ['Scout', 'Grunt', 'Sergeant', 'Senior Sergeant', 'First Sergeant', 'Stone Guard', 'Blood Guard', 'Legionnaire', 'Centurion', 'Champion', 'Lieutenant General', 'General', 'Warlord', 'High Warlord']
const DISHONORED = ['Pariah', 'Outlaw', 'Exiled', 'Dishonored']

/**
 * The honor ranks as characters.honor_highest_rank holds them (HonorMgr.h: 0 none, 1-4 the
 * dishonored ranks, 5-18 rank 1 to 14), named for the race's side.
 */
export function honorRanks(race: number): Array<[number, string]> {
	const names = ALLIANCE.has(race) ? ALLIANCE_RANKS : HORDE_RANKS
	return [[0, 'None'], ...DISHONORED.map((n, i): [number, string] => [i + 1, n]), ...names.map((n, i): [number, string] => [i + 5, `${i + 1} · ${n}`])]
}

/** The rank rank points give (HonorMgr::CalculateRank), as honor_highest_rank numbers it. */
export function honorRankOf(points: number): number {
	if (!points) return 0
	const pos = points > 0
	const rp = Math.abs(points)
	const count = pos ? 13 : 4
	const first = pos ? 5 : 1
	if (rp < 2000) return pos ? first : 4
	if (rp > (count - 1) * 5000) return pos ? 18 : first
	const r = Math.floor(rp / 5000) + first
	return pos ? r + 1 : 4 - r
}

/** The options of a look's five parts for a race and gender, given the parts chosen so far. */
export interface LookOptions {
	skin: number[]
	face: number[]
	hair_style: number[]
	hair_color: number[]
	facial_hair: number[]
}

const firsts = (pairs: number[][], second?: number) => [...new Set(pairs.filter((p) => second === undefined || p[1] === second).map((p) => p[0]))].sort((a, b) => a - b)
const seconds = (pairs: number[][], first: number) => [...new Set(pairs.filter((p) => p[0] === first).map((p) => p[1]))].sort((a, b) => a - b)

/**
 * The choices for each part of a look: faces for the skin colour, hair colours for the style, and
 * (where the race and gender's facial hair has sections) facial hair in the hair colour, as the
 * server's ValidateAppearance takes them.
 */
export function lookOptions(l: vmangos.CharLooks, skin: number, style: number, color: number): LookOptions {
	const facial = l.checkFacial ? l.facialHair.filter((f) => l.facialColors.some((p) => p[0] === f && p[1] === color)) : l.facialHair
	return {
		skin: l.skins,
		face: firsts(l.faces, skin),
		hair_style: firsts(l.hair),
		hair_color: seconds(l.hair, style),
		facial_hair: facial,
	}
}

/** The SkillLine categories (SkillLineCategory.dbc), in the order the skill frame lists them. */
export const SKILL_CATEGORIES: Array<[number, string]> = [
	[7, 'Class skills'],
	[11, 'Professions'],
	[9, 'Secondary skills'],
	[6, 'Weapon skills'],
	[8, 'Armor proficiencies'],
	[10, 'Languages'],
	[5, 'Attributes'],
	[12, 'Not displayed'],
]

export function skillCategoryName(id: number): string {
	return SKILL_CATEGORIES.find(([c]) => c === id)?.[1] ?? `Category ${id}`
}

/**
 * A skill as the server sets it when it loads the character (Player::_LoadSkills): a language 300
 * of 300, armour 1 of 1, a skill raised by level at most 5 a level; a profession's own most.
 */
export function fixSkill(s: vmangos.CharacterSkill, c: vmangos.SkillChoice | undefined, level: number): vmangos.CharacterSkill {
	if (!c) return s
	switch (c.range) {
		case 'language':
			return { ...s, value: 300, max: 300 }
		case 'mono':
			return { ...s, value: 1, max: 1 }
		case 'level': {
			const max = Math.max(1, level * 5)
			return { ...s, max, value: Math.min(max, Math.max(1, s.value)) }
		}
		default: {
			const max = Math.min(c.top || 300, Math.max(1, s.max))
			return { ...s, max, value: Math.min(max, Math.max(1, s.value)) }
		}
	}
}

/** A new skill at its start: 1 of what the range allows (a profession's first rank, Apprentice, is 75). */
export function newSkill(c: vmangos.SkillChoice, level: number): vmangos.CharacterSkill {
	return fixSkill({ skill: c.id, value: 1, max: c.range === 'rank' ? Math.min(75, c.top || 75) : 1 }, c, level)
}

// Quests (#881, internal/vmangos/charquests.go): a character_queststatus row's status (0 none,
// 1 objectives complete, 3 in progress, 5 failed) and whether it was turned in (rewarded).

/** How many quests the quest log holds (QuestDef.h MAX_QUEST_LOG_SIZE). */
export const QUEST_LOG_SIZE = 20

/** A quest's state as the Quests tab offers it. */
export type QuestState = 'progress' | 'complete' | 'failed' | 'done' | 'none'

/** The states, their names and what each means in the game. */
export const QUEST_STATES: Array<[QuestState, string, string]> = [
	['progress', 'In progress', 'In the quest log, its objectives to do'],
	['complete', 'Ready to turn in', 'In the quest log, its objectives done'],
	['failed', 'Failed', 'In the quest log, failed'],
	['done', 'Done', 'Turned in: the giver offers it no more (a repeatable quest can be taken again)'],
	['none', 'Not taken', 'Out of the log and not done, as an abandoned quest'],
]

const STATUS_OF: Record<Exclude<QuestState, 'done'>, number> = { none: 0, complete: 1, progress: 3, failed: 5 }

/** Whether the server puts a quest into the quest log (Player::_LoadQuestStatus). */
export function inQuestLog(q: Pick<vmangos.CharacterQuest, 'status' | 'rewarded' | 'repeatable'>): boolean {
	return (q.status === 1 || q.status === 3 || q.status === 5) && (!q.rewarded || q.repeatable)
}

/** The state a quest row shows: a repeatable quest done before and taken again shows its log state. */
export function questState(q: Pick<vmangos.CharacterQuest, 'status' | 'rewarded' | 'repeatable'>): QuestState {
	if (q.rewarded && !inQuestLog(q)) return 'done'
	return q.status === 3 ? 'progress' : q.status === 1 ? 'complete' : q.status === 5 ? 'failed' : 'none'
}

/**
 * A quest row put into a state. Done is status complete with rewarded set, as the server's RewardQuest
 * leaves a quest (none for a repeatable one, which Go sets for a new row whose quest it knows to be
 * repeatable). A repeatable quest done before keeps that mark when it is taken again.
 */
export function withQuestState(q: vmangos.CharacterQuest, s: QuestState): vmangos.CharacterQuest {
	if (s === 'done') return { ...q, status: q.repeatable ? 0 : 1, rewarded: true }
	return { ...q, status: STATUS_OF[s], rewarded: q.repeatable && q.rewarded }
}
