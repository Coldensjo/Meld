import type { vmangos } from '../wails/models'

// A character's equipment and bags (#874), as the Characters and Accounts tool edits them: where an
// item may go, by the world server's rules (Player::FindEquipSlot, ItemCanGoIntoBag). Go checks the
// same before it writes (internal/vmangos/inventory.go, checkInventory); these let the page refuse a
// move at once. A place is a container and a slot: container 0 is the character (equipment 0 to 18,
// bag slots 19 to 22, backpack 23 to 38), 19 to 22 the bag in that bag slot.

type Item = vmangos.InventoryItem
type Template = vmangos.InventoryTemplate

export interface Place {
	container: number
	slot: number
}

export const EQUIP_END = 19
export const BAG_SLOTS = [19, 20, 21, 22] as const
export const PACK_START = 23
export const PACK_END = 39
const MAIN_HAND = 15
const OFF_HAND = 16
const TWO_HAND = 17

/** The equipment slots: the name, a short label for an empty square, and the inventory types each takes. */
export const EQUIP_SLOTS: ReadonlyArray<{ slot: number; name: string; short: string; types: readonly number[] }> = [
	{ slot: 0, name: 'Head', short: 'Head', types: [1] },
	{ slot: 1, name: 'Neck', short: 'Neck', types: [2] },
	{ slot: 2, name: 'Shoulders', short: 'Shoul', types: [3] },
	{ slot: 3, name: 'Shirt', short: 'Shirt', types: [4] },
	{ slot: 4, name: 'Chest', short: 'Chest', types: [5, 20] },
	{ slot: 5, name: 'Waist', short: 'Waist', types: [6] },
	{ slot: 6, name: 'Legs', short: 'Legs', types: [7] },
	{ slot: 7, name: 'Feet', short: 'Feet', types: [8] },
	{ slot: 8, name: 'Wrists', short: 'Wrist', types: [9] },
	{ slot: 9, name: 'Hands', short: 'Hands', types: [10] },
	{ slot: 10, name: 'Finger', short: 'Ring', types: [11] },
	{ slot: 11, name: 'Finger', short: 'Ring', types: [11] },
	{ slot: 12, name: 'Trinket', short: 'Trink', types: [12] },
	{ slot: 13, name: 'Trinket', short: 'Trink', types: [12] },
	{ slot: 14, name: 'Back', short: 'Back', types: [16] },
	{ slot: 15, name: 'Main hand', short: 'Main', types: [13, 17, 21] },
	{ slot: 16, name: 'Off hand', short: 'Off', types: [13, 14, 22, 23] },
	{ slot: 17, name: 'Ranged', short: 'Rngd', types: [15, 25, 26] },
	{ slot: 18, name: 'Tabard', short: 'Tabrd', types: [19] },
]

/** The game's character frame: the slots down its left side, down its right side, and along the bottom. */
export const DOLL = { left: [0, 1, 2, 14, 4, 3, 18, 8], right: [9, 5, 6, 7, 10, 11, 12, 13], bottom: [15, 16, 17] } as const

export const placeKey = (p: Place) => `${p.container}:${p.slot}`
export const samePlace = (a: Place, b: Place) => a.container === b.container && a.slot === b.slot
export const itemAt = (items: readonly Item[], p: Place) => items.find((i) => samePlace(i, p))

/** The name of a place, for messages. */
export function placeName(p: Place): string {
	if (p.container === 0) {
		if (p.slot < EQUIP_END) return EQUIP_SLOTS[p.slot]?.name ?? `Slot ${p.slot}`
		if (p.slot < PACK_START) return `Bag slot ${p.slot - BAG_SLOTS[0] + 1}`
		return `Backpack slot ${p.slot - PACK_START + 1}`
	}
	return `Bag ${p.container - BAG_SLOTS[0] + 1}, slot ${p.slot + 1}`
}

/** Whether an item of template `t` can go into bag `b` (ItemCanGoIntoBag). */
export function fitsBag(t: Template, b: Template): boolean {
	if (b.bagFamily !== 0 && t.containerSlots !== 0) return false
	if (b.class === 1) return b.subclass === 0 || (b.subclass === 1 && t.bagFamily === 3) || (b.subclass === 2 && t.bagFamily === 6) || (b.subclass === 3 && t.bagFamily === 7)
	if (b.class === 11) return (b.subclass === 2 && t.bagFamily === 1) || (b.subclass === 3 && t.bagFamily === 2)
	return false
}

/** Whether `t` is a bag the bag slots take (a bag or a quiver). */
export const isBag = (t: Template) => (t.invType === 18 || t.invType === 27) && t.containerSlots > 0

/** Why `it` can't be where it is among `items`, or '' when it can. */
export function placeProblem(items: readonly Item[], it: Item): string {
	const t = it.template
	const name = t.name || `Item ${it.entry}`
	if (it.container === 0) {
		if (it.slot < 0 || it.slot >= PACK_END) return 'The editor places items only in the equipment, the bags and the backpack'
		if (it.slot < EQUIP_END) {
			if (!EQUIP_SLOTS[it.slot].types.includes(t.invType)) return `${name} doesn't go in the ${EQUIP_SLOTS[it.slot].name.toLowerCase()} slot`
			if (it.slot === OFF_HAND && itemAt(items, { container: 0, slot: MAIN_HAND })?.template.invType === TWO_HAND) return 'The main hand holds a two-handed weapon, so the off hand stays empty'
		} else if (it.slot < PACK_START && !isBag(t)) return `${name} is not a bag`
		return ''
	}
	const bag = itemAt(items, { container: 0, slot: it.container })
	if (!bag) return `There is no bag in bag slot ${it.container - BAG_SLOTS[0] + 1}`
	if (it.slot < 0 || it.slot >= bag.template.containerSlots) return `${bag.template.name} has ${bag.template.containerSlots} slots`
	if (!fitsBag(t, bag.template)) return `${name} doesn't go into ${bag.template.name}`
	return ''
}

/** The first problem among `items`, with its place, or null. */
export function firstProblem(items: readonly Item[]): { place: Place; message: string } | null {
	for (const it of items) {
		const message = placeProblem(items, it)
		if (message) return { place: { container: it.container, slot: it.slot }, message }
	}
	return null
}

/**
 * `items` with the item at `from` moved to `to`, swapped with what is there; a bag in a bag slot
 * takes its contents along. A string says why it can't move.
 */
export function moveItem(items: readonly Item[], from: Place, to: Place): Item[] | string {
	const a = itemAt(items, from)
	if (!a || samePlace(from, to)) return items.slice()
	const b = itemAt(items, to)
	const bagSlot = (p: Place) => p.container === 0 && p.slot >= BAG_SLOTS[0] && p.slot < PACK_START
	const holds = (p: Place) => bagSlot(p) && items.some((i) => i.container === p.slot)
	if (from.container === 0 && to.container === from.slot) return `${a.template.name} can't go into itself`
	if (b && to.container === 0 && from.container === to.slot) return `${b.template.name} can't go into itself`
	if (holds(from) && !bagSlot(to)) return `Empty ${a.template.name} first: a bag holding items stays in a bag slot`
	if (b && holds(to) && !bagSlot(from)) return `Empty ${b.template.name} first: a bag holding items stays in a bag slot`
	const moved = items.map((i) => {
		if (i === a) return { ...i, container: to.container, slot: to.slot }
		if (i === b) return { ...i, container: from.container, slot: from.slot }
		// Bags swapped between bag slots take their contents along.
		if (bagSlot(from) && bagSlot(to) && i.container === from.slot) return { ...i, container: to.slot }
		if (bagSlot(from) && bagSlot(to) && i.container === to.slot) return { ...i, container: from.slot }
		return i
	})
	const problem = firstProblem(moved)
	return problem ? problem.message : moved
}

/** `items` without the item at `p`, and without the contents of a bag there. */
export function removeItem(items: readonly Item[], p: Place): Item[] {
	const bag = p.container === 0 && p.slot >= BAG_SLOTS[0] && p.slot < PACK_START ? p.slot : -1
	return items.filter((i) => !samePlace(i, p) && i.container !== bag)
}

/** The free places, in the order an added item looks for one: the equipment, the backpack, then the bags. */
export function freePlaces(items: readonly Item[]): Place[] {
	const out: Place[] = []
	const free = (p: Place) => !itemAt(items, p) && out.push(p)
	for (let s = 0; s < PACK_END; s++) free({ container: 0, slot: s })
	for (const s of BAG_SLOTS) {
		const bag = itemAt(items, { container: 0, slot: s })
		for (let i = 0; i < (bag?.template.containerSlots ?? 0); i++) free({ container: s, slot: i })
	}
	return out
}

/** Where a new item of template `t` goes: `want` when it fits there and is free, else the first free place that takes it, or null. */
export function placeFor(items: readonly Item[], t: Template, want: Place | null): Place | null {
	const fits = (p: Place) => !itemAt(items, p) && !placeProblem([...items, newItem(t, p)], newItem(t, p))
	if (want && fits(want)) return want
	const places = freePlaces(items)
	// An item that is worn goes to its slot; anything else (and a bag past the bag slots) to the backpack or a bag.
	return places.find((p) => p.container === 0 && p.slot < PACK_START && fits(p)) ?? places.find((p) => (p.container !== 0 || p.slot >= PACK_START) && fits(p)) ?? null
}

/** A new item of template `t` at `p`: one of it, at full durability. */
export function newItem(t: Template, p: Place): Item {
	return { guid: 0, container: p.container, slot: p.slot, entry: t.entry, count: 1, durability: t.maxDurability, enchant: 0, template: t }
}

/** Why a character of `race`, `cls` and `level` can't wear `t`, or ''. The server mails such an item to it at login. */
export function wearProblem(t: Template, race: number, cls: number, level: number): string {
	// A mask of -1 (or 0) allows every class or race.
	const allows = (mask: number, id: number) => mask <= 0 || (mask & (1 << (id - 1))) !== 0
	if (!allows(t.allowableClass, cls)) return 'not for its class'
	if (!allows(t.allowableRace, race)) return 'not for its race'
	if (t.requiredLevel > level) return `needs level ${t.requiredLevel}`
	return ''
}
