import { CLASSES } from '../wow/classes'
import type { ItemTableKind, ObjectTableKind, SpellTableKind, WorldKind } from '../wow/refNames'
import { CREATURE_TYPES, NPC_FLAGS, RANKS } from './spawnInfo'

/**
 * How the creature editor shows creature_template's columns: grouped, labelled, and with a picker
 * where the numbers have names. Columns not listed here still show, under Other, so every column
 * of the table can be edited.
 */
export interface CreatureField {
	col: string
	label: string
	/** A select of these values and names. */
	options?: Array<[number, string]>
	/** Checkboxes for these bits of the value. */
	flags?: Array<[number, string]>
	/** The bits (with `flags`) or the values (with `options`) are classes: each shows its class icon (#682). */
	classes?: 'mask' | 'id'
	/** An input that offers these values (a datalist), each with its label if it has one, but still takes any value. */
	suggest?: Array<string | [string, string]>
	/** A 0/1 checkbox. */
	bool?: boolean
	hint?: string
	/** A number that names a thing: a picker that shows its name (components/RefField.svelte). */
	ref?: RefKind
	/**
	 * With `ref`, the number a creature's own list usually has, which the picker calls "this
	 * creature's own" and offers first (#700): its entry, or (`tens`) entry × 10 to entry × 10 + 9,
	 * VMaNGOS' numbering of spell lists.
	 */
	own?: 'entry' | 'tens'
	/** Spell IDs separated by spaces: the text, and each spell's icon and name below it (AuraField.svelte). */
	spells?: boolean
	/** Text of several lines (a text area). */
	long?: boolean
	/** The whole row of the grid. */
	wide?: boolean
	/** A copper count, entered as gold, silver and copper with their coins (MoneyField.svelte, #679); `signed` may be negative (it costs that much). */
	money?: true | 'signed'
	/** What the value comes to, beside the label (such as seconds as minutes). */
	note?: (value: string) => string
}

/**
 * What a reference column names: an item, a creature (positive) or game object (negative), a spell,
 * a quest (by its absolute value), a faction (Faction.dbc, a reputation), a faction template
 * (FactionTemplate.dbc, what a creature's or object's `faction` holds), a zone (positive) or quest
 * sort (negative), a skill or an emote; for a game object's data columns (#702) a creature, a game
 * object or a zone alone, a client table row (a lock, a language…) or a world database row (a gossip
 * menu, a page, a text, an event script, a loot list); for the item editor's (#701) an item set, a
 * cooldown category, a map, a random enchantment or disenchant loot; for the creature editor's lists
 * (#700) a vendor, trainer, equipment, loot or spell list, and the Messages tab's gossip scripts,
 * map points and conditions; for the spell editor's (#703) a global cooldown category, an icon or a
 * visual; for the quest editor's (#704) a mail template, a start or end script or an exclusive group.
 */
export type RefKind =
	'item' | 'creature or object' | 'creature' | 'object' | 'zone' | 'spell' | 'quest' | 'faction' | 'faction template' | 'zone or sort' | 'skill' | 'emote' | 'mail template' | ObjectTableKind | ItemTableKind | SpellTableKind | WorldKind

export interface CreatureFieldGroup {
	title: string
	fields: CreatureField[]
	/** The grid's columns, 3 when absent (2 for pairs, such as an item's stat and its amount). */
	columns?: number
}

const named = (names: string[], from = 0): Array<[number, string]> => names.map((n, i) => [i + from, n] as [number, string]).filter(([, n]) => n !== '')

export const SCHOOLS = named(['Physical', 'Holy', 'Fire', 'Nature', 'Frost', 'Shadow', 'Arcane'])

/** The playable races by ChrRaces.dbc ID; a race's RaceMask bit is 1 << (id - 1). */
export const RACES: Array<[number, string]> = named(['Human', 'Orc', 'Dwarf', 'Night Elf', 'Undead', 'Tauren', 'Gnome', 'Troll'], 1)

/** A quest's RequiredRaces and an item's allowable_race bits. */
export const RACE_MASK: Array<[number, string]> = RACES.map(([id, n]) => [1 << (id - 1), n] as [number, string])

/** The spell mechanics (VMaNGOS' Mechanics, SharedDefines.h) by ID. */
export const MECHANICS = named([
	'None',
	'Charm',
	'Disoriented',
	'Disarm',
	'Distract',
	'Fear',
	'Fumble',
	'Root',
	'Pacify',
	'Silence',
	'Sleep',
	'Snare',
	'Stun',
	'Freeze',
	'Knockout',
	'Bleed',
	'Bandage',
	'Polymorph',
	'Banish',
	'Shield',
	'Shackle',
	'Mount',
	'Persuade',
	'Turn',
	'Horror',
	'Invulnerability',
	'Interrupt',
	'Daze',
	'Discovery',
	'Immune shield',
	'Sapped',
	'Slow cast speed',
])

/** mechanic_immune_mask's bits: mechanic m is bit 1 << (m - 1). */
export const MECHANIC_MASK: Array<[number, string]> = MECHANICS.filter(([m]) => m > 0).map(([m, n]) => [2 ** (m - 1), n] as [number, string])

/** school_immune_mask's bits: school s is bit 1 << s. */
export const SCHOOL_MASK: Array<[number, string]> = SCHOOLS.map(([s, n]) => [1 << s, n] as [number, string])

/** pet_family: VMaNGOS' CreatureFamily (CreatureDefines.h); 10 is the database's own horse family, not in the client. */
export const PET_FAMILIES: Array<[number, string]> = [
	[0, 'None'],
	[1, 'Wolf'],
	[2, 'Cat'],
	[3, 'Spider'],
	[4, 'Bear'],
	[5, 'Boar'],
	[6, 'Crocolisk'],
	[7, 'Carrion bird'],
	[8, 'Crab'],
	[9, 'Gorilla'],
	[10, 'Horse (server only)'],
	[11, 'Raptor'],
	[12, 'Tallstrider'],
	[15, 'Felhunter'],
	[16, 'Voidwalker'],
	[17, 'Succubus'],
	[19, 'Doomguard'],
	[20, 'Scorpid'],
	[21, 'Turtle'],
	[23, 'Imp'],
	[24, 'Bat'],
	[25, 'Hyena'],
	[26, 'Owl'],
	[27, 'Wind serpent'],
	[28, 'Remote control'],
]

/** ai_name: the names VMaNGOS' CreatureAIRegistry.cpp registers (empty picks the default by the creature's kind). */
export const AI_NAMES = ['NullAI', 'BasicAI', 'CritterAI', 'GuardAI', 'PetAI', 'TotemAI', 'EventAI', 'PetEventAI', 'GuardEventAI']

/** immunity_flags: VMaNGOS' CreatureImmunityFlags. */
export const IMMUNITY_FLAGS: Array<[number, string]> = [
	[0x01, 'Area spells'],
	[0x02, 'Taunt'],
	[0x04, 'Stat changes'],
	[0x08, 'Cast speed changes'],
	[0x10, 'Disease'],
	[0x20, 'Poison'],
	[0x40, 'Curse'],
]

/** static_flags1: VMaNGOS' CreatureStaticFlags. */
export const STATIC_FLAGS1: Array<[number, string]> = [
	[0x00000001, 'Mountable (unused)'],
	[0x00000002, 'No experience'],
	[0x00000004, 'No loot (unused)'],
	[0x00000008, 'Unkillable (stays at 1 HP)'],
	[0x00000010, 'Tameable'],
	[0x00000020, 'Immune to players'],
	[0x00000040, 'Immune to NPCs'],
	[0x00000080, 'Wields looted weapons'],
	[0x00000100, 'Sessile (cannot move)'],
	[0x00000200, 'Not selectable'],
	[0x00000400, 'No health or mana regen'],
	[0x00000800, 'Corpse despawns at once'],
	[0x00001000, 'Raid corpse (loot and XP to all)'],
	[0x00002000, 'Creator can loot'],
	[0x00004000, 'No defense'],
	[0x00008000, 'No spell defense'],
	[0x00010000, 'Raid boss (unused)'],
	[0x00020000, 'Minimap ping in combat'],
	[0x00040000, 'Water only'],
	[0x00080000, 'Amphibious'],
	[0x00100000, 'No melee'],
	[0x00200000, 'Visible to ghosts'],
	[0x00400000, 'PvP enabling'],
	[0x00800000, 'No wound animation'],
	[0x01000000, 'No faction tooltip (unused)'],
	[0x02000000, 'Ignores combat (passive)'],
	[0x04000000, 'Only attacks PvP flagged'],
	[0x08000000, 'Calls guards'],
	[0x10000000, 'Can swim'],
	[0x20000000, 'Floating'],
	[0x40000000, 'More audible'],
	[0x80000000, 'Large view range (200 yd)'],
]

/** static_flags2: VMaNGOS' CreatureStaticFlags2. */
export const STATIC_FLAGS2: Array<[number, string]> = [
	[0x01, 'No pet scaling (unused)'],
	[0x02, 'Pulls the zone into combat'],
	[0x04, 'Kill binds the raid'],
	[0x08, 'No harmful vertex colouring (unused)'],
	[0x10, 'No crushing blows'],
	[0x20, 'Owner stays out of combat'],
	[0x40, 'No slowdown when wounded'],
]

/** flags_extra: VMaNGOS' CreatureFlagsExtra. */
export const FLAGS_EXTRA: Array<[number, string]> = [
	[0x00000001, 'No leash evade'],
	[0x00000002, 'No aggro'],
	[0x00000004, 'No parry'],
	[0x00000008, 'No evade when unreachable'],
	[0x00000010, 'No block'],
	[0x00000020, 'No pause when talked to'],
	[0x00000040, 'Always runs'],
	[0x00000080, 'Invisible (trigger)'],
	[0x00000100, 'Gigantic view range (400 yd)'],
	[0x00000200, 'Infinite view range'],
	[0x00000400, 'Guard'],
	[0x00000800, 'No threat list'],
	[0x00001000, 'Keeps positive auras on evade'],
	[0x00002000, 'Always crushes'],
	[0x00004000, 'Appears dead'],
	[0x00008000, 'No backing up in chase'],
	[0x00010000, 'No assist'],
	[0x00020000, 'No target (passive)'],
	[0x00040000, 'Only visible to friendly'],
	[0x00080000, 'Can assist'],
]

export const CREATURE_FIELD_GROUPS: CreatureFieldGroup[] = [
	{
		title: 'Identity',
		fields: [
			{ col: 'name', label: 'Name' },
			{ col: 'subname', label: 'Title', hint: 'Shown under the name, such as <Innkeeper>' },
			{ col: 'level_min', label: 'Level from' },
			{ col: 'level_max', label: 'Level to' },
			{ col: 'rank', label: 'Rank', options: named(RANKS) },
			{ col: 'type', label: 'Creature type', options: [[0, 'None'], ...named(CREATURE_TYPES).filter(([v]) => v > 0)] },
			{
				col: 'unit_class',
				label: 'Class',
				options: [
					[0, 'None'],
					[1, 'Warrior'],
					[2, 'Paladin'],
					[4, 'Rogue'],
					[8, 'Mage'],
				],
				classes: 'id',
			},
			{ col: 'faction', label: 'Faction', hint: 'FactionTemplate ID: 14 attacks everyone, 35 is friendly to everyone', ref: 'faction template' },
			{ col: 'pet_family', label: 'Pet family', options: PET_FAMILIES },
			{ col: 'civilian', label: 'Civilian', bool: true },
			{ col: 'racial_leader', label: 'Racial leader', bool: true },
		],
	},
	{
		title: 'Services',
		fields: [
			{ col: 'npc_flags', label: 'Roles', flags: NPC_FLAGS.map(([bit, n]) => [bit, n[0].toUpperCase() + n.slice(1)] as [number, string]) },
			{ col: 'gossip_menu_id', label: 'Gossip menu', ref: 'gossip', hint: 'gossip_menu entry: what it says when talked to (the Messages tab edits it)' },
			{ col: 'vendor_id', label: 'Vendor list', ref: 'vendor', hint: 'npc_vendor_template entry: the items it sells, shared by the creatures that name it (the Shop tab lists its own npc_vendor rows)' },
			{ col: 'trainer_id', label: 'Trainer list', ref: 'trainer', hint: 'npc_trainer_template entry: the spells it teaches, shared by the creatures that name it' },
			{
				col: 'trainer_type',
				label: 'Trainer type',
				options: [
					[0, 'Class'],
					[1, 'Mounts'],
					[2, 'Trade skills'],
					[3, 'Pets'],
				],
			},
			{ col: 'trainer_spell', label: 'Trainer spell', ref: 'spell' },
			{ col: 'trainer_class', label: 'Trainer class', options: [[0, 'None'], ...CLASSES], classes: 'id' },
			{ col: 'trainer_race', label: 'Trainer race', options: [[0, 'None'], ...RACES] },
		],
	},
	{
		title: 'Looks',
		fields: [
			{ col: 'display_id1', label: 'Display 1' },
			{ col: 'display_scale1', label: 'Scale 1' },
			{ col: 'display_probability1', label: 'Chance 1' },
			{ col: 'display_id2', label: 'Display 2' },
			{ col: 'display_scale2', label: 'Scale 2' },
			{ col: 'display_probability2', label: 'Chance 2' },
			{ col: 'display_id3', label: 'Display 3' },
			{ col: 'display_scale3', label: 'Scale 3' },
			{ col: 'display_probability3', label: 'Chance 3' },
			{ col: 'display_id4', label: 'Display 4' },
			{ col: 'display_scale4', label: 'Scale 4' },
			{ col: 'display_probability4', label: 'Chance 4' },
			{ col: 'display_total_probability', label: 'Chances total', hint: 'The sum of the chances' },
			{ col: 'mount_display_id', label: 'Mount display', hint: 'The creature display it rides: set "the mount" above and click a tile' },
			{ col: 'equipment_id', label: 'Equipment', hint: 'creature_equip_template entry: the weapons it holds', ref: 'equipment', own: 'entry' },
		],
	},
	{
		title: 'Combat',
		fields: [
			{ col: 'health_multiplier', label: 'Health ×' },
			{ col: 'mana_multiplier', label: 'Mana ×' },
			{ col: 'armor_multiplier', label: 'Armor ×' },
			{ col: 'damage_multiplier', label: 'Damage ×' },
			{ col: 'damage_variance', label: 'Damage variance' },
			{ col: 'damage_school', label: 'Damage school', options: SCHOOLS },
			{ col: 'base_attack_time', label: 'Attack time ms' },
			{ col: 'ranged_attack_time', label: 'Ranged attack ms' },
			{ col: 'xp_multiplier', label: 'Experience ×' },
		],
	},
	{
		title: 'Resistances',
		fields: ['holy', 'fire', 'nature', 'frost', 'shadow', 'arcane'].map((s) => ({ col: `${s}_res`, label: s[0].toUpperCase() + s.slice(1) })),
	},
	{
		title: 'Movement and AI',
		fields: [
			{ col: 'speed_walk', label: 'Walk speed' },
			{ col: 'speed_run', label: 'Run speed' },
			{
				col: 'movement_type',
				label: 'Default movement',
				options: [
					[0, 'Idle'],
					[1, 'Random'],
					[2, 'Waypoints'],
				],
			},
			{
				col: 'inhabit_type',
				label: 'Lives',
				options: [
					[1, 'On the ground'],
					[2, 'In water'],
					[3, 'Ground and water'],
					[4, 'In the air'],
					[7, 'Anywhere'],
				],
			},
			{ col: 'detection_range', label: 'Aggro range' },
			{ col: 'call_for_help_range', label: 'Call for help range' },
			{ col: 'leash_range', label: 'Leash range' },
			{ col: 'ai_name', label: 'AI', hint: 'EventAI, or empty for the default', suggest: AI_NAMES },
			{ col: 'script_name', label: 'Script' },
			{ col: 'spell_list_id', label: 'Spell list', hint: 'creature_spells entry: the spells it casts (the Spells tab edits it)', ref: 'spell list', own: 'tens' },
			{ col: 'pet_spell_list_id', label: 'Pet spell list', hint: 'creature_spells entry: the spells it casts as a pet', ref: 'spell list', own: 'tens' },
			{ col: 'spawn_spell_id', label: 'Spawn spell', ref: 'spell' },
			{ col: 'totem_spell_id', label: 'Totem spell', ref: 'spell' },
			{ col: 'auras', label: 'Auras', hint: 'Spell IDs, separated by spaces', spells: true, wide: true },
		],
	},
	{
		title: 'Loot',
		fields: [
			{ col: 'loot_id', label: 'Loot', hint: 'creature_loot_template entry: what it drops', ref: 'creature loot', own: 'entry' },
			{ col: 'pickpocket_loot_id', label: 'Pickpocket loot', hint: 'pickpocketing_loot_template entry: what a rogue steals from it', ref: 'pickpocket loot', own: 'entry' },
			{ col: 'skinning_loot_id', label: 'Skinning loot', hint: 'skinning_loot_template entry: what skinning it gives', ref: 'skinning loot', own: 'entry' },
			{ col: 'gold_min', label: 'Money from', money: true },
			{ col: 'gold_max', label: 'Money to', money: true },
		],
	},
	{
		title: 'Flags',
		fields: [
			{ col: 'mechanic_immune_mask', label: 'Mechanic immunities', flags: MECHANIC_MASK },
			{ col: 'school_immune_mask', label: 'School immunities', flags: SCHOOL_MASK },
			{ col: 'immunity_flags', label: 'Immunity flags', flags: IMMUNITY_FLAGS },
			{ col: 'static_flags1', label: 'Static flags 1', flags: STATIC_FLAGS1 },
			{ col: 'static_flags2', label: 'Static flags 2', flags: STATIC_FLAGS2 },
			{ col: 'flags_extra', label: 'Extra flags', flags: FLAGS_EXTRA },
		],
	},
]

/** The groups for a table's columns: the known ones (`listed`, the creature's by default), then every other column under Other. */
export function fieldGroups(columns: string[], listed: CreatureFieldGroup[] = CREATURE_FIELD_GROUPS): CreatureFieldGroup[] {
	const have = new Set(columns)
	const groups = listed.map((g) => ({ ...g, fields: g.fields.filter((f) => have.has(f.col)) })).filter((g) => g.fields.length)
	const known = new Set(listed.flatMap((g) => g.fields.map((f) => f.col)))
	const other = columns.filter((c) => !known.has(c)).map((c) => ({ col: c, label: c.replace(/_/g, ' ') }))
	if (other.length) groups.push({ title: 'Other', fields: other })
	return groups
}

/** A value with bit `bit` set or cleared, as text (the editor holds values as the database prints them). */
/** The numbers a creature's own list has for a field's `own` (#700): its entry, or entry × 10 to entry × 10 + 9. */
export function ownListIds(own: CreatureField['own'], entry: number): number[] {
	if (!own || !(entry > 0)) return []
	return own === 'entry' ? [entry] : Array.from({ length: 10 }, (_, i) => entry * 10 + i)
}

export function withBit(value: string, bit: number, on: boolean): string {
	const n = Number(value) || 0
	// A negative mask (an item's allowable_class -1, every class) stays signed, as its column is.
	if (n < 0) return String(on ? n | bit : n & ~bit)
	return String(on ? (n | bit) >>> 0 : (n & ~bit) >>> 0)
}

/** The columns whose values differ between two records' values. */
export function changedValues(now: Record<string, string>, was: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {}
	for (const k of Object.keys(now)) if (now[k] !== was[k]) out[k] = now[k]
	return out
}
