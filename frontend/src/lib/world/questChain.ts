// The rules of a quest chain, as VMaNGOS reads them (ObjectMgr::LoadQuests): which quest comes before
// which, and when a step climbs too steeply. File › Check Map's quest checks (#952, lib/check/quests.ts)
// use them over the map's quests, and the quest editor's chain graph (#948) is to draw with them.
//
// - PrevQuestId p: the quest needs p done first (p > 0), or p taken and not yet done (p < 0).
// - NextQuestId n: the quest is a prerequisite of n, done (n > 0) or taken (n < 0); the server adds
//   it to n's previous quests.
// - NextQuestInChain c: the quest its ender offers right after this one is turned in.
// - BreadcrumbForQuestId b: the quest leads the player to b, which can be taken without it.
// A link to a quest that doesn't exist is dropped by the server, so the chain breaks there.

/** The columns that name another quest, in quest_template's order (Go's questLinkColumns). */
export const QUEST_LINK_COLS = ['PrevQuestId', 'NextQuestId', 'NextQuestInChain', 'BreadcrumbForQuestId'] as const
export type QuestLinkCol = (typeof QUEST_LINK_COLS)[number]

/** What each link column means, said after a quest's name in a finding. */
export const QUEST_LINK_LABEL: Record<QuestLinkCol, string> = {
	PrevQuestId: 'previous quest',
	NextQuestId: 'next quest',
	NextQuestInChain: 'next quest in its chain',
	BreadcrumbForQuestId: 'breadcrumb target',
}

/** How many levels a chain step may climb over the step before it before it is flagged. */
export const LEVEL_JUMP = 5

/** A link of a quest: the column and the quest it names (the sign of PrevQuestId and NextQuestId dropped). */
export interface QuestLink {
	col: QuestLinkCol
	quest: number
}

/** The set links of a quest's row (`links` by column, as stored). */
export function questLinks(links: Readonly<Record<string, number | undefined>>): QuestLink[] {
	const out: QuestLink[] = []
	for (const col of QUEST_LINK_COLS) {
		const v = links[col]
		if (v) out.push({ col, quest: Math.abs(v) })
	}
	return out
}

/** A step of a chain: `from` must be done before `to` is taken, through the link column `via` (of the quest whose row holds it). */
export interface ChainStep {
	from: number
	to: number
	via: QuestLinkCol
}

/**
 * The steps a quest's links make, in the order a player meets them: its done-first previous quest
 * leads to it, and it leads to its done-first next quest and to the next quest in its chain. The
 * "taken, not done" links (negative) and breadcrumbs are not steps: a player holds both quests at once.
 */
export function chainSteps(entry: number, links: Readonly<Record<string, number | undefined>>): ChainStep[] {
	const out: ChainStep[] = []
	const prev = links.PrevQuestId ?? 0
	const next = links.NextQuestId ?? 0
	const chain = links.NextQuestInChain ?? 0
	if (prev > 0) out.push({ from: prev, to: entry, via: 'PrevQuestId' })
	if (next > 0) out.push({ from: entry, to: next, via: 'NextQuestId' })
	if (chain > 0 && chain !== next) out.push({ from: entry, to: chain, via: 'NextQuestInChain' })
	return out
}

/** How many levels a step climbs, when it climbs more than LEVEL_JUMP; null otherwise or when either level scales with the player (0 or less). */
export function levelJump(fromLevel: number, toLevel: number): number | null {
	if (fromLevel <= 0 || toLevel <= 0) return null
	const up = toLevel - fromLevel
	return up > LEVEL_JUMP ? up : null
}
