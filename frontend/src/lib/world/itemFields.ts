import type { CreatureField, CreatureFieldGroup } from './creatureFields'
import { RACE_MASK, fieldGroups } from './creatureFields'
import type { QuestTab } from './questFields'
import { CLASS_MASK } from './questFields'
import { REP_RANKS } from '../wow/itemTooltip'

/**
 * How the item editor (#353) shows item_template's columns: on tabs, grouped, with plain labels, a
 * select where the numbers have names (the subclass's names follow the class), and a picker for a
 * column that names a spell, skill, faction, quest, zone or item. The names follow VMaNGOS'
 * ItemPrototype.h for 1.12. A column not listed still shows, on the Other tab.
 */

const named = (names: string[], from = 0): Array<[number, string]> => names.map((n, i) => [i + from, n] as [number, string]).filter(([, n]) => n !== '')

/** item_template.class (ITEM_CLASS_*). */
export const ITEM_CLASSES: Array<[number, string]> = named([
	'Consumable',
	'Container',
	'Weapon',
	'Gem (unused)',
	'Armor',
	'Reagent',
	'Projectile',
	'Trade goods',
	'Generic (unused)',
	'Recipe',
	'Money (unused)',
	'Quiver',
	'Quest',
	'Key',
	'Permanent (unused)',
	'Miscellaneous',
])

/** Each class's subclasses (ITEM_SUBCLASS_*), as 1.12 has them. */
const SUBCLASSES: Record<number, Array<[number, string]>> = {
	0: [[0, 'Consumable']],
	1: named(['Bag', 'Soul bag', 'Herb bag', 'Enchanting bag', 'Engineering bag']),
	2: named([
		'Axe (one-hand)',
		'Axe (two-hand)',
		'Bow',
		'Gun',
		'Mace (one-hand)',
		'Mace (two-hand)',
		'Polearm',
		'Sword (one-hand)',
		'Sword (two-hand)',
		'',
		'Staff',
		'Exotic (one-hand)',
		'Exotic (two-hand)',
		'Fist weapon',
		'Miscellaneous',
		'Dagger',
		'Thrown',
		'Spear',
		'Crossbow',
		'Wand',
		'Fishing pole',
	]),
	4: named(['Miscellaneous', 'Cloth', 'Leather', 'Mail', 'Plate', 'Buckler', 'Shield', 'Libram', 'Idol', 'Totem']),
	5: [[0, 'Reagent']],
	6: named(['Wand (unused)', 'Bolt (unused)', 'Arrow', 'Bullet', 'Thrown (unused)']),
	7: named(['Trade goods', 'Parts', 'Explosives', 'Devices']),
	9: named(['Book', 'Leatherworking', 'Tailoring', 'Engineering', 'Blacksmithing', 'Cooking', 'Alchemy', 'First aid', 'Enchanting', 'Fishing']),
	11: [
		[2, 'Quiver'],
		[3, 'Ammo pouch'],
	],
	12: [[0, 'Quest']],
	13: named(['Key', 'Lockpick']),
	15: [[0, 'Junk']],
}

/** item_template.inventory_type (INVTYPE_*): where the item goes. */
export const INVENTORY_TYPES: Array<[number, string]> = named([
	'Not worn',
	'Head',
	'Neck',
	'Shoulder',
	'Shirt',
	'Chest',
	'Waist',
	'Legs',
	'Feet',
	'Wrist',
	'Hands',
	'Finger',
	'Trinket',
	'One-hand',
	'Shield',
	'Ranged (bow)',
	'Back',
	'Two-hand',
	'Bag',
	'Tabard',
	'Robe',
	'Main hand',
	'Off hand',
	'Held in off hand',
	'Ammo',
	'Thrown',
	'Ranged (gun, crossbow, wand)',
	'Quiver',
	'Relic',
])

export const QUALITIES: Array<[number, string]> = named(['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact'])

const BONDING = named(['None', 'Binds when picked up', 'Binds when equipped', 'Binds when used', 'Quest item', 'Quest item (unused)'])

/** item_template.flags (ITEM_FLAG_*), the ones 1.12 uses. */
const ITEM_FLAGS: Array<[number, string]> = [
	[0x2, 'Conjured'],
	[0x4, 'Opens for loot'],
	[0x10, 'Deprecated (red icon)'],
	[0x20, "Can't be destroyed"],
	[0x40, 'Player cast'],
	[0x80, 'No cooldown after equipping'],
	[0x200, 'Gift wrapper'],
	[0x400, 'Ignores bag space'],
	[0x800, 'Party loot'],
	[0x2000, 'Guild charter'],
	[0x4000, 'Has text'],
	[0x8000, "Can't be disenchanted"],
	[0x10000, 'Real-time duration'],
	[0x20000, 'No creator'],
	[0x80000, 'Unique when equipped (server)'],
]

/** item_template.extra_flags (ITEM_EXTRA_*), VMaNGOS' own. */
const EXTRA_FLAGS: Array<[number, string]> = [
	[0x1, 'Mail stationery'],
	[0x2, 'Drops without quest checks'],
	[0x4, 'Never obtainable'],
]

const BAG_FAMILIES: Array<[number, string]> = [
	[0, 'Anything'],
	[1, 'Arrows'],
	[2, 'Bullets'],
	[3, 'Soul shards'],
	[6, 'Herbs'],
	[7, 'Enchanting supplies'],
	[8, 'Engineering supplies'],
	[9, 'Keys'],
]

const SHEATHS: Array<[number, string]> = [
	[0, 'None'],
	[1, 'Two-hand weapon (back)'],
	[2, 'Staff (back)'],
	[3, 'One-hand weapon (side)'],
	[4, 'Shield (back)'],
	[5, "Enchanter's rod"],
	[7, 'Off hand (side)'],
]

const MATERIALS: Array<[number, string]> = [[-1, 'Consumable'], ...named(['Not set', 'Metal', 'Wood', 'Liquid', 'Jewelry', 'Chain', 'Plate', 'Cloth', 'Leather'])]

const SCHOOLS = named(['Physical', 'Holy', 'Fire', 'Nature', 'Frost', 'Shadow', 'Arcane'])

const STAT_TYPES: Array<[number, string]> = [
	// 0 is also an empty slot's type: it counts only with an amount.
	[0, 'Mana (none at amount 0)'],
	[1, 'Health'],
	[3, 'Agility'],
	[4, 'Strength'],
	[5, 'Intellect'],
	[6, 'Spirit'],
	[7, 'Stamina'],
]

const TRIGGERS: Array<[number, string]> = [
	[0, 'Use'],
	[1, 'Equip'],
	[2, 'Chance on hit'],
	[4, 'Soulstone'],
	[5, 'Use (no delay)'],
	[6, 'Learn spell'],
]

const AMMO: Array<[number, string]> = [
	[0, 'None'],
	[2, 'Arrows'],
	[3, 'Bullets'],
]

/** item_template.required_honor_rank: the PvP ranks, 5 for the first (Private / Scout) to 18 (#701). */
export const HONOR_RANKS: Array<[number, string]> = [
	[0, 'None'],
	...named(
		[
			'Private / Scout',
			'Corporal / Grunt',
			'Sergeant / Sergeant',
			'Master Sergeant / Senior Sergeant',
			'Sergeant Major / First Sergeant',
			'Knight / Stone Guard',
			'Knight-Lieutenant / Blood Guard',
			'Knight-Captain / Legionnaire',
			'Knight-Champion / Centurion',
			'Lieutenant Commander / Champion',
			'Commander / Lieutenant General',
			'Marshal / General',
			'Field Marshal / Warlord',
			'Grand Marshal / High Warlord',
		],
		5,
	),
]

const FOOD: Array<[number, string]> = named(['None', 'Meat', 'Fish', 'Cheese', 'Bread', 'Fungus', 'Fruit', 'Raw meat', 'Raw fish'])

/** The subclasses of class `cls`, for its select. */
export function subclassOptions(cls: number): Array<[number, string]> {
	return SUBCLASSES[cls] ?? [[0, 'None']]
}

const n = (k: number, f: (i: number) => CreatureField[]) => Array.from({ length: k }, (_, i) => f(i + 1)).flat()

/** The editor's tabs for item_template's columns, the subclass named for class `cls`. */
function itemTabList(cls: number): QuestTab[] {
	return [
		{
			id: 'item',
			title: 'Item',
			groups: [
				{
					title: 'Identity',
					fields: [
						{ col: 'name', label: 'Name', wide: true },
						{ col: 'description', label: 'Description', hint: 'The gold quoted line at the bottom of the tooltip', wide: true },
						{ col: 'quality', label: 'Quality', options: QUALITIES },
						{ col: 'class', label: 'Class', options: ITEM_CLASSES },
						{ col: 'subclass', label: 'Subclass', options: subclassOptions(cls) },
						{ col: 'inventory_type', label: 'Slot', options: INVENTORY_TYPES, hint: 'Where it is worn or held' },
						{ col: 'sheath', label: 'Carried', options: SHEATHS, hint: 'Where a weapon hangs when put away' },
						{ col: 'material', label: 'Material', options: MATERIALS, hint: 'The sound it makes' },
						{ col: 'item_level', label: 'Item level' },
					],
				},
				{
					title: 'Owning it',
					fields: [
						{ col: 'bonding', label: 'Binding', options: BONDING },
						{ col: 'max_count', label: 'Most one can own', hint: '0 for any number, 1 for Unique' },
						{ col: 'stackable', label: 'Stacks to' },
						{ col: 'container_slots', label: 'Bag slots' },
						{ col: 'bag_family', label: 'Bag holds', options: BAG_FAMILIES },
						{ col: 'duration', label: 'Lasts (s)', hint: 'Seconds before it disappears, 0 for ever' },
						{ col: 'start_quest', label: 'Starts quest', ref: 'quest' },
						{ col: 'other_team_entry', label: 'Other faction item', ref: 'item', hint: 'The item the other faction gets instead (VMaNGOS; 1 or empty for none)' },
					],
				},
				{
					title: 'Price',
					fields: [
						{ col: 'buy_price', label: 'Buy price', money: true },
						{ col: 'sell_price', label: 'Sell price', money: true },
						{ col: 'buy_count', label: 'Sold in stacks of' },
					],
				},
			],
		},
		{
			id: 'combat',
			title: 'Combat',
			groups: [
				{
					title: 'Weapon',
					fields: [
						{ col: 'delay', label: 'Speed (ms)', note: (v) => (Number(v) > 0 ? `${(Number(v) / 1000).toFixed(2)} s` : '') },
						{ col: 'range_mod', label: 'Range modifier' },
						{ col: 'ammo_type', label: 'Ammo', options: AMMO },
						...n(5, (i) => [
							{ col: `dmg_min${i}`, label: `Damage ${i} from` },
							{ col: `dmg_max${i}`, label: `Damage ${i} to` },
							{ col: `dmg_type${i}`, label: `Damage ${i} school`, options: SCHOOLS },
						]),
					],
				},
				{
					title: 'Defence',
					fields: [
						{ col: 'armor', label: 'Armor' },
						{ col: 'block', label: 'Block' },
						{ col: 'max_durability', label: 'Durability' },
						{ col: 'holy_res', label: 'Holy resistance' },
						{ col: 'fire_res', label: 'Fire resistance' },
						{ col: 'nature_res', label: 'Nature resistance' },
						{ col: 'frost_res', label: 'Frost resistance' },
						{ col: 'shadow_res', label: 'Shadow resistance' },
						{ col: 'arcane_res', label: 'Arcane resistance' },
					],
				},
			],
		},
		{
			id: 'stats',
			title: 'Stats',
			groups: [
				{
					title: 'Stats',
					// One stat a row: its type beside its amount.
					columns: 2,
					fields: n(10, (i) => [
						{ col: `stat_type${i}`, label: `Stat ${i}`, options: STAT_TYPES },
						{ col: `stat_value${i}`, label: `Stat ${i} amount` },
					]),
				},
			],
		},
		{
			id: 'effects',
			title: 'Effects',
			groups: Array.from({ length: 5 }, (_, k): CreatureFieldGroup => {
				const i = k + 1
				return {
					title: `Effect ${i}`,
					fields: [
						{ col: `spellid_${i}`, label: 'Spell', ref: 'spell', wide: true },
						{ col: `spelltrigger_${i}`, label: 'When', options: TRIGGERS },
						{ col: `spellcharges_${i}`, label: 'Charges', hint: '0 for no limit; negative: the item is used up with its last charge' },
						{ col: `spellppmrate_${i}`, label: 'Procs per minute', hint: 'For Chance on hit' },
						{ col: `spellcooldown_${i}`, label: 'Cooldown (ms)', hint: "-1 for the spell's own" },
						{ col: `spellcategory_${i}`, label: 'Cooldown category', ref: 'spell category', hint: 'Items and spells of one category share its cooldown' },
						{ col: `spellcategorycooldown_${i}`, label: 'Category cooldown (ms)', hint: "-1 for the spell's own" },
					],
				}
			}),
		},
		{
			id: 'requirements',
			title: 'Requirements',
			groups: [
				{
					title: 'Who may use it',
					fields: [
						{ col: 'required_level', label: 'Level' },
						{ col: 'allowable_class', label: 'Classes', flags: CLASS_MASK, classes: 'mask', hint: '-1 for every class' },
						{ col: 'allowable_race', label: 'Races', flags: RACE_MASK, hint: '-1 for every race' },
						{ col: 'required_skill', label: 'Skill', ref: 'skill' },
						{ col: 'required_skill_rank', label: 'Skill rank' },
						{ col: 'required_spell', label: 'Spell known', ref: 'spell' },
						{ col: 'required_honor_rank', label: 'Honor rank', options: HONOR_RANKS },
						{ col: 'required_city_rank', label: 'City rank' },
						{ col: 'required_reputation_faction', label: 'Reputation with', ref: 'faction' },
						{ col: 'required_reputation_rank', label: 'Reputation at least', options: named(REP_RANKS) },
					],
				},
				{
					title: 'Where',
					fields: [
						{ col: 'area_bound', label: 'Only in zone', ref: 'zone or sort' },
						{ col: 'map_bound', label: 'Only on map', ref: 'map', hint: '0 for any map' },
					],
				},
			],
		},
		{
			id: 'more',
			title: 'More',
			groups: [
				{
					title: 'Flags',
					fields: [
						{ col: 'flags', label: 'Flags', flags: ITEM_FLAGS },
						{ col: 'extra_flags', label: 'Server flags', flags: EXTRA_FLAGS },
					],
				},
				{
					title: 'Contents and text',
					fields: [
						{ col: 'lock_id', label: 'Lock', ref: 'lock', hint: 'What opens it (Lock.dbc)', wide: true },
						{ col: 'page_text', label: 'Page text', ref: 'page', hint: 'The text it reads (page_text)', wide: true },
						{ col: 'page_language', label: 'Page language', ref: 'language', hint: '0 for Universal: everyone reads it' },
						{ col: 'page_material', label: 'Page material', ref: 'page material', hint: 'The background its pages show' },
						{ col: 'min_money_loot', label: 'Money inside from', money: true },
						{ col: 'max_money_loot', label: 'Money inside to', money: true },
						{ col: 'wrapped_gift', label: 'Wrapped gift', ref: 'item' },
					],
				},
				{
					title: 'Links',
					fields: [
						{ col: 'random_property', label: 'Random enchantment', ref: 'enchantment', hint: 'The suffixes it may roll ("of the Bear"…): an item_enchantment_template entry', wide: true },
						{ col: 'set_id', label: 'Item set', ref: 'item set', hint: 'ItemSet.dbc' },
						{ col: 'disenchant_id', label: 'Disenchants into', ref: 'disenchant', hint: 'What disenchanting gives: a disenchant_loot_template entry', wide: true },
						{ col: 'food_type', label: 'Pet food', options: FOOD },
					],
				},
			],
		},
	]
}

/** The item editor's tabs for these columns: listed columns only where the table has them, the rest (but display_id) on Other. */
export function itemTabs(columns: string[], cls: number): QuestTab[] {
	const have = new Set(columns)
	const list = itemTabList(cls)
	const tabs = list.map((t) => ({ ...t, groups: t.groups.map((g) => ({ ...g, fields: g.fields.filter((f) => have.has(f.col)) })).filter((g) => g.fields.length) }))
	// display_id is edited beside the preview, with its icon and Take the look of….
	const known = new Set(['display_id', ...list.flatMap((t) => t.groups.flatMap((g) => g.fields.map((f) => f.col)))])
	const other = fieldGroups(
		columns.filter((c) => !known.has(c)),
		[],
	)
	if (other.length) tabs.push({ id: 'other', title: 'Other', groups: other })
	return tabs.filter((t) => t.groups.length)
}

/** Inventory types a hand holds (one-hand, two-hand, main hand, off hand, shield, held in off hand, ranged, thrown). */
export const HELD_TYPES = new Set([13, 14, 15, 17, 21, 22, 23, 25, 26])

/** The ranged weapon subclasses by what a basic shot fires like (ItemDisplayEntry.shoots). */
export const SHOOTS_LIKE: Record<number, string> = { 2: 'a bow', 3: 'a gun', 16: 'a thrown weapon', 18: 'a crossbow', 19: 'a wand' }

/** Where an item of inventory type `inv` goes, as the look picker groups the client's displays (Go's invKind). */
export function slotKind(inv: number): string {
	if ([13, 17, 21, 22].includes(inv)) return 'weapon'
	if (inv === 14) return 'shield'
	if (inv === 23) return 'held'
	if ([15, 25, 26].includes(inv)) return 'ranged'
	if (inv === 1) return 'head'
	if (inv === 3) return 'shoulder'
	if (inv === 16) return 'back'
	if ([4, 5, 6, 7, 8, 9, 10, 19, 20].includes(inv)) return 'body'
	if ([2, 11, 12].includes(inv)) return 'jewelry'
	return 'other'
}
