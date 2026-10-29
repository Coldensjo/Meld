// Run with: bun test tests/signs.test.ts
// Swap sign (#843): which doodads are signs, which are road signs, and the order the picker lists them in.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { buildCatalog } from '../src/lib/wow/catalog.ts'
import { indexCatalog } from '../src/lib/wow/search.ts'
import { isRoadSign, isSignModel, signModels } from '../src/lib/wow/signs.ts'

const POSTS = 'World\\Generic\\Human\\Passive Doodads\\SignPosts\\'
const catalog = [
	...indexCatalog(
		'm2',
		buildCatalog('m2', [
			'World\\Azeroth\\Elwynn\\PassiveDoodads\\Signs\\Directional\\Goldshiredirectionalsign.m2',
			`${POSTS}WoodSignPointerWorn01.m2`,
			`${POSTS}HumanSignPost01.m2`,
			'World\\Generic\\Dwarf\\Passive Doodads\\Signs\\DwarfSign_Bank.m2',
			'World\\Generic\\Human\\Passive Doodads\\Barrels\\Barrel01.m2',
			'World\\Generic\\Titan\\Passive Doodads\\Designs\\Design01.m2',
		]),
	),
	...indexCatalog('wmo', buildCatalog('wmo', ['World\\wmo\\Azeroth\\Buildings\\Signs\\SignHouse.wmo'])),
]

test('a sign is a doodad with "sign" in its path, not "design" and not a building', () => {
	assert.equal(isSignModel(`m2:${POSTS}WoodSignPointerWorn01.m2`), true)
	assert.equal(isSignModel('m2:World\\Generic\\Dwarf\\Passive Doodads\\Signs\\DwarfSign_Bank.m2'), true)
	assert.equal(isSignModel('m2:World\\Generic\\Titan\\Passive Doodads\\Designs\\Design01.m2'), false)
	assert.equal(isSignModel('wmo:World\\wmo\\Azeroth\\Buildings\\Signs\\SignHouse.wmo'), false)
	assert.equal(isSignModel('helper:cube'), false)
})

test('road signs are the posts, pointers and directional signs', () => {
	assert.equal(isRoadSign(`${POSTS}WoodSignPointerWorn01.m2`), true)
	assert.equal(isRoadSign('World\\Azeroth\\Elwynn\\PassiveDoodads\\Signs\\Directional\\Goldshiredirectionalsign.m2'), true)
	assert.equal(isRoadSign('World\\Generic\\Dwarf\\Passive Doodads\\Signs\\DwarfSign_Bank.m2'), false)
})

test('the list holds the sign doodads only, those in the current sign folder first', () => {
	const names = (items: { name: string }[]) => items.map((it) => it.name)
	const all = signModels(catalog)
	assert.equal(all.length, 4)
	assert.ok(all.every((it) => it.kind === 'm2'))
	const near = signModels(catalog, `m2:${POSTS}HumanSignPost01.m2`)
	assert.deepEqual(names(near.slice(0, 2)), names(signModels(catalog.filter((it) => it.path.startsWith(POSTS)))))
	assert.equal(near.length, 4)
})
