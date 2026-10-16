// Names for the numbers of VMaNGOS's gossip and creature AI tables, from its source: the option
// icons and actions (GossipDef.h, GOSSIP_ICON_* and GOSSIP_OPTION_*), the creature flag each action
// needs for the option to show (the npc_flags bit named beside GOSSIP_OPTION_*, with its 1.12 value
// from UnitDefines.h: the numbers in GossipDef.h's comments are a later client's), the AI event types
// (CreatureEventAI.h, EVENT_T_*) and the chat types (CreatureDefines.h, CHAT_TYPE_*).

export const GOSSIP_ICONS: readonly string[] = [
	'Chat bubble',
	'Bag (vendor)',
	'Wings (flight)',
	'Book (trainer)',
	'Gear',
	'Gear 2',
	'Money bag',
	'Talk bubble',
	'Tabard',
	'Swords (battle)',
	'Dot',
	'Chat bubble (11)',
	'Chat bubble (12)',
	'Dot (13)',
	'Dot (14)',
	'Dot (15)',
	'Dot (16)',
	'Dot (17)',
	'Dot (18)',
	'Dot (19)',
	'Dot (20)',
]

/** An option's action (option_id): its name and the creature flag (npc_flags bit) it needs. */
export const GOSSIP_ACTIONS: readonly { name: string; flag: number; flagName: string }[] = [
	{ name: 'Nothing', flag: 1, flagName: 'Gossip' },
	{ name: 'Talk (open a menu)', flag: 1, flagName: 'Gossip' },
	{ name: 'Quests', flag: 2, flagName: 'Quest giver' },
	{ name: 'Vendor', flag: 4, flagName: 'Vendor' },
	{ name: 'Flight master', flag: 8, flagName: 'Flight master' },
	{ name: 'Trainer', flag: 16, flagName: 'Trainer' },
	{ name: 'Spirit healer', flag: 32, flagName: 'Spirit healer' },
	{ name: 'Spirit guide', flag: 64, flagName: 'Spirit guide' },
	{ name: 'Innkeeper', flag: 128, flagName: 'Innkeeper' },
	{ name: 'Banker', flag: 256, flagName: 'Banker' },
	{ name: 'Guild charter', flag: 512, flagName: 'Petitioner' },
	{ name: 'Tabard designer', flag: 1024, flagName: 'Tabard designer' },
	{ name: 'Battlemaster', flag: 2048, flagName: 'Battlemaster' },
	{ name: 'Auctioneer', flag: 4096, flagName: 'Auctioneer' },
	{ name: 'Stable master', flag: 8192, flagName: 'Stable master' },
	{ name: 'Repair', flag: 16384, flagName: 'Repair' },
	{ name: 'Unlearn talents', flag: 16, flagName: 'Trainer' },
	{ name: 'Unlearn pet skills', flag: 16, flagName: 'Trainer' },
]

/** The action that opens another gossip menu (GOSSIP_OPTION_GOSSIP). */
export const ACTION_TALK = 1

export const AI_EVENTS: readonly string[] = [
	'In combat (timer)',
	'Out of combat (timer)',
	'At health',
	'At mana',
	'On aggro',
	'On a kill',
	'On death',
	'On evading',
	'Hit by a spell',
	'Target in range',
	'Sees someone',
	'On spawn',
	'Target at health',
	'Target casting',
	'Friend hurt',
	'Friend crowd-controlled',
	'Friend missing a buff',
	'Summoned a creature',
	'Target at mana',
	'Quest accepted',
	'Quest completed',
	'Back home',
	'Receives an emote',
	'Has an aura',
	'Target has an aura',
	'Summon died',
	'Summon despawned',
	'Aura missing',
	'Target aura missing',
	'Reached a point',
	'Leaves combat',
	'Script event',
	'Group member died',
	'Victim rooted',
	'Hit by an aura',
	'Stealth alert',
	'Spell hit its target',
]

export const CHAT_TYPES: readonly string[] = ['says', 'yells', 'emote', 'boss emote', 'whispers', 'boss whisper', 'zone yell']

/** A list entry's name, or the number for one the list doesn't have. */
export function nameOf(list: readonly string[], n: number): string {
	return list[n] ?? `#${n}`
}

/** The lowest option number not in `ids` (gossip_menu_option.id). */
export function nextOptionId(ids: readonly number[]): number {
	let n = 0
	while (ids.includes(n)) n++
	return n
}
