// File › Check Map's quest checks (#952), in the World data group (#951): the quests the map's creatures
// and game objects start or end, checked for what keeps a player from finishing them. Go reads the rows
// (checkQuests, internal/vmangos/questcheck.go: the quests, who starts and ends them, the spawns of every
// giver, ender and kill objective, which item objectives anything gives, the area triggers); this file
// turns them into findings, with the chain rules of lib/world/questChain.ts. A spawn on the open map,
// saved or not, counts as spawned as well as the world database's.
import type { vmangos } from '../wails/models'
import { capped, type Finding } from './findings'
import { nearestSpawns, type WorldSpawn } from './worldData'
import { chainSteps, levelJump, LEVEL_JUMP, QUEST_LINK_LABEL, questLinks } from '../world/questChain'

export type QuestReport = vmangos.QuestReport
type Holder = vmangos.QuestHolder

const GIVERS = 'Quest givers and enders'
const CHAINS = 'Quest chains'
const OBJECTIVES = 'Quest objectives'
const LEVELS = 'Quest levels'

/** The most templates a finding names before it counts the rest. */
const NAMED = 3

/**
 * The findings of the map's quests: a quest nothing starts or no spawned giver offers (an error unless
 * an item starts it), one no spawned ender takes back (an error), givers or enders only in a game event
 * or only outside the open map (info); a chain link to a quest that doesn't exist; a kill objective
 * without a spawn that nothing summons, an item objective nothing drops, sells or gives, a missing area
 * trigger; and a chain step more than LEVEL_JUMP levels above the step before it. Each points at the
 * quest's giver nearest `from` on the map (its ender without one) and opens the quest editor.
 */
export function checkQuests(spawns: readonly WorldSpawn[], report: QuestReport, from: { x: number; z: number } | null): Finding[] {
	if (report.error) {
		return [{ check: 'World data', severity: 'info', group: 'world', message: `The quests weren't checked: ${report.error}`, x: NaN, z: NaN, target: { kind: 'none' } }]
	}
	const nearest = nearestSpawns(spawns, from)
	const tally = new Map(report.spawns.map((t) => [`${t.kind}:${t.id}`, t]))
	const items = new Map(report.items.map((i) => [i.id, i]))
	const summoned = new Set(report.summoned)
	const missingTriggers = new Set(report.missingTriggers)
	const known = new Map<number, { title: string; level: number }>()
	for (const q of report.linked) known.set(q.entry, q)
	for (const q of report.quests) known.set(q.entry, q)

	const key = (h: Holder) => `${h.kind}:${h.id}`
	const here = (h: Holder) => nearest.has(key(h))
	const world = (h: Holder) => tally.get(key(h))?.world ?? 0
	const spawned = (h: Holder) => here(h) || world(h) > 0
	const eventOnly = (h: Holder) => !here(h) && world(h) > 0 && (tally.get(key(h))?.events ?? 0) >= world(h)
	const named = (h: Holder) => `${tally.get(key(h))?.name || `#${h.id}`} (${h.kind} ${h.id})`
	const list = (hs: Holder[]) => hs.slice(0, NAMED).map(named).join(', ') + (hs.length > NAMED ? ` and ${hs.length - NAMED} more` : '')
	const questName = (entry: number) => `${known.get(entry)?.title || `#${entry}`} (quest ${entry})`

	const out: Record<string, Finding[]> = { [GIVERS]: [], [CHAINS]: [], [OBJECTIVES]: [], [LEVELS]: [] }
	const steps = new Set<string>()
	for (const q of report.quests) {
		const s = [...q.givers, ...q.enders].map((h) => nearest.get(key(h))).find((sp) => sp)
		const target = { kind: 'quest' as const, quest: q.entry, ...(s ? { key: s.key } : {}) }
		const who = questName(q.entry)
		const add = (check: string, severity: Finding['severity'], message: string) => out[check].push({ check, severity, message: `${who}${message}`, x: s ? s.x : NaN, z: s ? s.z : NaN, group: 'world', target })

		// Who offers it and who takes it back.
		for (const [hs, role, verb, gone] of [
			[q.givers, 'giver', 'starts', 'no one can take it'],
			[q.enders, 'ender', 'ends', "it can't be turned in"],
		] as const) {
			const up = hs.filter(spawned)
			const byItem = role === 'giver' && q.itemStarts.length > 0
			if (!hs.length) {
				if (role === 'ender') add(GIVERS, 'error', `: nothing ends it, so ${gone}.`)
				else if (!byItem) add(GIVERS, 'warning', ': nothing starts it: no creature, object or item offers it (fine if a script does).')
			} else if (!up.length) {
				if (!byItem) add(GIVERS, 'error', `: no ${role} is spawned (${list(hs)} ${verb} it), so ${gone}.`)
			} else if (up.every(eventOnly)) add(GIVERS, 'info', `: its ${role}s spawn only during a game event (${list(up)}).`)
			else if (!hs.some(here)) add(GIVERS, 'info', `: none of its ${role}s is in the open map (${list(up)} ${up.length === 1 ? 'is' : 'are'} spawned elsewhere).`)
		}

		// The chain: a link to no quest breaks it, and a step may climb too steeply.
		for (const l of questLinks(q.links)) {
			if (!known.has(l.quest)) add(CHAINS, 'warning', `: its ${QUEST_LINK_LABEL[l.col]} ${l.quest} has no quest_template row (${l.col}), so the server drops the link and the chain breaks there.`)
		}
		for (const st of chainSteps(q.entry, q.links)) {
			const a = known.get(st.from)
			const b = known.get(st.to)
			const id = `${st.from}>${st.to}`
			if (!a || !b || steps.has(id)) continue
			const up = levelJump(a.level, b.level)
			if (up === null) continue
			steps.add(id)
			out[LEVELS].push({
				check: LEVELS,
				severity: 'warning',
				message: `${questName(st.to)} (level ${b.level}) follows ${questName(st.from)} (level ${a.level}): ${up} levels higher, more than ${LEVEL_JUMP}.`,
				x: s ? s.x : NaN,
				z: s ? s.z : NaN,
				group: 'world',
				target,
			})
		}

		// The objectives.
		for (const k of q.kills) {
			const h: Holder = { kind: k < 0 ? 'object' : 'creature', id: Math.abs(k) }
			const t = tally.get(key(h))
			const verb = h.kind === 'object' ? 'use' : 'kill'
			if (!t?.exists) add(OBJECTIVES, 'error', `: its objective names ${h.kind} ${h.id}, which has no ${h.kind === 'object' ? 'gameobject' : 'creature'}_template row, so it can't be completed.`)
			else if (!spawned(h) && !(h.kind === 'creature' && summoned.has(h.id)))
				add(OBJECTIVES, 'warning', `: ${named(h)}, which it asks to ${verb}, has no spawn${h.kind === 'creature' ? ' and no script or spell summons it' : ''}, so it can't be completed (fine if a C++ script spawns it).`)
			else if (eventOnly(h)) add(OBJECTIVES, 'info', `: ${named(h)}, which it asks to ${verb}, spawns only during a game event.`)
		}
		for (const id of q.items) {
			const it = items.get(id)
			if (!it) continue
			if (!it.exists) add(OBJECTIVES, 'error', `: its objective names item ${id}, which has no item_template row, so it can't be completed.`)
			else if (!it.sourced) add(OBJECTIVES, 'warning', `: nothing drops, sells or gives ${it.name || `#${id}`} (item ${id}), which it asks for: no loot, vendor, quest or spell row has it.`)
		}
		for (const at of q.triggers) {
			if (missingTriggers.has(at)) add(OBJECTIVES, 'error', `: area trigger ${at}, which completes it, has no areatrigger_template row, so it can't be explored.`)
		}
	}

	const rank = { error: 0, warning: 1, info: 2 }
	return [GIVERS, CHAINS, OBJECTIVES, LEVELS].flatMap((c) =>
		capped(
			c,
			out[c].sort((a, b) => rank[a.severity] - rank[b.severity]),
		),
	)
}
