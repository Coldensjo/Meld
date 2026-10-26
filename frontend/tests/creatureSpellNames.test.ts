// Run with: bun test tests/creatureSpellNames.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CAST_FLAGS, CAST_TARGETS, SELECT_FLAGS, castTarget, paramKind, spellLabel } from '../src/lib/wow/creatureSpellNames.ts'

test('the targets and flags match VMaNGOS', () => {
	assert.equal(castTarget(0).name, 'Itself') // TARGET_T_PROVIDED_TARGET: the creature casting
	assert.equal(castTarget(1).name, 'Its current target') // TARGET_T_HOSTILE
	assert.deepEqual(castTarget(17).params, ['Radius (yd)', 'Below health %']) // TARGET_T_FRIENDLY_INJURED
	assert.equal(new Set(CAST_TARGETS.map((t) => t.id)).size, CAST_TARGETS.length)
	// CF_TARGET_CASTING is the last of ALL_CAST_FLAGS.
	assert.equal(
		CAST_FLAGS.reduce((m, f) => m | f.bit, 0),
		0x1ff,
	)
})

test('a target the list leaves out keeps both parameters', () => {
	assert.equal(castTarget(22).name, 'Target type 22')
	assert.deepEqual(castTarget(22).params, ['Parameter 1', 'Parameter 2'])
})

test('spellLabel adds the rank', () => {
	assert.equal(spellLabel('Fireball', 'Rank 1'), 'Fireball (Rank 1)')
	assert.equal(spellLabel('Hamstring', ''), 'Hamstring')
	assert.equal(spellLabel('', ''), '(not in the client)')
})

test('the parameters that name things get pickers, the quantities stay numbers', () => {
	assert.equal(paramKind(castTarget(10).params[0] ?? ''), 'creature')
	assert.equal(paramKind(castTarget(10).params[1] ?? ''), 'number')
	assert.equal(paramKind(castTarget(19).params[1] ?? ''), 'spell')
	assert.equal(paramKind(castTarget(2).params[0] ?? ''), 'select flags')
	assert.equal(paramKind(castTarget(16).params[1] ?? ''), 'bool')
	assert.equal(paramKind('Parameter 1'), 'number')
	// MAX_SELECT_FLAG_MASK: every SELECT_FLAG_* bit, 0x020 unused.
	assert.equal(
		SELECT_FLAGS.reduce((m, f) => m | f.bit, 0),
		0x1fdf,
	)
})
