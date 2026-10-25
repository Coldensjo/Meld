import type { CreatureField, CreatureFieldGroup } from './creatureFields'
import { OBJECT_TYPES } from './spawnInfo'

/**
 * How the game object editor shows gameobject_template's columns, as creatureFields.ts does for
 * creatures. What data0 to data23 mean depends on the object's type; the names follow the server's
 * GameObjectInfo (mangos, as VMaNGOS reads them for 1.12). A data column a type doesn't use, and any
 * column not listed, still shows under Other.
 */

/** What each data column means for a type, in data0, data1… order ('' for a column it doesn't use, `?` before a 0/1 one). */
const DATA_NAMES: Record<number, string[]> = {
	0: ['?Starts open', 'Lock', 'Closes again after ms', '?No damage immunity', 'Open text', 'Close text'],
	1: ['?Starts pressed', 'Lock', 'Resets after ms', 'Linked trap', '?No damage immunity', '?Large', 'Open text', 'Close text', '?Needs line of sight'],
	2: ['Lock', 'Quest list', 'Page material', 'Gossip menu', 'Custom animation', '?No damage immunity', 'Open text', '?Needs line of sight', '?Usable mounted', '?Large'],
	3: [
		'Lock',
		'Loot',
		'Restocks after s',
		'?Consumed when looted',
		'Least restock',
		'Most restock',
		'Looted event',
		'Linked trap',
		'Quest',
		'Level',
		'?Needs line of sight',
		'?Leaves loot',
		'?Not in combat',
		'?Logs loot',
		'Open text',
		'Group loot rules',
	],
	5: ['?Floating tooltip', '?Highlight', '?Server only', '?Large', '?Floats on water', 'Quest'],
	6: ['Lock', 'Level', 'Radius', 'Spell', 'Charges', 'Cooldown s', 'Closes again after ms', 'Start delay', '?Server only', '?Stealthed', '?Large', '?Stealth affected', 'Open text'],
	7: ['Seats', 'Height'],
	8: ['Spell focus', 'Distance', 'Linked trap', '?Server only', 'Quest', '?Large'],
	9: ['Page', 'Language', 'Page material'],
	10: [
		'Lock',
		'Quest',
		'Event',
		'Closes again after ms',
		'Custom animation',
		'?Consumed when used',
		'Cooldown s',
		'Page',
		'Language',
		'Page material',
		'Spell',
		'?No damage immunity',
		'Linked trap',
		'?Large',
		'Open text',
		'Close text',
		'?Needs line of sight',
		'?Usable mounted',
	],
	11: ['Pause ms', '?Starts open', 'Closes again after ms'],
	12: ['Lock', 'Radius', 'Least damage', 'Most damage', 'Damage school', 'Closes again after ms', 'Open text', 'Close text'],
	13: ['Lock', 'Cinematic'],
	15: ['Taxi path', 'Speed', 'Acceleration', 'Start event', 'Stop event'],
	18: ['Casters needed', 'Spell', 'Animation spell', '?Lasts', 'Caster target spell', 'Caster target spell targets', '?Casters grouped'],
	20: ['Auction house'],
	21: ['Creature', 'Charges'],
	22: ['Spell', 'Charges', '?Party only'],
	23: ['Least level', 'Most level', 'Zone'],
	24: ['Lock', 'Pickup spell', 'Radius', 'Return aura', 'Return spell', '?No damage immunity', 'Open text', '?Needs line of sight'],
	25: ['Radius', 'Loot', 'Least restock', 'Most restock'],
	26: ['Lock', 'Event', 'Pickup spell', '?No damage immunity'],
}

/** gameobject_template.flags (GO_FLAG_* in GameObjectDefines.h). */
const OBJECT_FLAGS: Array<[number, string]> = [
	[0x01, 'In use'],
	[0x02, 'Locked'],
	[0x04, 'Needs a condition to use'],
	[0x08, 'Transport'],
	[0x10, "Can't be used"],
	[0x20, 'Never despawns'],
	[0x40, 'Triggered'],
]

/** The groups for gameobject_template's columns, with the data columns named for object type `type`. */
export function objectFieldGroups(type: number): CreatureFieldGroup[] {
	const data = DATA_NAMES[type] ?? []
	return [
		{
			title: 'Identity',
			fields: [
				{ col: 'name', label: 'Name' },
				{ col: 'type', label: 'Type', options: OBJECT_TYPES.map((n, i) => [i, n] as [number, string]) },
				{ col: 'displayId', label: 'Display', hint: 'GameObjectDisplayInfo ID: the model it shows' },
				{ col: 'size', label: 'Size' },
				{ col: 'faction', label: 'Faction', hint: 'FactionTemplate ID: who may use it (0 everyone)' },
				{ col: 'icon', label: 'Cursor icon' },
				{ col: 'script_name', label: 'Script' },
				{ col: 'flags', label: 'Flags', flags: OBJECT_FLAGS },
			],
		},
		{
			title: `What a ${(OBJECT_TYPES[type] ?? 'object').toLowerCase()} does`,
			// A column named "... spell" or "... aura" holds a spell ID: a picker with the spell's icon (#682).
			fields: data.map((name, i): CreatureField => ({ col: `data${i}`, label: name.replace(/^\?/, ''), bool: name.startsWith('?'), ref: /(spell|aura)$/i.test(name) ? 'spell' : undefined })).filter((f) => f.label !== ''),
		},
		{
			title: 'Money',
			fields: [
				{ col: 'mingold', label: 'Money from', money: true },
				{ col: 'maxgold', label: 'Money to', money: true },
			],
		},
	]
}
