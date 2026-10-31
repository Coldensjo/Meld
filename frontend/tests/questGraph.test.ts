// Run with: bun test tests/questGraph.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { layers, rows } from '../src/lib/ui/layered.ts'
import { chainGraph } from '../src/lib/world/questGraph.ts'
import type { vmangos } from '../src/lib/wails/models'

type Quest = vmangos.ChainQuest

const quest = (entry: number, over: Partial<Quest> = {}): Quest => ({
	entry,
	title: `Q${entry}`,
	level: 10,
	minLevel: 8,
	zone: 40,
	group: 0,
	links: {},
	givers: [{ kind: 'creature', id: 1, name: 'Giver' }],
	enders: [{ kind: 'creature', id: 1, name: 'Giver' }],
	...over,
})
const chain = (quests: Quest[], missing: number[] = []): vmangos.QuestChain => ({ root: quests[0]?.entry ?? 0, quests, missing, capped: false })
const at = (g: ReturnType<typeof chainGraph>, entry: number) => g.nodes.find((n) => n.entry === entry)!

test('layers follow the longest path and set aside the edge that closes a loop', () => {
	// 1 → 2 → 3 and 1 → 3: 3 sits after 2. 4 → 5 → 4 loops.
	const { layer, back } = layers(
		[1, 2, 3, 4, 5],
		[
			{ from: 1, to: 2 },
			{ from: 2, to: 3 },
			{ from: 1, to: 3 },
			{ from: 4, to: 5 },
			{ from: 5, to: 4 },
			{ from: 1, to: 99 },
		],
	)
	assert.deepEqual(
		[1, 2, 3, 4, 5].map((n) => layer.get(n)),
		[0, 1, 2, 0, 1],
	)
	assert.deepEqual([...back], [4])
})

test('rows order a layer by its predecessors', () => {
	// 1 and 2 first; 4 follows 2 and 3 follows 1, so 3 sits above 4 whatever their order.
	const edges = [
		{ from: 2, to: 4 },
		{ from: 1, to: 3 },
	]
	const { layer } = layers([1, 2, 4, 3], edges)
	const row = rows([1, 2, 4, 3], edges, layer)
	assert.equal(row.get(1), 0)
	assert.equal(row.get(2), 1)
	assert.equal(row.get(3), 0)
	assert.equal(row.get(4), 1)
})

test('a chain is laid out from first to last through all its link kinds', () => {
	const g = chainGraph(
		chain([
			quest(10, { links: { NextQuestInChain: 11 } }),
			quest(11, { links: { PrevQuestId: 10 } }),
			quest(12, { links: { PrevQuestId: 11, NextQuestId: 13 } }),
			quest(13),
			quest(14, { links: { BreadcrumbForQuestId: 10 } }),
			quest(15, { links: { PrevQuestId: -13 } }),
		]),
	)
	assert.deepEqual(
		[10, 11, 12, 13, 14, 15].map((e) => at(g, e).layer),
		[1, 2, 3, 4, 0, 5],
	)
	const e1011 = g.edges.find((e) => e.from === 10 && e.to === 11)!
	assert.deepEqual(e1011.cols.sort(), ['NextQuestInChain', 'PrevQuestId'], 'both quests name the step: one arrow')
	assert.equal(e1011.step, true)
	assert.equal(g.edges.find((e) => e.from === 14)!.step, false, 'a breadcrumb is not a step')
	assert.equal(g.edges.find((e) => e.to === 15)!.step, false, 'a negative previous quest is held at once')
	assert.ok(g.nodes.every((n) => n.problems.length === 0))
})

test('the problems: a missing link, no giver or ender, a level jump, a loop', () => {
	const g = chainGraph(
		chain([quest(1, { links: { NextQuestId: 2, BreadcrumbForQuestId: 77 } }), quest(2, { level: 20, givers: [], enders: [] }), quest(3, { links: { NextQuestInChain: 4 } }), quest(4, { links: { NextQuestInChain: 3 } })], [77]),
	)
	assert.match(at(g, 1).problems.join(' '), /breadcrumb target 77 has no quest_template row/)
	assert.equal(at(g, 77).quest, null)
	assert.equal(g.edges.find((e) => e.to === 77)!.missing, true)
	const p2 = at(g, 2).problems.join(' ')
	assert.match(p2, /Nothing starts it/)
	assert.match(p2, /Nothing ends it/)
	assert.match(p2, /10 levels above Q1 \(1\)/)
	assert.equal(g.edges.find((e) => e.from === 1 && e.to === 2)!.jump, 10)
	assert.equal(g.edges.filter((e) => e.loop).length, 1)
	assert.match(at(g, 3).problems.join(' ') + at(g, 4).problems.join(' '), /links loop/)
})

test('a level that scales is never a jump', () => {
	const g = chainGraph(chain([quest(1, { level: -1, links: { NextQuestId: 2 } }), quest(2, { level: 60 })]))
	assert.equal(g.edges[0].jump, null)
})

test('exclusive groups: members listed, a member without arrows takes its siblings column', () => {
	const g = chainGraph(chain([quest(1, { links: { NextQuestId: 2 } }), quest(2, { group: 5 }), quest(3, { group: 5 }), quest(4, { group: 9 })]))
	assert.deepEqual(g.groups.get(5), [2, 3])
	assert.equal(g.groups.has(9), false, 'a group of one is no group')
	assert.equal(at(g, 3).layer, at(g, 2).layer)
	assert.notEqual(at(g, 3).row, at(g, 2).row)
})
