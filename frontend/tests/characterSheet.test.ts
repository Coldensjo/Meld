// Run with: bun test tests/characterSheet.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import type { vmangos } from '../src/lib/wails/models'
import { fixSkill, honorRankOf, honorRanks, lookOptions, newSkill, repProgress, repRank, REP_RANKS } from '../src/lib/wow/characterSheet.ts'

test('a standing falls in the rank the server gives it', () => {
	const name = (s: number) => REP_RANKS[repRank(s)][0]
	assert.equal(name(-42000), 'Hated')
	assert.equal(name(-6001), 'Hated')
	assert.equal(name(-6000), 'Hostile')
	assert.equal(name(-1), 'Unfriendly')
	assert.equal(name(0), 'Neutral')
	assert.equal(name(2999), 'Neutral')
	assert.equal(name(3000), 'Friendly')
	assert.equal(name(20999), 'Honored')
	assert.equal(name(42000), 'Exalted')
	assert.equal(name(42999), 'Exalted')
	assert.deepEqual(repProgress(4055), [1055, 6000])
	assert.deepEqual(repProgress(42500), [500, 1000])
})

test('rank points give the honor rank HonorMgr::CalculateRank does', () => {
	assert.equal(honorRankOf(0), 0)
	assert.equal(honorRankOf(1500), 5) // rank 1
	assert.equal(honorRankOf(2000), 6) // rank 2
	assert.equal(honorRankOf(14999), 8) // rank 4
	assert.equal(honorRankOf(59999), 17) // rank 13
	assert.equal(honorRankOf(60001), 18) // rank 14
	assert.equal(honorRankOf(-1000), 4)
	assert.equal(honorRankOf(-2500), 3)
	assert.equal(honorRankOf(-20000), 1)
	assert.equal(honorRanks(2)[18][1], '14 · High Warlord')
	assert.equal(honorRanks(1)[5][1], '1 · Private')
})

test('the look offers what goes with the parts chosen', () => {
	const l: vmangos.CharLooks = {
		skins: [0, 1],
		faces: [
			[0, 0],
			[1, 0],
			[0, 1],
		],
		hair: [
			[0, 0],
			[0, 1],
			[2, 0],
		],
		facialHair: [0, 1, 2],
		facialColors: [
			[0, 0],
			[1, 0],
			[0, 1],
		],
		checkFacial: true,
	}
	const o = lookOptions(l, 1, 2, 1)
	assert.deepEqual(o.face, [0])
	assert.deepEqual(o.hair_style, [0, 2])
	assert.deepEqual(o.hair_color, [0])
	assert.deepEqual(o.facial_hair, [0])
	assert.deepEqual(lookOptions({ ...l, checkFacial: false }, 0, 0, 1).facial_hair, [0, 1, 2])
})

test('a skill gets the range the server sets', () => {
	const c = (range: string, top = 0): vmangos.SkillChoice => ({ id: 1, name: 'x', category: 6, range, top })
	assert.deepEqual(fixSkill({ skill: 1, value: 5, max: 20 }, c('language'), 10), { skill: 1, value: 300, max: 300 })
	assert.deepEqual(fixSkill({ skill: 1, value: 5, max: 20 }, c('mono'), 10), { skill: 1, value: 1, max: 1 })
	assert.deepEqual(fixSkill({ skill: 1, value: 80, max: 300 }, c('level'), 10), { skill: 1, value: 50, max: 50 })
	assert.deepEqual(fixSkill({ skill: 1, value: 400, max: 400 }, c('rank', 300), 10), { skill: 1, value: 300, max: 300 })
	assert.deepEqual(newSkill(c('rank', 300), 10), { skill: 1, value: 1, max: 75 })
	assert.deepEqual(newSkill(c('level'), 4), { skill: 1, value: 1, max: 20 })
})
