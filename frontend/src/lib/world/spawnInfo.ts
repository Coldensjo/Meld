/**
 * Names for the numbers a spawn carries. The tables follow the server's own enums
 * (game/Objects in the vmangos source): CreatureDefines.h, UnitDefines.h and GameObjectDefines.h.
 */

// Indexed by creature type, which starts at 1 (0 is unset).
export const CREATURE_TYPES = ['', 'Beast', 'Dragonkin', 'Demon', 'Elemental', 'Giant', 'Undead', 'Humanoid', 'Critter', 'Mechanical', 'Not specified', 'Totem']

// Indexed by creature rank: CREATURE_ELITE_* in CreatureDefines.h.
export const RANKS = ['Normal', 'Elite', 'Rare elite', 'Boss', 'Rare']

// Indexed by game object type: GAMEOBJECT_TYPE_* in GameObjectDefines.h.
export const OBJECT_TYPES = [
	'Door',
	'Button',
	'Quest giver',
	'Chest',
	'Binder',
	'Generic',
	'Trap',
	'Chair',
	'Spell focus',
	'Text',
	'Goober',
	'Transport',
	'Area damage',
	'Camera',
	'Map object',
	'Moving transport',
	'Duel arbiter',
	'Fishing node',
	'Summoning ritual',
	'Mailbox',
	'Auction house',
	'Guard post',
	'Spell caster',
	'Meeting stone',
	'Flag stand',
	'Fishing hole',
	'Flag drop',
	'Mini-game',
	'Lottery kiosk',
	'Capture point',
	'Aura generator',
]

// The NPC flags that say what a creature does, by bit: UNIT_NPC_FLAG_* in UnitDefines.h.
export const NPC_FLAGS: Array<[number, string]> = [
	[0x0001, 'gossip'],
	[0x0002, 'quest giver'],
	[0x0004, 'vendor'],
	[0x0008, 'flight master'],
	[0x0010, 'trainer'],
	[0x0020, 'spirit healer'],
	[0x0040, 'spirit guide'],
	[0x0080, 'innkeeper'],
	[0x0100, 'banker'],
	[0x0200, 'petitioner'],
	[0x0400, 'tabard designer'],
	[0x0800, 'battlemaster'],
	[0x1000, 'auctioneer'],
	[0x2000, 'stable master'],
	[0x4000, 'repair'],
]

export function creatureTypeName(n: number): string {
	return CREATURE_TYPES[n] || `Type ${n}`
}

export function rankName(n: number): string {
	return RANKS[n] ?? `Rank ${n}`
}

export function objectTypeName(n: number): string {
	return OBJECT_TYPES[n] ?? `Type ${n}`
}

/** The NPC roles a creature's flags name, for example "gossip, vendor"; empty for a monster. */
export function npcRoles(flags: number): string {
	return NPC_FLAGS.filter(([bit]) => (flags & bit) !== 0)
		.map(([, name]) => name)
		.join(', ')
}

/** A creature's level, as the client shows it: "60", or "58–60" for a range. */
export function levelText(min: number, max: number): string {
	if (min <= 0 && max <= 0) return ''
	if (min === max || max <= 0) return String(min)
	return `${min}–${max}`
}

/** Whole degrees from a spawn's orientation, which the server stores in radians. */
export function orientationDegrees(radians: number): number {
	return Math.round((radians * 180) / Math.PI)
}

/**
 * The editor's type for a spawn's client model: "wmo:" for buildings, "m2:" for everything else,
 * with the query the model endpoint dresses it by: the display's look (textures, geosets, items
 * held; see wow.Look) and the animation its pose plays. Spawns with the same model, look and pose
 * share one asset.
 */
export function spawnType(s: { model: string; look?: string; anim?: number }): string {
	if (!s.model) return ''
	if (s.model.toLowerCase().endsWith('.wmo')) return `wmo:${s.model}`
	const query = [s.look ?? '', s.anim ? `anim=${s.anim}` : ''].filter((q) => q !== '').join('&')
	return query ? `m2:${s.model}?${query}` : `m2:${s.model}`
}
