// Run with: bun test tests/zoneTrees.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { doodadKind, setScatter, worldRules, zoneScatter, type DoodadUse } from '../src/lib/wow/zoneTrees.ts'

test('doodadKind sorts trees, bushes and rocks and leaves the rest out', () => {
	assert.equal(doodadKind('world\\azeroth\\duskwood\\passivedoodads\\trees\\duskwoodbrowntree.mdx'), 'tree')
	assert.equal(doodadKind('world\\azeroth\\duskwood\\passivedoodads\\spooklesstrees\\duskwoodtreespookless02.mdx'), 'tree')
	assert.equal(doodadKind('world\\kalimdor\\durotar\\passivedoodads\\trees\\durotarpalm01.mdx'), 'tree')
	assert.equal(doodadKind('world\\khazmodan\\badlands\\passivedoodads\\cactus\\badlandscactus_1.mdx'), 'tree')
	assert.equal(doodadKind('world\\azeroth\\duskwood\\passivedoodads\\bush\\duskwoodspookybush04.mdx'), 'bush')
	assert.equal(doodadKind('world\\khazmodan\\wetlands\\passivedoodads\\bushes\\wetlandgrass02.mdx'), 'bush')
	assert.equal(doodadKind('world\\kalimdor\\tanaris\\passivedoodads\\rocks\\tanarisrock07.mdx'), 'rock')
	assert.equal(doodadKind('world\\azeroth\\elwynn\\passivedoodads\\cliffrocks\\elwynncliffrock01.mdx'), 'rock')
	assert.equal(doodadKind('world\\azeroth\\stranglethorn\\passivedoodads\\trees\\stranglethornforesttree01.mdx'), 'tree')
	for (const p of [
		'world\\azeroth\\westfall\\passivedoodads\\westfallfence\\westfallfence.mdx',
		'world\\azeroth\\duskwood\\passivedoodads\\tombs\\tombstone06.mdx',
		'world\\azeroth\\duskwood\\passivedoodads\\irongate\\gatesegment01.mdx',
		'world\\generic\\troll\\passive doodads\\trollskullpile\\trollskullpile.mdx',
		'world\\generic\\passivedoodads\\lights\\generaltorch01.mdx',
		'world\\critter\\butterflies\\butterflypurple01.mdx',
		'world\\azeroth\\duskwood\\passivedoodads\\bush\\pumpkinpatch01.mdx',
	])
		assert.equal(doodadKind(p), null, p)
})

const use = (path: string, count: number, scaleMin = 0.8, scaleMax = 1.2): DoodadUse => ({ path, count, scaleMin, scaleMax })

test('zoneScatter weights the most placed plants and rocks by count, at the zone density', () => {
	const uses = [use('w\\fence\\fence.mdx', 900), use('w\\trees\\a.mdx', 500, 0.5, 1.5), use('w\\bush\\b.mdx', 300), use('w\\rocks\\r.mdx', 200, 0.6, 4.8), use('w\\trees\\rare.mdx', 5)]
	const s = zoneScatter(uses, 1e6)
	assert.deepEqual(
		s.plants?.entries.map((e) => [e.type, e.weight]),
		[
			['m2:w\\trees\\a.mdx', 500],
			['m2:w\\bush\\b.mdx', 300],
		],
	)
	assert.equal(s.rocks?.entries.length, 1)
	// Tanaris's huge rocks are kept to a sane size.
	assert.equal(s.rocks?.entries[0].scaleMax, 2.5)
	assert.ok(Math.abs(s.plantDensity - 8.05) < 1e-9)
	assert.equal(s.rockDensity, 2)
	assert.equal(s.plants?.rules?.avoidWater, true)
	worldRules(s, 2, 80)
	assert.deepEqual(s.plants?.rules?.height, [2, 80])
	assert.deepEqual(s.rocks?.rules?.height, [2, 80])
	assert.equal(zoneScatter([use('w\\fence\\fence.mdx', 9)], 1e6).plants, null)
})

test('setScatter takes a set’s doodads, rocks apart, and no buildings', () => {
	const s = setScatter(['m2:w\\trees\\a.m2', 'm2:w\\odd\\thing.m2', 'm2:w\\rocks\\r.m2', 'wmo:w\\house.wmo'])
	assert.deepEqual(
		s.plants?.entries.map((e) => e.type),
		['m2:w\\trees\\a.m2', 'm2:w\\odd\\thing.m2'],
	)
	assert.deepEqual(
		s.rocks?.entries.map((e) => e.type),
		['m2:w\\rocks\\r.m2'],
	)
	assert.ok(s.plantDensity > 0 && s.rockDensity > 0)
})
