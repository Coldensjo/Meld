// Run with: bun test tests/inventory.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import type { vmangos } from '../src/lib/wails/models'
import { firstProblem, fitsBag, freePlaces, keyringSize, moveItem, newItem, placeFor, placeName, removeItem, rollRandomProperty, wearProblem } from '../src/lib/wow/inventory.ts'

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
	randomProperty: 0,
	randomChoices: [],
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

const key = tpl({ entry: 5396, name: 'Key', class: 13, bagFamily: 9 })
// A bank holding jerky, with a pouch in the first bank bag slot (one bought) holding jerky, and a key on the keyring.
const banked = [...items, at(jerky, 0, 40, 10), at(pouch, 0, 63, 11), at(jerky, 63, 0, 12), at(key, 0, 81, 14)]
const oneBought = { bankBags: 1 }

test('the bank, its bags and the keyring', () => {
	assert.equal(firstProblem(banked, oneBought), null)
	assert.equal(placeName({ container: 0, slot: 40 }), 'Bank slot 2')
	assert.equal(placeName({ container: 0, slot: 64 }), 'Bank bag slot 2')
	assert.equal(placeName({ container: 63, slot: 0 }), 'Bank bag 1, slot 1')
	assert.equal(placeName({ container: 0, slot: 82 }), 'Keyring slot 2')
	// Jerky moves from the bank into the bank's pouch and to the backpack.
	assert.ok(Array.isArray(moveItem(banked, { container: 0, slot: 40 }, { container: 63, slot: 1 }, oneBought)))
	assert.ok(Array.isArray(moveItem(banked, { container: 0, slot: 40 }, { container: 0, slot: 30 }, oneBought)))
	assert.match(String(moveItem(banked, { container: 0, slot: 40 }, { container: 0, slot: 82 }, oneBought)), /not a key/)
	assert.ok(Array.isArray(moveItem(banked, { container: 0, slot: 81 }, { container: 0, slot: 84 }, oneBought)))
	// A bank bag slot takes a bag the character has bought the slot for; not a quiver.
	assert.match(String(moveItem(banked, { container: 0, slot: 19 }, { container: 0, slot: 64 }, oneBought)), /bought 1/)
	assert.match(String(moveItem([...banked, at(quiver, 0, 30)], { container: 0, slot: 30 }, { container: 0, slot: 64 }, { bankBags: 2 })), /not a bag/)
	// Bags swapped between a bag slot and a bank bag slot take their contents along.
	const swapped = moveItem(banked, { container: 0, slot: 19 }, { container: 0, slot: 63 }, oneBought)
	assert.ok(Array.isArray(swapped))
	assert.equal(swapped.find((i) => i.guid === 9)?.container, 63)
	assert.equal(swapped.find((i) => i.guid === 12)?.container, 19)
	assert.match(String(moveItem(banked, { container: 0, slot: 63 }, { container: 0, slot: 45 }, oneBought)), /Empty Pouch first/)
	assert.deepEqual(
		removeItem(banked, { container: 0, slot: 63 }).map((i) => i.guid),
		[1, 6, 8, 9, 5, 10, 14],
	)
	// An added item goes into a picked bank square, but never to the bank by itself.
	assert.deepEqual(placeFor(banked, jerky, { container: 0, slot: 41 }, oneBought), { container: 0, slot: 41 })
	assert.deepEqual(placeFor(banked, jerky, null, oneBought), { container: 0, slot: 24 })
	assert.deepEqual([keyringSize(10), keyringSize(40), keyringSize(60)], [4, 8, 12])
})

test('a new item rolls its random property by chance', () => {
	const bear = tpl({
		...sword,
		randomProperty: 5168,
		randomChoices: [
			{ id: 6, name: 'of the Bear', chance: 40 },
			{ id: 15, name: 'of the Eagle', chance: 40 },
			{ id: 1547, name: 'of the Wolf', chance: 20 },
		],
	})
	assert.equal(rollRandomProperty(bear, 0), 6)
	assert.equal(rollRandomProperty(bear, 0.5), 15)
	assert.equal(rollRandomProperty(bear, 0.99), 1547)
	assert.equal(rollRandomProperty(sword, 0.5), 0)
	const it = newItem(bear, { container: 0, slot: 15 }, 0.85)
	assert.equal(it.randomProperty, 1547)
	assert.equal(it.randomName, 'of the Wolf')
})
