// The quest editor's Chain view (#948): the quests Go's ReadQuestChain walked from the open quest
// (internal/vmangos/questchain.go), as a layered graph from the first step to the last, with the
// problems the graph makes visible. The steps and the level rule are lib/world/questChain.ts's, the
// same File › Check Map's quest checks use (#952), so the two agree.
import type { vmangos } from '../wails/models'
import { chainSteps, levelJump, LEVEL_JUMP, QUEST_LINK_LABEL, questLinks, type QuestLinkCol } from './questChain'
import { layers, rows, type LayerEdge } from '../ui/layered'

export type ChainQuest = vmangos.ChainQuest

/** A box of the graph: a quest, or an entry a link names that has no quest_template row (`quest` null). */
export interface ChainNode {
	entry: number
	quest: ChainQuest | null
	layer: number
	row: number
	/** What is wrong with it, one sentence each. */
	problems: string[]
}

/**
 * An arrow: `from` comes before `to` through the link columns `cols` (of either quest's row). A step
 * (done first) is drawn solid; the others ("taken, not done" links and breadcrumbs) dashed. `jump`
 * is the levels a step climbs past LEVEL_JUMP; `loop` marks a step that closes a loop of steps.
 */
export interface ChainEdge extends LayerEdge<number> {
	cols: QuestLinkCol[]
	step: boolean
	jump: number | null
	loop: boolean
	missing: boolean
}

export interface ChainGraph {
	nodes: ChainNode[]
	edges: ChainEdge[]
	/** The exclusive groups with two or more quests in the graph, by group, their entries in order. */
	groups: Map<number, number[]>
}

/** How a quest is named in a problem. */
export const questLabel = (q: { entry: number; title?: string }) => `${q.title || `#${q.entry}`} (${q.entry})`

/** What an exclusive group means, for a member's box. */
export const groupText = (group: number, size: number) => (group > 0 ? `Exclusive group ${group}: only one of its ${size} quests can be done` : `Group ${group}: all ${size} of its quests must be done before the next one opens`)

/** The graph of a chain: its boxes laid out from the first step to the last, its arrows and their problems. */
export function chainGraph(chain: vmangos.QuestChain): ChainGraph {
	const quests = chain.quests ?? []
	const missing = new Set(chain.missing ?? [])
	const by = new Map(quests.map((q) => [q.entry, q]))
	const entries = [...quests.map((q) => q.entry), ...missing].sort((a, b) => a - b)
	const present = new Set(entries)
	const problems = new Map<number, string[]>(entries.map((e) => [e, []]))
	const note = (e: number, p: string) => problems.get(e)?.push(p)

	// Arrows, one a pair of quests in a direction, a step winning over a soft link.
	const edges = new Map<string, ChainEdge>()
	const add = (from: number, to: number, col: QuestLinkCol, step: boolean) => {
		if (from === to || !present.has(from) || !present.has(to)) return
		const id = `${from}>${to}`
		const e = edges.get(id)
		if (e) {
			if (!e.cols.includes(col)) e.cols.push(col)
			e.step ||= step
		} else edges.set(id, { from, to, cols: [col], step, jump: null, loop: false, missing: missing.has(from) || missing.has(to) })
	}
	for (const q of quests) {
		const links = q.links ?? {}
		for (const s of chainSteps(q.entry, links)) add(s.from, s.to, s.via, true)
		const prev = links.PrevQuestId ?? 0
		const next = links.NextQuestId ?? 0
		if (prev < 0) add(-prev, q.entry, 'PrevQuestId', false)
		if (next < 0) add(q.entry, -next, 'NextQuestId', false)
		if (links.BreadcrumbForQuestId) add(q.entry, Math.abs(links.BreadcrumbForQuestId), 'BreadcrumbForQuestId', false)
		for (const l of questLinks(links)) {
			if (missing.has(l.quest)) note(q.entry, `Its ${QUEST_LINK_LABEL[l.col]} ${l.quest} has no quest_template row (${l.col}), so the server drops the link and the chain breaks there.`)
		}
	}
	const list = [...edges.values()]

	// Levels: a step that climbs too steeply.
	for (const e of list) {
		const a = by.get(e.from)
		const b = by.get(e.to)
		if (!e.step || !a || !b) continue
		e.jump = levelJump(a.level, b.level)
		if (e.jump !== null) note(e.to, `Level ${b.level}, ${e.jump} levels above ${questLabel(a)} before it (more than ${LEVEL_JUMP}).`)
	}

	// Who offers and takes back each quest; the entries with no row.
	for (const q of quests) {
		if (!(q.givers ?? []).length) note(q.entry, 'Nothing starts it: no creature, object or item offers it (fine if a script does).')
		if (!(q.enders ?? []).length) note(q.entry, "Nothing ends it, so it can't be turned in.")
	}
	for (const e of missing) note(e, 'No quest_template row: a quest links to it, but the server drops such a link.')

	// Exclusive groups.
	const groups = new Map<number, number[]>()
	for (const q of quests) {
		if (!q.group) continue
		const g = groups.get(q.group)
		if (g) g.push(q.entry)
		else groups.set(q.group, [q.entry])
	}
	for (const [g, m] of groups) if (m.length < 2) groups.delete(g)

	// The layout. A quest with no arrow takes the column of its group's other members.
	const { layer, back } = layers(entries, list)
	list.forEach((e, i) => {
		if (!back.has(i) || !e.step) return
		e.loop = true
		note(e.to, `Its links loop: ${questLabel(by.get(e.from) ?? { entry: e.from })} leads back to it, so the chain can't be finished in order.`)
	})
	const linked = new Set(list.flatMap((e) => [e.from, e.to]))
	for (const [, m] of groups) {
		const placed = m.filter((e) => linked.has(e)).map((e) => layer.get(e) ?? 0)
		if (!placed.length) continue
		const at = Math.min(...placed)
		for (const e of m) if (!linked.has(e)) layer.set(e, at)
	}
	const row = rows(entries, list, layer)
	const nodes = entries.map((entry) => ({ entry, quest: by.get(entry) ?? null, layer: layer.get(entry) ?? 0, row: row.get(entry) ?? 0, problems: problems.get(entry) ?? [] }))
	return { nodes, edges: list, groups }
}
