// Run with: bun test tests/editorFields.test.ts
// The editors' pure field helpers (#522), which only the editor probes reached before.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { CREATURE_FIELD_GROUPS, changedValues, fieldGroups, withBit } from '../src/lib/world/creatureFields.ts'
import { subclassOptions, slotKind } from '../src/lib/world/itemFields.ts'

test('withBit sets and clears a bit and round-trips, as unsigned text', () => {
	assert.equal(withBit('0', 4, true), '4')
	assert.equal(withBit('4', 4, true), '4', 'setting a set bit changes nothing')
	assert.equal(withBit('5', 4, false), '1')
	assert.equal(withBit('1', 4, false), '1', 'clearing a clear bit changes nothing')
	assert.equal(withBit('', 2, true), '2', 'an empty value counts as 0')
	assert.equal(withBit('junk', 1, true), '1', 'so does text that is no number')
	const top = 0x80000000
	assert.equal(withBit('0', top, true), String(top), 'the top bit stays unsigned')
	assert.equal(withBit(withBit('0', top, true), top, false), '0')
	for (const v of ['0', '7', '1024', '4294967295'])
		for (let b = 0; b < 32; b++) {
			const bit = 2 ** b
			assert.equal(withBit(withBit(withBit(v, bit, true), bit, false), bit, (Number(v) & bit) !== 0), v, `${v} bit ${b}`)
		}
})

test('withBit keeps a negative mask signed (allowable_class -1, every class)', () => {
	assert.equal(withBit('-1', 2, false), '-3')
	assert.equal(withBit('-3', 2, true), '-1')
})

test('changedValues gives only the keys whose values differ', () => {
	assert.deepEqual(changedValues({ a: '1', b: '2', c: '3' }, { a: '1', b: '5', c: '3' }), { b: '2' })
	assert.deepEqual(changedValues({ a: '1' }, { a: '1' }), {}, 'nothing changed')
	assert.deepEqual(changedValues({ a: '1', n: '' }, { a: '1' }), { n: '' }, 'a key the old record lacks counts as changed')
	assert.deepEqual(changedValues({ a: '1' }, { a: '1', gone: '2' }), {}, 'a key only the old record has is not reported')
})

test('fieldGroups keeps the known columns the table has, in their groups, and puts the rest under Other', () => {
	const groups = fieldGroups(['entry_x', 'subname', 'name', 'some_new_col'])
	const identity = groups.find((g) => g.title === 'Identity')
	assert.ok(identity)
	assert.deepEqual(
		identity.fields.map((f) => f.col),
		['name', 'subname'],
		'in the listed order, not the columns order',
	)
	const other = groups.at(-1)
	assert.equal(other?.title, 'Other')
	assert.deepEqual(
		other?.fields.map((f) => [f.col, f.label]),
		[
			['entry_x', 'entry x'],
			['some_new_col', 'some new col'],
		],
	)
	for (const g of groups) assert.ok(g.fields.length, `no empty group (${g.title})`)
	assert.equal(groups.length, 2, 'groups without any of the columns are dropped')
})

test('fieldGroups over no listed groups puts every column under Other, and no columns give no groups', () => {
	assert.deepEqual(fieldGroups(['a_b'], []), [{ title: 'Other', fields: [{ col: 'a_b', label: 'a b' }] }])
	assert.deepEqual(fieldGroups([]), [])
	const all = CREATURE_FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.col))
	assert.ok(!fieldGroups(all).some((g) => g.title === 'Other'), 'every known column has its group')
})

test('subclassOptions lists a class subclasses, and a class without any gets None', () => {
	assert.equal(subclassOptions(1)[0][1], 'Bag')
	assert.ok(subclassOptions(2).length > 10, 'weapons have many')
	assert.deepEqual(subclassOptions(99), [[0, 'None']])
	assert.deepEqual(subclassOptions(-1), [[0, 'None']])
})

test('slotKind groups inventory types as the look picker does', () => {
	const cases: Array<[number, string]> = [
		[13, 'weapon'],
		[17, 'weapon'],
		[21, 'weapon'],
		[22, 'weapon'],
		[14, 'shield'],
		[23, 'held'],
		[15, 'ranged'],
		[25, 'ranged'],
		[26, 'ranged'],
		[1, 'head'],
		[3, 'shoulder'],
		[16, 'back'],
		[5, 'body'],
		[20, 'body'],
		[2, 'jewelry'],
		[11, 'jewelry'],
		[12, 'jewelry'],
		[0, 'other'],
		[18, 'other'],
		[24, 'other'],
	]
	for (const [inv, kind] of cases) assert.equal(slotKind(inv), kind, `inventory type ${inv}`)
})
