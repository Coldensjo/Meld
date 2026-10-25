import { SCHOOLS, type CreatureField, type CreatureFieldGroup, type RefKind } from './creatureFields'
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

/** The cursors of the 1.12 client's Interface\Cursor folder that gameobject_template.icon can name. */
export const CURSOR_ICONS = ['Point', 'Interact', 'Speak', 'Attack', 'Cast', 'Buy', 'Repair', 'Trainer', 'Taxi', 'Mail', 'Inspect', 'PickLock', 'Mine', 'GatherHerbs', 'Skin', 'LootAll', 'Pickup', 'Item', 'PVP']

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

/** What a data column names, by its name in DATA_NAMES (#702); a name ending in spell or aura is a spell (#682). */
const DATA_REFS: Record<string, RefKind> = {
	Lock: 'lock',
	'Linked trap': 'object',
	Quest: 'quest',
	Creature: 'creature',
	Zone: 'zone',
	Loot: 'loot',
	'Gossip menu': 'gossip',
	Page: 'page',
	Event: 'event',
	'Looted event': 'event',
	'Start event': 'event',
	'Stop event': 'event',
	'Open text': 'text',
	'Close text': 'text',
	Language: 'language',
	'Page material': 'page material',
	'Spell focus': 'spell focus',
	Cinematic: 'cinematic',
	'Taxi path': 'taxi path',
	'Auction house': 'auction house',
}

/** The hints of the data columns a picker or select names, such as "Lock.dbc: what opens it". */
const DATA_HINTS: Record<string, string> = {
	Lock: 'Lock.dbc: what opens it (a skill or a key)',
	'Linked trap': 'The game object (a trap) it sets off',
	Loot: 'gameobject_loot_template entry: what it holds (the Loot tab edits it)',
	'Gossip menu': 'gossip_menu entry: what it says when used',
	Event: 'event_scripts ID: the script it runs',
	'Looted event': 'event_scripts ID: the script it runs when looted',
	'Open text': 'broadcast_text ID',
	'Close text': 'broadcast_text ID',
	'Custom animation': "An animation of the object's model, by index",
	'Quest list': 'No world database table holds quest lists: a bare number',
}

/** The editor's field for data column `i` of a type, named `name` in DATA_NAMES. */
export function dataField(name: string, i: number): CreatureField {
	const label = name.replace(/^\?/, '')
	const f: CreatureField = { col: `data${i}`, label, bool: name.startsWith('?') }
	const ref = DATA_REFS[label] ?? (/(spell|aura)$/i.test(label) ? 'spell' : undefined)
	if (ref) f.ref = ref
	if (label === 'Damage school') f.options = SCHOOLS
	if (DATA_HINTS[label]) f.hint = DATA_HINTS[label]
	return f
}

/** A model path's file name without its folder and extension, such as "Chest01". */
export function modelName(path: string): string {
	const base = path.split(/[\\/]/).pop() ?? ''
	return base.replace(/\.[^.]*$/, '')
}

/**
 * The groups for gameobject_template's columns, with the data columns named for object type `type`;
 * `model` is the template's display's model, named beside the Display number.
 */
export function objectFieldGroups(type: number, model = ''): CreatureFieldGroup[] {
	const data = DATA_NAMES[type] ?? []
	return [
		{
			title: 'Identity',
			fields: [
				{ col: 'name', label: 'Name' },
				{ col: 'type', label: 'Type', options: OBJECT_TYPES.map((n, i) => [i, n] as [number, string]) },
				{ col: 'displayId', label: 'Display', hint: 'GameObjectDisplayInfo ID: the model it shows (the Display tab picks it)', note: (v) => (Number(v) > 0 ? modelName(model) || 'no model' : '') },
				{ col: 'size', label: 'Size' },
				{ col: 'faction', label: 'Faction', hint: 'FactionTemplate ID: who may use it (0 everyone)', ref: 'faction template' },
				{ col: 'icon', label: 'Cursor icon', hint: "The cursor over it, by the client's Interface\\Cursor names (empty: the type's own)", suggest: CURSOR_ICONS },
				{ col: 'script_name', label: 'Script' },
				{ col: 'flags', label: 'Flags', flags: OBJECT_FLAGS },
			],
		},
		{
			title: `What a ${(OBJECT_TYPES[type] ?? 'object').toLowerCase()} does`,
			fields: data.map(dataField).filter((f) => f.label !== ''),
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
