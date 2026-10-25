// Run with: bun test tests/objectFields.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CURSOR_ICONS, dataField, modelName, objectFieldGroups } from '../src/lib/world/objectFields.ts'
import { lockText } from '../src/lib/wow/locks.ts'

const fields = (type: number, model = '') => objectFieldGroups(type, model).flatMap((g) => g.fields)
const field = (type: number, label: string) => fields(type).find((f) => f.label === label)

test('the game object editor names its id columns with pickers (#702)', () => {
	const id = (col: string) => fields(0).find((f) => f.col === col)
	assert.equal(id('faction')?.ref, 'faction template')
	assert.ok(id('icon')?.suggest?.includes('PickLock'))
	assert.ok(CURSOR_ICONS.includes('Point'))
	// A chest (type 3): lock, loot, looted event, linked trap, quest, open text.
	assert.equal(field(3, 'Lock')?.ref, 'lock')
	assert.equal(field(3, 'Loot')?.ref, 'loot')
	assert.equal(field(3, 'Looted event')?.ref, 'event')
	assert.equal(field(3, 'Linked trap')?.ref, 'object')
	assert.equal(field(3, 'Quest')?.ref, 'quest')
	assert.equal(field(3, 'Open text')?.ref, 'text')
	assert.equal(field(3, 'Level')?.ref, undefined)
	assert.equal(field(2, 'Gossip menu')?.ref, 'gossip')
	assert.equal(field(9, 'Page')?.ref, 'page')
	assert.equal(field(9, 'Language')?.ref, 'language')
	assert.equal(field(9, 'Page material')?.ref, 'page material')
	assert.equal(field(8, 'Spell focus')?.ref, 'spell focus')
	assert.equal(field(13, 'Cinematic')?.ref, 'cinematic')
	assert.equal(field(15, 'Taxi path')?.ref, 'taxi path')
	assert.equal(field(20, 'Auction house')?.ref, 'auction house')
	assert.equal(field(21, 'Creature')?.ref, 'creature')
	assert.equal(field(23, 'Zone')?.ref, 'zone')
	assert.equal(field(12, 'Damage school')?.options?.[2]?.[1], 'Fire')
	// The spell columns stay spell pickers, the 0/1 ones checkboxes.
	assert.equal(field(24, 'Return aura')?.ref, 'spell')
	assert.equal(dataField('?Large', 5).bool, true)
	assert.equal(dataField('?Large', 5).ref, undefined)
})

test('the Display box names its model', () => {
	const d = fields(0, 'World\\Generic\\Chest01.mdx').find((f) => f.col === 'displayId')
	assert.equal(d?.note?.('31'), 'Chest01')
	assert.equal(d?.note?.('0'), '')
	assert.equal(
		fields(0)
			.find((f) => f.col === 'displayId')
			?.note?.('5'),
		'no model',
	)
	assert.equal(modelName('a/b/Door.m2'), 'Door')
})

test('a lock is named by what opens it', () => {
	const types = [
		{ id: 1, name: 'Pick Lock' },
		{ id: 3, name: 'Mining' },
	]
	const lock = (parts: Array<{ type: number; index: number; skill: number }>) => ({ id: 9, parts })
	assert.equal(
		lockText(
			lock([
				{ type: 2, index: 1, skill: 25 },
				{ type: 1, index: 5, skill: 0 },
			]),
			types,
			(id) => (id === 5 ? 'Tower Key' : null),
		),
		'Pick Lock 25 or key Tower Key',
	)
	assert.equal(
		lockText(
			lock([
				{ type: 2, index: 3, skill: 0 },
				{ type: 1, index: 7, skill: 0 },
			]),
			types,
			() => null,
		),
		'Mining or key item 7',
	)
	assert.equal(
		lockText(lock([]), types, () => null),
		'Nothing opens it',
	)
})
