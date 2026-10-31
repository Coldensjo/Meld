// Run with: bun test tests/questChecks.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { checkQuests, type QuestReport } from '../src/lib/check/quests.ts'
import { chainSteps, levelJump, LEVEL_JUMP, questLinks } from '../src/lib/world/questChain.ts'
import type { vmangos } from '../src/lib/wails/models'

type Quest = vmangos.CheckedQuest

const quest = (entry: number, over: Partial<Quest> = {}): Quest => ({
	entry,
	title: `Q${entry}`,
	level: 10,
	specialFlags: 0,
	links: {},
	kills: [],
	items: [],
	srcItem: 0,
	givers: [{ kind: 'creature', id: 1 }],
	enders: [{ kind: 'creature', id: 1 }],
	itemStarts: [],
	triggers: [],
	...over,
})

const report = (quests: Quest[], over: Partial<QuestReport> = {}): QuestReport => ({
	quests,
	linked: [],
	spawns: [{ kind: 'creature', id: 1, name: 'Marshal', exists: true, world: 1, events: 0 }],
	summoned: [],
	items: [],
	missingTriggers: [],
	error: '',
	...over,
})

const marshal = { key: 'c:1', kind: 'creature', entry: 1, x: 10, z: 20 }

test('quest chain: the links and the steps they make, in the order a player meets them', () => {
	assert.deepEqual(questLinks({ PrevQuestId: -5, NextQuestInChain: 9, BreadcrumbForQuestId: 0 }), [
		{ col: 'PrevQuestId', quest: 5 },
		{ col: 'NextQuestInChain', quest: 9 },
	])
	// A done-first previous quest leads here; a taken-not-done one (negative) and a breadcrumb are no steps.
	assert.deepEqual(chainSteps(7, { PrevQuestId: 5, NextQuestId: 8, NextQuestInChain: 9 }), [
		{ from: 5, to: 7, via: 'PrevQuestId' },
		{ from: 7, to: 8, via: 'NextQuestId' },
		{ from: 7, to: 9, via: 'NextQuestInChain' },
	])
	assert.deepEqual(chainSteps(7, { PrevQuestId: -5, NextQuestId: -8, BreadcrumbForQuestId: 3 }), [])
	// The same next quest through both columns is one step.
	assert.equal(chainSteps(7, { NextQuestId: 8, NextQuestInChain: 8 }).length, 1)
	assert.equal(levelJump(10, 10 + LEVEL_JUMP), null)
	assert.equal(levelJump(10, 11 + LEVEL_JUMP), LEVEL_JUMP + 1)
	assert.equal(levelJump(0, 40), null)
	assert.equal(levelJump(40, 10), null)
})

test('quests: a clean quest finds nothing, and its findings point at its giver on the map', () => {
	assert.deepEqual(checkQuests([marshal], report([quest(7)]), null), [])
	const [f] = checkQuests([marshal], report([quest(7, { enders: [] })]), null)
	assert.equal(f.severity, 'error')
	assert.equal(f.group, 'world')
	assert.match(f.message, /^Q7 \(quest 7\): nothing ends it/)
	assert.deepEqual([f.x, f.z], [10, 20])
	assert.deepEqual(f.target, { kind: 'quest', quest: 7, key: 'c:1' })
})

test('quests: givers and enders spawned nowhere, only in an event, or only elsewhere', () => {
	const spawns: vmangos.SpawnTally[] = [
		{ kind: 'creature', id: 1, name: 'Marshal', exists: true, world: 1, events: 0 },
		{ kind: 'creature', id: 2, name: 'Ghost', exists: true, world: 0, events: 0 },
		{ kind: 'creature', id: 3, name: 'Reveller', exists: true, world: 2, events: 2 },
		{ kind: 'object', id: 4, name: 'Board', exists: true, world: 3, events: 0 },
	]
	const found = checkQuests(
		[marshal],
		report(
			[
				// No giver spawned: an error. The ender is on the map.
				quest(10, { givers: [{ kind: 'creature', id: 2 }] }),
				// No giver spawned, but an item starts it too: fine.
				quest(11, { givers: [{ kind: 'creature', id: 2 }], itemStarts: [900] }),
				// Nothing starts it at all: a warning.
				quest(12, { givers: [] }),
				// The ender only in an event: info.
				quest(13, { enders: [{ kind: 'creature', id: 3 }] }),
				// The ender spawned, but not in the open map: info.
				quest(14, { enders: [{ kind: 'object', id: 4 }] }),
				// The ender spawned only on the open map, not yet saved: fine.
				quest(15, { enders: [{ kind: 'creature', id: 5 }] }),
			],
			{ spawns },
		),
		null,
	)
	const of = (q: number) => found.filter((f) => f.target.kind === 'quest' && f.target.quest === q)
	assert.equal(of(10).length, 1)
	assert.equal(of(10)[0].severity, 'error')
	assert.match(of(10)[0].message, /no giver is spawned \(Ghost \(creature 2\) starts it\), so no one can take it/)
	assert.deepEqual(of(11), [])
	assert.equal(of(12)[0].severity, 'warning')
	assert.match(of(13)[0].message, /enders spawn only during a game event \(Reveller/)
	assert.equal(of(13)[0].severity, 'info')
	assert.match(of(14)[0].message, /none of its enders is in the open map \(Board \(object 4\) is spawned elsewhere\)/)
	assert.deepEqual(checkQuests([marshal, { key: 'c:new', kind: 'creature', entry: 5, x: 0, z: 0 }], report([quest(15, { enders: [{ kind: 'creature', id: 5 }] })], { spawns }), null), [])
	assert.equal(found.length, 5)
	assert.ok(found.every((f) => f.check === 'Quest givers and enders'))
})

test('quests: a chain link to no quest, and a step that climbs too steeply', () => {
	const found = checkQuests(
		[marshal],
		report(
			[
				quest(20, { level: 5, links: { NextQuestInChain: 21, BreadcrumbForQuestId: 99 } }),
				// Both ends say 20 > 21: one finding. 21 > 22 climbs too; 22 is not on the map but is known.
				quest(21, { level: 14, links: { PrevQuestId: 20, NextQuestId: 22 } }),
			],
			{ linked: [{ entry: 22, title: 'Far', level: 30 }] },
		),
		null,
	)
	const chains = found.filter((f) => f.check === 'Quest chains')
	assert.equal(chains.length, 1)
	assert.match(chains[0].message, /^Q20 \(quest 20\): its breadcrumb target 99 has no quest_template row \(BreadcrumbForQuestId\)/)
	const levels = found.filter((f) => f.check === 'Quest levels').map((f) => f.message)
	assert.deepEqual(levels, ['Q21 (quest 21) (level 14) follows Q20 (quest 20) (level 5): 9 levels higher, more than 5.', 'Far (quest 22) (level 30) follows Q21 (quest 21) (level 14): 16 levels higher, more than 5.'])
})

test('quests: objectives no one can complete', () => {
	const found = checkQuests(
		[marshal],
		report(
			[
				quest(30, {
					// 600 unspawned, 601 summoned by a script, 602 has no template, object 700 unspawned, 603 only in an event.
					kills: [600, 601, 602, -700, 603],
					// 800 drops nowhere, 801 drops, 802 has no template.
					items: [800, 801, 802],
					triggers: [40, 41],
				}),
			],
			{
				spawns: [
					{ kind: 'creature', id: 1, name: 'Marshal', exists: true, world: 1, events: 0 },
					{ kind: 'creature', id: 600, name: 'Wolf', exists: true, world: 0, events: 0 },
					{ kind: 'creature', id: 601, name: 'Imp', exists: true, world: 0, events: 0 },
					{ kind: 'creature', id: 602, name: '', exists: false, world: 0, events: 0 },
					{ kind: 'creature', id: 603, name: 'Reveller', exists: true, world: 1, events: 1 },
					{ kind: 'object', id: 700, name: 'Crate', exists: true, world: 0, events: 0 },
				],
				summoned: [601],
				items: [
					{ id: 800, name: 'Pelt', exists: true, sourced: false },
					{ id: 801, name: 'Fang', exists: true, sourced: true },
					{ id: 802, name: '', exists: false, sourced: false },
				],
				missingTriggers: [41],
			},
		),
		null,
	)
	const msgs = found.map((f) => `${f.severity} ${f.message.replace('Q30 (quest 30): ', '')}`)
	assert.deepEqual(msgs, [
		"error its objective names creature 602, which has no creature_template row, so it can't be completed.",
		"error its objective names item 802, which has no item_template row, so it can't be completed.",
		"error area trigger 41, which completes it, has no areatrigger_template row, so it can't be explored.",
		"warning Wolf (creature 600), which it asks to kill, has no spawn and no script or spell summons it, so it can't be completed (fine if a C++ script spawns it).",
		"warning Crate (object 700), which it asks to use, has no spawn, so it can't be completed (fine if a C++ script spawns it).",
		'warning nothing drops, sells or gives Pelt (item 800), which it asks for: no loot, vendor, quest or spell row has it.',
		'info Reveller (creature 603), which it asks to kill, spawns only during a game event.',
	])
	assert.ok(found.every((f) => f.check === 'Quest objectives'))
})

test('quests: a quest check that failed says so, and a quest without a giver on the map has nowhere to go', () => {
	const [f] = checkQuests([], report([], { error: 'reading x: boom' }), null)
	assert.equal(f.check, 'World data')
	assert.match(f.message, /quests weren't checked: reading x: boom/)
	const [g] = checkQuests([], report([quest(7, { enders: [] })]), null)
	assert.ok(Number.isNaN(g.x))
	assert.deepEqual(g.target, { kind: 'quest', quest: 7 })
})
