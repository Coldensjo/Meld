// Run with: bun test tests/inventory.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import type { vmangos } from '../src/lib/wails/models'
import { firstProblem, fitsBag, freePlaces, moveItem, newItem, placeFor, removeItem, wearProblem } from '../src/lib/wow/inventory.ts'

const tpl = (o: Partial<vmangos.InventoryTemplate>): vmangos.InventoryTemplate => ({
	entry: 0,
	name: '',
	quality: 1,
	displayId: 0,
	invType: 0,
	class: 0,
	subclass: 0,
	stackable: 1,
	maxDurability: 0,
	containerSlots: 0,
	bagFamily: 0,
	requiredLevel: 0,
	allowableClass: -1,
	allowableRace: -1,
	...o,
})

const sword = tpl({ entry: 25, name: 'Sword', invType: 21, maxDurability: 20 })
const axe = tpl({ entry: 1, name: 'Axe', invType: 17, maxDurability: 75 })
const shield = tpl({ entry: 2362, name: 'Shield', invType: 14 })
const pouch = tpl({ entry: 4496, name: 'Pouch', invType: 18, class: 1, containerSlots: 6 })
const quiver = tpl({ entry: 2101, name: 'Quiver', invType: 27, class: 11, subclass: 2, containerSlots: 8, bagFamily: 1 })
const arrow = tpl({ entry: 2512, name: 'Arrow', invType: 24, bagFamily: 1, stackable: 200 })
const jerky = tpl({ entry: 117, name: 'Jerky', stackable: 20 })

const at = (t: vmangos.InventoryTemplate, container: number, slot: number, guid = 0): vmangos.InventoryItem => ({ ...newItem(t, { container, slot }), guid })

const items = [at(sword, 0, 15, 1), at(shield, 0, 16, 6), at(pouch, 0, 19, 8), at(jerky, 19, 2, 9), at(jerky, 0, 23, 5)]

test('what the character has is fine', () => {
	assert.equal(firstProblem(items), null)
})

test('a move swaps, and refuses a slot that does not take the item', () => {
	const moved = moveItem(items, { container: 0, slot: 23 }, { container: 19, slot: 2 })
	assert.ok(Array.isArray(moved))
	assert.equal(moved.find((i) => i.guid === 5)?.container, 19)
	assert.equal(moved.find((i) => i.guid === 9)?.slot, 23)
	assert.match(String(moveItem(items, { container: 0, slot: 16 }, { container: 0, slot: 15 })), /Sword doesn't go in the off hand/)
	assert.match(String(moveItem(items, { container: 0, slot: 23 }, { container: 0, slot: 20 })), /is not a bag/)
	assert.match(String(moveItem(items, { container: 0, slot: 23 }, { container: 19, slot: 6 })), /has 6 slots/)
})

test('a bag holding items stays in a bag slot and takes its contents along', () => {
	assert.match(String(moveItem(items, { container: 0, slot: 19 }, { container: 0, slot: 30 })), /Empty Pouch first/)
	assert.match(String(moveItem(items, { container: 0, slot: 19 }, { container: 19, slot: 0 })), /into itself/)
	const moved = moveItem(items, { container: 0, slot: 19 }, { container: 0, slot: 21 })
	assert.ok(Array.isArray(moved))
	assert.equal(moved.find((i) => i.guid === 9)?.container, 21)
})

test('a two-handed weapon leaves the off hand empty', () => {
	const two = [at(axe, 0, 30), ...items]
	assert.match(String(moveItem(two, { container: 0, slot: 30 }, { container: 0, slot: 15 })), /two-handed/)
})

test('special bags take only their kind', () => {
	assert.ok(fitsBag(arrow, quiver))
	assert.ok(!fitsBag(jerky, quiver))
	assert.ok(!fitsBag(pouch, quiver))
	assert.ok(fitsBag(pouch, pouch))
})

test('an added item goes where it is worn, else the backpack, else a bag', () => {
	assert.deepEqual(placeFor(items, tpl({ ...sword, entry: 26 }), null), { container: 0, slot: 24 })
	assert.deepEqual(placeFor(items, tpl({ entry: 38, invType: 4 }), null), { container: 0, slot: 3 })
	assert.deepEqual(placeFor(items, pouch, null), { container: 0, slot: 20 })
	assert.deepEqual(placeFor(items, jerky, { container: 19, slot: 0 }), { container: 19, slot: 0 })
	const full = [
		...items,
		...freePlaces(items)
			.filter((p) => p.container === 0 && p.slot >= 23)
			.map((p) => at(jerky, p.container, p.slot)),
	]
	assert.deepEqual(placeFor(full, jerky, null), { container: 19, slot: 0 })
	assert.equal(placeFor(full, arrow, { container: 19, slot: 2 }) !== null, true)
})

test('taking out a bag takes its contents', () => {
	const left = removeItem(items, { container: 0, slot: 19 })
	assert.deepEqual(
		left.map((i) => i.guid),
		[1, 6, 5],
	)
})

test('what a character cannot wear', () => {
	assert.equal(wearProblem(sword, 1, 1, 1), '')
	assert.equal(wearProblem(tpl({ allowableClass: 1 << 7 }), 1, 1, 60), 'not for its class')
	assert.equal(wearProblem(tpl({ allowableRace: 2 }), 1, 1, 60), 'not for its race')
	assert.equal(wearProblem(tpl({ requiredLevel: 10 }), 1, 1, 9), 'needs level 10')
})
