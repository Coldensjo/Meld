// Run with: bun test tests/creatureFields.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CREATURE_FIELD_GROUPS, MECHANIC_MASK, RACE_MASK, SCHOOL_MASK, STATIC_FLAGS1, ownListIds, withBit } from '../src/lib/world/creatureFields.ts'

const field = (col: string) => CREATURE_FIELD_GROUPS.flatMap((g) => g.fields).find((f) => f.col === col)

test('the creature editor gives its named columns a picker, select or tick list (#699)', () => {
	assert.equal(field('faction')?.ref, 'faction template')
	assert.ok(field('pet_family')?.options?.some(([v, n]) => v === 1 && n === 'Wolf'))
	assert.deepEqual(field('trainer_race')?.options?.slice(0, 3), [
		[0, 'None'],
		[1, 'Human'],
		[2, 'Orc'],
	])
	assert.ok(field('ai_name')?.suggest?.includes('EventAI'))
	for (const col of ['mechanic_immune_mask', 'school_immune_mask', 'immunity_flags', 'static_flags1', 'static_flags2', 'flags_extra']) assert.ok(field(col)?.flags?.length, col)
})

test("the creature editor's list ids pick from the world database's lists (#700)", () => {
	const lists: Array<[string, string, 'entry' | 'tens' | undefined]> = [
		['gossip_menu_id', 'gossip', undefined],
		['vendor_id', 'vendor', undefined],
		['trainer_id', 'trainer', undefined],
		['equipment_id', 'equipment', 'entry'],
		['loot_id', 'creature loot', 'entry'],
		['pickpocket_loot_id', 'pickpocket loot', 'entry'],
		['skinning_loot_id', 'skinning loot', 'entry'],
		['spell_list_id', 'spell list', 'tens'],
		['pet_spell_list_id', 'spell list', 'tens'],
	]
	for (const [col, ref, own] of lists) {
		assert.equal(field(col)?.ref, ref, col)
		assert.equal(field(col)?.own, own, col)
	}
})

test("a creature's own list is its entry, or its entry's tens for a spell list", () => {
	assert.deepEqual(ownListIds('entry', 448), [448])
	assert.deepEqual(ownListIds('tens', 3976).slice(0, 2), [39760, 39761])
	assert.equal(ownListIds('tens', 3976).at(-1), 39769)
	assert.deepEqual(ownListIds(undefined, 448), [])
	assert.deepEqual(ownListIds('entry', 0), [])
})

test('the masks put each name on its bit', () => {
	// Mechanic m is bit 1 << (m - 1): Charm (1) is 1, Stun (12) is 2048, Slow cast speed (31) is 1 << 30.
	assert.deepEqual(MECHANIC_MASK[0], [1, 'Charm'])
	assert.deepEqual(
		MECHANIC_MASK.find(([, n]) => n === 'Stun'),
		[2048, 'Stun'],
	)
	assert.equal(MECHANIC_MASK.at(-1)?.[0], 2 ** 30)
	// School s is bit 1 << s.
	assert.deepEqual(SCHOOL_MASK.slice(0, 3), [
		[1, 'Physical'],
		[2, 'Holy'],
		[4, 'Fire'],
	])
	// Race r is bit 1 << (r - 1).
	assert.deepEqual(RACE_MASK.at(-1), [128, 'Troll'])
})

test('the top static flag ticks and clears as an unsigned value', () => {
	const top = STATIC_FLAGS1.at(-1)![0]
	assert.equal(top, 0x80000000)
	const on = withBit('2', top, true)
	assert.equal(on, String(0x80000002))
	assert.notEqual(Number(on) & top, 0)
	assert.equal(withBit(on, top, false), '2')
})
