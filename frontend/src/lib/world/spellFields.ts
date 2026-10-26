import type { vmangos } from '../../../wailsjs/go/models'
import { REP_RANKS } from '../wow/itemTooltip'
import type { CreatureField } from './creatureFields'
import { MECHANICS, MECHANIC_MASK, SCHOOL_MASK, fieldGroups } from './creatureFields'
import { INVENTORY_TYPES, ITEM_CLASSES, subclassOptions } from './itemFields'
import type { QuestTab } from './questFields'
import { CREATURE_TYPES } from './spawnInfo'

/**
 * How the spell editor (#294) shows spell_template's columns: on tabs, grouped, with plain labels, a
 * select where the numbers have names (the effects, auras and targets from VMaNGOS' SpellDefines.h
 * and SpellAuraDefines.h; the cast times, durations, ranges and radii from the client's tables), and
 * the spell's tooltip and effects as the game words them. A column not listed still shows, on the
 * Other tab. The icon and visual are edited beside the tooltip, not here. The masks are tick lists, the
 * aura states, family and reputation rank selects, and a column that names a thing a picker (#703),
 * an effect's misc value the one its effect and aura imply (miscField).
 */

const named = (names: string[], from = 0): Array<[number, string]> => names.map((n, i) => [i + from, n] as [number, string]).filter(([, n]) => n !== '')

export const SPELL_SCHOOLS: Array<[number, string]> = named(['Physical', 'Holy', 'Fire', 'Nature', 'Frost', 'Shadow', 'Arcane'])

/** spell_template.powerType: what casting costs (POWER_*; -2 is health). */
export const POWER_TYPES: Array<[number, string]> = [
	[0, 'Mana'],
	[1, 'Rage'],
	[2, 'Focus'],
	[3, 'Energy'],
	[4, 'Happiness'],
	[-2, 'Health'],
]

const DISPELS = named(['None', 'Magic', 'Curse', 'Disease', 'Poison', 'Stealth', 'Invisibility', 'All', 'NPC only', 'Enrage'])

const DAMAGE_CLASSES = named(['None', 'Magic', 'Melee', 'Ranged'])
const PREVENTION = named(['None', 'Silence', 'Pacify'])

/** Bit i of a 32-bit mask named names[i], leaving out the '' ones. */
const bits = (names: string[]): Array<[number, string]> => names.map((n, i) => [2 ** i, n] as [number, string]).filter(([, n]) => n !== '')

/** spell_template.attributes (SpellAttributes in VMaNGOS' SpellDefines.h). */
export const SPELL_ATTRIBUTES = bits([
	'A failed proc uses a charge',
	'Uses the ranged slot',
	'On next swing (no damage)',
	'Needs exotic ammo',
	'Is an ability (not a spell)',
	'Trade skill',
	'Passive',
	'Hidden (not in the spellbook or aura bar)',
	'Not in the combat log',
	'Targets the main hand item',
	'On next swing',
	'The wearer casts the proc',
	'Daytime only',
	'Night only',
	'Indoors only',
	'Outdoors only',
	'Not while shapeshifted',
	'Only in stealth',
	'Weapons stay drawn',
	'Scales with creature level',
	'Stops auto attack',
	'Cannot be dodged, parried or blocked',
	'Tracks the target while casting (players)',
	'Castable while dead',
	'Castable while mounted',
	'Cooldown starts when the aura or summon ends',
	'Debuff',
	'Castable while sitting',
	'Not in combat',
	'Ignores invulnerability',
	'Effects may break early (heartbeat resist)',
	'The buff cannot be cancelled',
])

/** spell_template.attributesEx (SpellAttributesEx). */
export const SPELL_ATTRIBUTES_EX = bits([
	'Dismisses the pet first',
	'Uses all power',
	'Channelled',
	'Cannot be redirected',
	'No skill increase',
	'Does not break stealth',
	'Self-channelled',
	'Cannot be reflected',
	'Target must be out of combat',
	'Starts auto attack',
	'No threat',
	'Unique aura',
	'Failure breaks stealth',
	'Toggles far sight',
	'Faces the target while channelling',
	'Immunity removes the effect',
	'Its immunity blocks helpful effects too',
	'Pets do not cast it on their own',
	'Prevents animation (stun, sleep)',
	'Excludes the caster',
	'Finishing move (damage)',
	'Threat only on a miss',
	'Finishing move (duration)',
	'Ignores caster and target checks',
	'Special skill up (fishing)',
	'Unknown 25',
	'Needs every target',
	'Refunds power on a miss',
	'No aura icon',
	'Spell name in the channel bar',
	'Combo point on a block',
	'Cast when learned',
])

/** spell_template.attributesEx2 (SpellAttributesEx2). */
export const SPELL_ATTRIBUTES_EX2 = bits([
	'Can target the dead',
	'No shapeshift UI',
	'Ignores line of sight',
	'Allows buffing low levels',
	'Shows in the stance bar',
	'Auto-repeats',
	'Target must be tapped by the caster',
	'Failures not reported',
	'Unused 8',
	'Unused 9',
	'Special taming flag',
	'No per-target cost a second',
	'Chains from the caster',
	'Enchants own items only',
	'Castable while invisible',
	'Usable after a parry (old)',
	'No active pets',
	'Keeps the swing timers',
	'Needs a dead pet',
	'Needs no shapeshift',
	'Starts auto attack after the cast',
	'Fails if every target is immune',
	'No initial threat',
	'Proc cooldown on failure',
	'Item cast uses the owner’s skill',
	'Does not block mana regen',
	'Ignores school immunities',
	'Ignores weapon skill',
	'Not an action',
	'Cannot crit',
	'Puts the caster in combat',
	'Food or drink buff',
])

/** spell_template.attributesEx3 (SpellAttributesEx3). */
export const SPELL_ATTRIBUTES_EX3 = bits([
	'PvP enabling',
	'Procs without the equipment',
	'No casting bar text',
	'A block stops every effect',
	'No resurrection timer',
	'No durability loss',
	'Area aura stays outside the radius',
	'A stack for each caster',
	'Players only',
	'Not a proc',
	'Needs a main hand weapon',
	'Battlegrounds only',
	'Ghosts only',
	'Hides the channel bar',
	'Hidden in the raid filter',
	'Normal ranged attack',
	'Suppresses caster procs',
	'Suppresses target procs',
	'Always hits',
	'Instant target procs',
	'Aura stays after death',
	'Procs outdoors only',
	'Casting cancels auto-repeat',
	'No damage history',
	'Needs an off hand weapon',
	'Treated as periodic (no pushback)',
	'Can proc from procs',
	'Procs on the caster only',
	'Ignores caster and target checks',
	'Ignores caster modifiers',
	'Range not shown',
	'Not on area-immune targets',
])

/** spell_template.attributesEx4 (SpellAttributesEx4, new in 1.12). */
export const SPELL_ATTRIBUTES_EX4 = bits([
	'Ignores resistances',
	'Class trigger only on the target',
	'Aura expires while offline',
	'No helpful threat',
	'No harmful threat',
	'Client targeting',
	'Cannot be stolen',
	'Castable while casting',
	'Ignores damage taken modifiers',
	'Combat feedback when usable',
])

/** spell_template.customFlags: the server's own (SpellAttributesCustom). */
export const SPELL_CUSTOM_FLAGS = bits([
	'Stacks between casters',
	'Negative',
	'Positive',
	'No channel distance limit',
	'Fixed damage (no bonuses)',
	'Ignores armor',
	'Caster must be behind the target',
	'Target must be in front',
	'One target at a time',
	'Applying it breaks stealth',
	'Kept on evade',
	'Sends the channel visual',
	'A separate aura for each caster',
	'Triggers weapon procs',
])

/** spell_template.targets (SpellCastTargetFlags): what the cast may be aimed at. */
export const TARGET_FLAGS: Array<[number, string]> = [
	[0x1, 'Unused 1'],
	[0x2, 'A unit'],
	[0x4, 'A raid member'],
	[0x8, 'A party member'],
	[0x10, 'An item'],
	[0x20, 'A source location'],
	[0x40, 'A destination location'],
	[0x80, 'An enemy unit'],
	[0x100, 'A friendly unit'],
	[0x200, 'An enemy corpse'],
	[0x400, 'A dead unit'],
	[0x800, 'A game object'],
	[0x1000, 'A trade item'],
	[0x2000, 'A string'],
	[0x4000, 'A lock (opening)'],
	[0x8000, 'A friendly corpse'],
	[0x10000, 'A mini pet'],
]

/** spell_template.interruptFlags (SpellInterruptFlags): what interrupts the cast. */
export const INTERRUPT_FLAGS: Array<[number, string]> = [
	[0x1, 'Movement'],
	[0x2, 'Damage pushes it back'],
	[0x4, 'Stun'],
	[0x8, 'Combat'],
	[0x10, 'Damage cancels it'],
]

/** auraInterruptFlags and channelInterruptFlags (SpellAuraInterruptFlags): what removes the aura or stops the channel. */
export const AURA_INTERRUPT_FLAGS = bits([
	'A hostile spell hits',
	'Damage',
	'An action (start)',
	'Moving',
	'Turning',
	'An animation (feign death)',
	'Dismounting',
	'Going under water',
	'Leaving the water',
	'Sheathing',
	'Talking to an NPC',
	'Looting or using an object',
	'Attacking',
	'Using an item',
	'Damage (shortens a channel)',
	'Shapeshifting',
	'An action (end)',
	'Mounting',
	'Standing up',
	'Leaving the world',
	'Stealth or invisibility',
	'An invulnerability buff',
	'Entering the world',
])

/** spell_template.procFlags (ProcFlags): what makes the aura proc. */
export const PROC_FLAGS = bits([
	'Heartbeat (a tick)',
	'Killing',
	'Dealing a melee swing',
	'Taking a melee swing',
	'Dealing a melee ability',
	'Taking a melee ability',
	'Dealing a ranged attack',
	'Taking a ranged attack',
	'Dealing a ranged ability',
	'Taking a ranged ability',
	'Dealing a helpful ability',
	'Taking a helpful ability',
	'Dealing a harmful ability',
	'Taking a harmful ability',
	'Dealing a helpful spell',
	'Taking a helpful spell',
	'Dealing a harmful spell',
	'Taking a harmful spell',
	'Dealing periodic damage',
	'Taking periodic damage',
	'Taking any damage',
	'A trap triggering',
	'A main hand swing',
	'An off hand swing',
])

/** The shapeshift forms (ShapeshiftForm in VMaNGOS' SharedDefines.h, checked against SpellShapeshiftForm.dbc). */
export const FORMS: Array<[number, string]> = [
	[1, 'Cat'],
	[2, 'Tree of life'],
	[3, 'Travel'],
	[4, 'Aquatic'],
	[5, 'Bear'],
	[6, 'Ambient'],
	[7, 'Ghoul'],
	[8, 'Dire bear'],
	[14, 'Creature bear'],
	[15, 'Creature cat'],
	[16, 'Ghost wolf'],
	[17, 'Battle stance'],
	[18, 'Defensive stance'],
	[19, 'Berserker stance'],
	[28, 'Shadowform'],
	[30, 'Stealth'],
	[31, 'Moonkin'],
	[32, 'Spirit of redemption'],
]

/** stances and stancesNot: form f is bit 1 << (f - 1). */
export const FORM_MASK: Array<[number, string]> = FORMS.map(([f, n]) => [2 ** (f - 1), n] as [number, string])

/** targetCreatureType and the "versus" auras' masks: creature type t is bit 1 << (t - 1). */
export const CREATURE_TYPE_MASK: Array<[number, string]> = named(CREATURE_TYPES)
	.filter(([t]) => t > 0)
	.map(([t, n]) => [2 ** (t - 1), n] as [number, string])

/** casterAuraState and targetAuraState (AuraState in SpellDefines.h). */
export const AURA_STATES: Array<[number, string]> = [
	[0, 'None'],
	[1, 'Defense (after a dodge, block or parry)'],
	[2, 'Health under 20%'],
	[3, 'Berserking'],
	[4, 'Frozen'],
	[5, 'Judgement'],
	[7, 'Hunter parried'],
	[8, 'Attacking from stealth'],
	[9, 'Health under 15% (server)'],
	[10, 'Health under 10% (server)'],
	[11, 'Health under 5% (server)'],
]

/** spellFamilyName (SpellFamily in SpellDefines.h): the class a talent or set bonus finds the spell by. */
export const SPELL_FAMILIES: Array<[number, string]> = [
	[0, 'Generic'],
	[1, 'Events and holidays'],
	[3, 'Mage'],
	[4, 'Warrior'],
	[5, 'Warlock'],
	[6, 'Priest'],
	[7, 'Druid'],
	[8, 'Rogue'],
	[9, 'Hunter'],
	[10, 'Paladin'],
	[11, 'Shaman'],
	[12, 'Unknown 12'],
	[13, 'Potion'],
	[15, 'Death knight (unused)'],
	[17, 'Unknown 17'],
]

/** minReputation: the reputation ranks (ReputationRank). */
export const REPUTATION_RANKS: Array<[number, string]> = REP_RANKS.map((n, i) => [i, n] as [number, string])

/** equippedItemClass: an item class, -1 for none needed. */
export const EQUIPPED_CLASSES: Array<[number, string]> = [[-1, 'None needed'], ...ITEM_CLASSES]

/** equippedItemInventoryTypeMask: slot t is bit 1 << t. */
export const INVENTORY_TYPE_MASK: Array<[number, string]> = INVENTORY_TYPES.filter(([t]) => t > 0).map(([t, n]) => [2 ** t, n] as [number, string])

/** equippedItemSubClassMask's bits for item class cls: subclass s is bit 1 << s. */
export function subclassMask(cls: number): Array<[number, string]> {
	return subclassOptions(cls).map(([s, n]) => [2 ** s, n] as [number, string])
}

/** The stats (Stats in SharedDefines.h), as a Modify stat aura's misc value holds them. */
const STATS: Array<[number, string]> = [[-1, 'All stats'], ...named(['Strength', 'Agility', 'Stamina', 'Intellect', 'Spirit'])]

/** An Add modifier aura's misc value: what it changes (SpellModOp in SpellDefines.h). */
const SPELL_MOD_OPS: Array<[number, string]> = [
	...named([
		'Damage',
		'Duration',
		'Threat',
		'Attack power',
		'Charges',
		'Range',
		'Radius',
		'Critical chance',
		'All effects',
		'Not losing cast time',
		'Cast time',
		'Cooldown',
		'Speed',
		'',
		'Cost',
		'Critical damage bonus',
		'Resist and miss chance',
		'Jump targets',
		'Chance of success',
		'Activation time',
		'Effects past the first',
		'Global cooldown',
		'Damage over time',
		'Haste',
		'Spell bonus damage',
	]),
	[27, 'Multiple value'],
	[28, 'Resist dispel chance'],
]

/** The effects that apply their aura (effectApplyAuraName): apply aura, the area auras and the persistent one. */
const AURA_EFFECTS = new Set([6, 27, 35, 119, 128, 129, 132, 133])
const SUMMON_EFFECTS = new Set([28, 41, 42, 56, 73, 74, 87, 88, 89, 90, 97, 112])
const OBJECT_EFFECTS = new Set([50, 76, 81, 83, 104, 105, 106, 107])
const POWER_EFFECTS = new Set([8, 30, 62])
const POWER_AURAS = new Set([24, 35, 64, 85, 110, 132, 162])
const SCHOOL_AURAS = new Set([13, 14, 22, 39, 40, 69, 71, 72, 73, 74, 79, 81, 83, 87, 97, 101, 115, 123, 135, 136, 142, 143, 179, 182])
const CREATURE_TYPE_AURAS = new Set([59, 102, 131, 168, 169, 180, 181])

/**
 * What effect n's (1 to 3) misc value holds, by its effect and aura (after VMaNGOS' SpellEffects.cpp
 * and SpellAuras.cpp): a creature, a game object, a reputation faction, a skill, a quest, a language,
 * a lock type, a flight path or an event script as a picker; a power, a dispel type, a mechanic, a
 * stat, a form, a creature type, an effect, an aura or a modifier as a select; a school, mechanic or
 * creature type mask as a tick list. The rest stays a number.
 */
export function miscField(n: number, v: Record<string, string>): CreatureField {
	const col = `effectMiscValue${n}`
	const base: CreatureField = { col, label: 'Misc value', hint: 'The effect’s or aura’s own number: what it holds follows the effect and aura' }
	const effect = num(v, `effect${n}`)
	const aura = AURA_EFFECTS.has(effect) ? num(v, `effectApplyAuraName${n}`) : 0
	const as = (label: string, f: Partial<CreatureField>): CreatureField => ({ ...base, label, ...f })
	if (SUMMON_EFFECTS.has(effect)) return as('Creature', { ref: 'creature', hint: 'The creature it summons' })
	if (OBJECT_EFFECTS.has(effect)) return as('Game object', { ref: 'object', hint: 'The game object it puts down' })
	if (POWER_EFFECTS.has(effect) || POWER_AURAS.has(aura)) return as('Power', { options: POWER_TYPES })
	switch (effect) {
		case 16:
			return as('Quest', { ref: 'quest', hint: 'The quest it completes' })
		case 33:
		case 59:
			return as('Lock type', { ref: 'lock type', hint: 'The kind of lock it opens (LockType.dbc)' })
		case 38:
			return as('Dispel type', { options: DISPELS })
		case 39:
			return as('Language', { ref: 'language', hint: 'The language it teaches' })
		case 44:
		case 118:
			return as('Skill', { ref: 'skill' })
		case 53:
		case 54:
		case 92:
			return as('Enchantment', { ref: 'item enchantment', hint: 'The enchantment it puts on the item (SpellItemEnchantment.dbc)' })
		case 61:
			return as('Event', { ref: 'event', hint: 'The event script it starts (event_scripts)' })
		case 103:
			return as('Faction', { ref: 'faction', hint: 'The reputation it gives' })
		case 108:
			return as('Mechanic', { options: MECHANICS, hint: 'The mechanic it dispels' })
		case 123:
			return as('Flight path', { ref: 'taxi path' })
	}
	if (SCHOOL_AURAS.has(aura)) return as('Schools', { flags: SCHOOL_MASK })
	if (CREATURE_TYPE_AURAS.has(aura)) return as('Creature types', { flags: CREATURE_TYPE_MASK })
	switch (aura) {
		case 29:
		case 80:
		case 137:
			return as('Stat', { options: STATS })
		case 30:
		case 98:
			return as('Skill', { ref: 'skill' })
		case 36:
			return as('Form', { options: [[0, 'None'], ...FORMS] })
		case 37:
			return as('Effect', { options: SPELL_EFFECTS, hint: 'The effect it makes its target immune to' })
		case 38:
			return as('Aura', { options: SPELL_AURAS, hint: 'The aura it makes its target immune to' })
		case 41:
		case 178:
			return as('Dispel type', { options: DISPELS })
		case 44:
			return as('Creature type', { options: named(CREATURE_TYPES).filter(([t]) => t > 0), hint: 'The creatures it tracks' })
		case 45:
			return as('Lock type', { ref: 'lock type', hint: 'The resources it tracks (LockType.dbc)' })
		case 56:
		case 78:
			return as('Creature', { ref: 'creature', hint: aura === 56 ? 'The creature it turns its target into' : 'The creature whose model it rides' })
		case 75:
			return as('Language', { ref: 'language' })
		case 77:
		case 117:
			return as('Mechanic', { options: MECHANICS })
		case 107:
		case 108:
			return as('Modifies', { options: SPELL_MOD_OPS, hint: 'What it changes in the spells it affects' })
		case 139:
		case 190:
			return as('Faction', { ref: 'faction' })
		case 147:
			return as('Mechanics', { flags: MECHANIC_MASK })
	}
	return base
}

/** A select of a client table's rows, the "none" row first when the table has no 0. */
const tableOptions = (rows: vmangos.SpellOption[] | undefined, none: string): Array<[number, string]> => {
	const out: Array<[number, string]> = (rows ?? []).map((r) => [r.id, `${r.label} (${r.id})`])
	return out.some(([v]) => v === 0) ? out : [[0, none], ...out]
}

/** One effect's fields (n is 1 to 3). */
function effectFields(n: number, tables: vmangos.SpellTables | null, v: Record<string, string>): CreatureField[] {
	return [
		{ col: `effect${n}`, label: 'Effect', options: SPELL_EFFECTS, hint: 'What the effect does' },
		{ col: `effectApplyAuraName${n}`, label: 'Aura', options: SPELL_AURAS, hint: 'The aura an Apply aura effect puts on its targets' },
		{ col: `effectBasePoints${n}`, label: 'Base points', hint: 'The value is base points + 1 die: base points + base dice to base points + die sides' },
		{ col: `effectDieSides${n}`, label: 'Die sides' },
		{ col: `effectBaseDice${n}`, label: 'Base dice' },
		{ col: `effectRealPointsPerLevel${n}`, label: 'Points a level', hint: 'Added to the value for each caster level over the spell level' },
		{ col: `effectDicePerLevel${n}`, label: 'Dice a level' },
		{ col: `effectPointsPerComboPoint${n}`, label: 'Points a combo point' },
		{ col: `effectImplicitTargetA${n}`, label: 'Target', options: SPELL_TARGETS },
		{ col: `effectImplicitTargetB${n}`, label: 'Second target', options: SPELL_TARGETS, hint: 'Where an area of effect lands, or who in it' },
		{ col: `effectRadiusIndex${n}`, label: 'Radius', options: tableOptions(tables?.radii, 'None') },
		{ col: `effectAmplitude${n}`, label: 'Period (ms)', hint: 'How often a periodic aura ticks' },
		{ col: `effectChainTarget${n}`, label: 'Chain targets' },
		{ col: `effectMultipleValue${n}`, label: 'Multiple value', hint: 'A chain or drain effect’s multiplier' },
		miscField(n, v),
		{ col: `effectTriggerSpell${n}`, label: 'Triggers spell', ref: 'spell' },
		{ col: `effectItemType${n}`, label: 'Item', ref: 'item', hint: 'The item a Create item effect makes' },
		{ col: `effectMechanic${n}`, label: 'Mechanic', options: MECHANICS },
		{ col: `dmgMultiplier${n}`, label: 'Damage multiplier' },
		{ col: `effectBonusCoefficient${n}`, label: 'Spell power coefficient', hint: 'The server’s: how much of the caster’s spell power it adds (-1 for the default)' },
	]
}

function spellTabList(tables: vmangos.SpellTables | null, v: Record<string, string>): QuestTab[] {
	const cls = v.equippedItemClass === undefined || v.equippedItemClass === '' ? -1 : Number(v.equippedItemClass)
	return [
		{
			id: 'spell',
			title: 'Spell',
			groups: [
				{
					title: 'Text',
					fields: [
						{ col: 'name', label: 'Name' },
						{ col: 'nameSubtext', label: 'Rank', hint: 'Shown at the right of the name, such as Rank 1' },
						{ col: 'description', label: 'Description', long: true, hint: 'The tooltip text. $s1 is effect 1’s value, $o1 its total over the duration, $d the duration, $t1 its period' },
						{ col: 'auraDescription', label: 'Buff text', long: true, hint: 'The text of the buff or debuff it leaves, under its icon' },
					],
				},
				{
					title: 'Casting',
					fields: [
						{ col: 'school', label: 'School', options: SPELL_SCHOOLS },
						{ col: 'castingTimeIndex', label: 'Cast time', options: tableOptions(tables?.castTimes, 'Instant') },
						{ col: 'rangeIndex', label: 'Range', options: tableOptions(tables?.ranges, 'None') },
						{ col: 'durationIndex', label: 'Duration', options: tableOptions(tables?.durations, 'None') },
						{ col: 'powerType', label: 'Costs', options: POWER_TYPES },
						{ col: 'manaCost', label: 'Cost', hint: 'Rage is in tenths: 100 is 10 rage' },
						{ col: 'manaCostPercentage', label: 'Cost (% of base mana)' },
						{ col: 'manCostPerLevel', label: 'Cost a level' },
						{ col: 'manaPerSecond', label: 'Cost a second' },
						{ col: 'recoveryTime', label: 'Cooldown (ms)' },
						{ col: 'categoryRecoveryTime', label: 'Category cooldown (ms)' },
						{ col: 'category', label: 'Cooldown category', ref: 'spell category', hint: 'Spells of one category share the category cooldown' },
						{ col: 'startRecoveryTime', label: 'Global cooldown (ms)' },
						{ col: 'startRecoveryCategory', label: 'Global cooldown category', ref: 'global category', hint: 'Spells of one category share the global cooldown (133 is the usual one)' },
						{ col: 'speed', label: 'Missile speed', hint: 'Yards a second a bolt flies; 0 hits at once' },
					],
				},
				{
					title: 'Levels',
					fields: [
						{ col: 'spellLevel', label: 'Spell level' },
						{ col: 'baseLevel', label: 'Base level' },
						{ col: 'maxLevel', label: 'Max level', hint: 'The level its points stop growing at' },
						{ col: 'maxTargetLevel', label: 'Max target level' },
					],
				},
				{
					title: 'Rules',
					fields: [
						{ col: 'dispel', label: 'Dispel type', options: DISPELS },
						{ col: 'mechanic', label: 'Mechanic', options: MECHANICS },
						{ col: 'dmgClass', label: 'Damage class', options: DAMAGE_CLASSES },
						{ col: 'preventionType', label: 'Stopped by', options: PREVENTION },
						{ col: 'stackAmount', label: 'Stacks to' },
						{ col: 'procChance', label: 'Proc chance (%)' },
						{ col: 'procCharges', label: 'Charges' },
						{ col: 'maxAffectedTargets', label: 'Most targets' },
						{ col: 'modelNextSpell', label: 'Next spell', ref: 'spell', hint: 'The spell an auto-repeating spell casts again, such as Auto Shot' },
					],
				},
				{
					title: 'Reagents and totems',
					fields: [
						...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((i): CreatureField[] => [
							{ col: `reagent${i}`, label: `Reagent ${i}`, ref: 'item', hint: 'An item the cast uses up' },
							{ col: `reagentCount${i}`, label: 'Count' },
						]),
						{ col: 'totem1', label: 'Tool 1', ref: 'item', hint: 'An item the caster must carry, not used up (a totem, a blacksmith hammer)' },
						{ col: 'totem2', label: 'Tool 2', ref: 'item' },
					],
				},
			],
		},
		...[1, 2, 3].map((n) => ({ id: `effect${n}`, title: `Effect ${n}`, groups: [{ title: `Effect ${n}`, fields: effectFields(n, tables, v) }] })),
		{
			id: 'needs',
			title: 'Needs',
			groups: [
				{
					title: 'Caster',
					fields: [
						{ col: 'stances', label: 'Only in these forms', flags: FORM_MASK, hint: 'None ticked: in any form' },
						{ col: 'stancesNot', label: 'Not in these forms', flags: FORM_MASK },
						{ col: 'casterAuraState', label: 'Caster aura state', options: AURA_STATES, hint: 'A state the caster must be in, such as after a dodge (Overpower)' },
						{ col: 'requiresSpellFocus', label: 'Near a spell focus', ref: 'spell focus', hint: 'An object the caster must stand by, such as an anvil or forge (SpellFocusObject.dbc)' },
						{ col: 'minFactionId', label: 'Reputation with', ref: 'faction', hint: 'A faction the caster needs a standing with' },
						{ col: 'minReputation', label: 'At least', options: REPUTATION_RANKS, hint: 'The standing with that faction' },
					],
				},
				{
					title: 'Target',
					fields: [
						{ col: 'targets', label: 'Can target', flags: TARGET_FLAGS, hint: 'None ticked: the caster' },
						{ col: 'targetCreatureType', label: 'Creature types', flags: CREATURE_TYPE_MASK, hint: 'None ticked: any' },
						{ col: 'targetAuraState', label: 'Target aura state', options: AURA_STATES, hint: 'A state the target must be in, such as under 20% health (Execute)' },
					],
				},
				{
					title: 'Equipped item',
					fields: [
						{ col: 'equippedItemClass', label: 'Item class', options: EQUIPPED_CLASSES, hint: 'The kind of item the caster must have equipped' },
						cls >= 0
							? { col: 'equippedItemSubClassMask', label: 'Subclasses', flags: subclassMask(cls), hint: 'None ticked: any of the class' }
							: { col: 'equippedItemSubClassMask', label: 'Subclasses', hint: 'Pick an item class to tick its subclasses' },
						{ col: 'equippedItemInventoryTypeMask', label: 'Slots', flags: INVENTORY_TYPE_MASK, hint: 'None ticked: any slot' },
					],
				},
			],
		},
		{
			id: 'flags',
			title: 'Flags',
			groups: [
				{
					title: 'Interrupts and procs',
					fields: [
						{ col: 'interruptFlags', label: 'The cast is interrupted by', flags: INTERRUPT_FLAGS },
						{ col: 'auraInterruptFlags', label: 'The aura is removed by', flags: AURA_INTERRUPT_FLAGS },
						{ col: 'channelInterruptFlags', label: 'The channel is stopped by', flags: AURA_INTERRUPT_FLAGS },
						{ col: 'procFlags', label: 'Procs on', flags: PROC_FLAGS },
					],
				},
				{
					title: 'Attributes',
					fields: [
						{ col: 'attributes', label: 'Attributes', flags: SPELL_ATTRIBUTES },
						{ col: 'attributesEx', label: 'Attributes 2', flags: SPELL_ATTRIBUTES_EX },
						{ col: 'attributesEx2', label: 'Attributes 3', flags: SPELL_ATTRIBUTES_EX2 },
						{ col: 'attributesEx3', label: 'Attributes 4', flags: SPELL_ATTRIBUTES_EX3 },
						{ col: 'attributesEx4', label: 'Attributes 5', flags: SPELL_ATTRIBUTES_EX4 },
						{ col: 'customFlags', label: 'Server flags', flags: SPELL_CUSTOM_FLAGS, hint: 'The server’s own, not in the client' },
					],
				},
				{
					title: 'Family and look',
					fields: [
						{ col: 'spellFamilyName', label: 'Family', options: SPELL_FAMILIES, hint: 'The class whose talents and set bonuses find it, with the family flags' },
						{ col: 'spellFamilyFlags', label: 'Family flags', hint: 'Which of the family’s spells it is, for the talents that change them' },
						{ col: 'spellVisual2', label: 'Second visual', ref: 'spell visual', hint: 'A second SpellVisual.dbc ID, drawn with the first' },
						{ col: 'activeIconId', label: 'Active icon', ref: 'spell icon', hint: 'The SpellIcon.dbc icon it shows while active (most spells have none)' },
					],
				},
			],
		},
	]
}

/** The look columns, edited beside the tooltip. */
const LOOK_COLUMNS = ['spellIconId', 'spellVisual1']

/**
 * The spell editor's tabs for these columns: listed columns only where the table has them, the rest on
 * Other. The values pick what follows another column: the subclasses of the item class, and each
 * effect's misc value.
 */
export function spellTabs(columns: string[], tables: vmangos.SpellTables | null, values: Record<string, string> = {}): QuestTab[] {
	const have = new Set(columns)
	const list = spellTabList(tables, values)
	const tabs = list.map((t) => ({ ...t, groups: t.groups.map((g) => ({ ...g, fields: g.fields.filter((f) => have.has(f.col)) })).filter((g) => g.fields.length) }))
	const known = new Set([...LOOK_COLUMNS, ...list.flatMap((t) => t.groups.flatMap((g) => g.fields.map((f) => f.col)))])
	const other = fieldGroups(
		columns.filter((c) => !known.has(c)),
		[],
	)
	if (other.length) tabs.push({ id: 'other', title: 'Other', groups: other })
	return tabs.filter((t) => t.groups.length)
}

const num = (v: Record<string, string>, col: string) => Number(v[col]) || 0
const optionValue = (rows: vmangos.SpellOption[] | undefined, id: number) => rows?.find((r) => r.id === id)?.value ?? 0
const nameOf = (list: Array<[number, string]>, v: number) => list.find(([n]) => n === v)?.[1] ?? String(v)

/** A time as the tooltip writes it: 1.5 sec, 2 min, 1 hour. */
export function timeText(ms: number): string {
	if (ms < 0) return 'until cancelled'
	if (ms < 60000) return `${ms / 1000} sec`
	if (ms < 3600000) return `${+(ms / 60000).toFixed(2)} min`
	return `${+(ms / 3600000).toFixed(2)} hour`
}

/** Effect n's (0 to 2) least and most value. */
function effectRange(v: Record<string, string>, n: number): [number, number] {
	const base = num(v, `effectBasePoints${n + 1}`)
	return [base + Math.max(num(v, `effectBaseDice${n + 1}`), 1), base + num(v, `effectDieSides${n + 1}`)]
}

/**
 * A description's $ tokens filled in from the spell's values, as Go's expandSpellText does for the
 * client's rows: $s/$m/$M (an effect's value), $o (its total over the duration), $t (its period), $d
 * (the duration), $h (proc chance), $n (charges), $u (stacks), $x (chain targets), $a (radius) and
 * $lsingular:plural; tokens it doesn't know stay as written.
 */
export function expandSpellText(desc: string, v: Record<string, string>, tables: vmangos.SpellTables | null): string {
	const duration = optionValue(tables?.durations, num(v, 'durationIndex'))
	let last = 0
	return desc.replace(/\$(l([^:;]*):([^;]*);|([sSmMoOtTdDhHnNuUxXaA])([1-3])?)/g, (all, _x, one: string, many: string, tok: string, digit: string) => {
		if (one !== undefined && many !== undefined && !tok) return last === 1 ? one : many
		const e = digit ? Number(digit) - 1 : 0
		const [lo, hi] = effectRange(v, e)
		let n = 0
		switch (tok) {
			case 's':
			case 'S':
				n = Math.abs(lo)
				last = n
				return hi > lo ? `${Math.abs(lo)} to ${Math.abs(hi)}` : String(n)
			case 'm':
				n = Math.abs(lo)
				break
			case 'M':
				n = Math.abs(hi)
				break
			case 'o':
			case 'O': {
				const period = num(v, `effectAmplitude${e + 1}`) || 5000
				n = Math.abs(lo)
				if (duration > 0) n = Math.floor((n * duration) / period)
				break
			}
			case 't':
			case 'T':
				n = Math.trunc(num(v, `effectAmplitude${e + 1}`) / 1000)
				break
			case 'd':
			case 'D':
				return timeText(duration)
			case 'h':
			case 'H':
				n = num(v, 'procChance')
				break
			case 'n':
			case 'N':
				n = num(v, 'procCharges')
				break
			case 'u':
			case 'U':
				n = num(v, 'stackAmount')
				break
			case 'x':
			case 'X':
				n = num(v, `effectChainTarget${e + 1}`)
				break
			case 'a':
			case 'A':
				n = optionValue(tables?.radii, num(v, `effectRadiusIndex${e + 1}`))
				break
			default:
				return all
		}
		last = n
		return String(n)
	})
}

/** A spell's tooltip as the 1.12 client lays it out: name and rank, cost and range, cast time and cooldown, text. */
export interface SpellTip {
	name: string
	rank: string
	cost: string
	range: string
	cast: string
	cooldown: string
	text: string
}

/** AttributesEx's channelled bits (SPELL_ATTR_EX_CHANNELED_1 and _2). */
const CHANNELLED = 0x4 | 0x40

export function spellTooltip(v: Record<string, string>, tables: vmangos.SpellTables | null): SpellTip {
	const power = num(v, 'powerType')
	const cost = num(v, 'manaCost')
	const pct = num(v, 'manaCostPercentage')
	let costText = ''
	if (pct > 0) costText = `${pct}% of base mana`
	else if (cost > 0) costText = power === 1 ? `${cost / 10} Rage` : `${cost} ${nameOf(POWER_TYPES, power)}`
	const range = optionValue(tables?.ranges, num(v, 'rangeIndex'))
	const castMs = optionValue(tables?.castTimes, num(v, 'castingTimeIndex'))
	const cooldown = Math.max(num(v, 'recoveryTime'), num(v, 'categoryRecoveryTime'))
	return {
		name: v.name ?? '',
		rank: v.nameSubtext ?? '',
		cost: costText,
		range: range <= 0 ? '' : range <= 5 ? 'Melee Range' : `${range} yd range`,
		cast: castMs > 0 ? `${castMs / 1000} sec cast` : num(v, 'attributesEx') & CHANNELLED ? 'Channeled' : 'Instant cast',
		cooldown: cooldown > 0 ? `${timeText(cooldown)} cooldown` : '',
		text: expandSpellText(v.description ?? '', v, tables),
	}
}

/** Effect n (1 to 3) in a line, or '' when the slot is empty: what it does, how much, to whom. */
export function effectSummary(v: Record<string, string>, n: number, tables: vmangos.SpellTables | null): string {
	const effect = num(v, `effect${n}`)
	if (!effect) return ''
	const parts: string[] = []
	let what = nameOf(SPELL_EFFECTS, effect)
	const aura = num(v, `effectApplyAuraName${n}`)
	if (aura) what += `: ${nameOf(SPELL_AURAS, aura)}`
	const [lo, hi] = effectRange(v, n - 1)
	if (lo || hi) what += ` ${hi > lo ? `${lo} to ${hi}` : lo}`
	const period = num(v, `effectAmplitude${n}`)
	if (period) what += ` every ${timeText(period)}`
	parts.push(what)
	const target = num(v, `effectImplicitTargetA${n}`)
	if (target) parts.push(nameOf(SPELL_TARGETS, target))
	const radius = optionValue(tables?.radii, num(v, `effectRadiusIndex${n}`))
	if (radius) parts.push(`${radius} yd radius`)
	const trigger = num(v, `effectTriggerSpell${n}`)
	if (trigger) parts.push(`triggers spell ${trigger}`)
	return parts.join(' · ')
}

/** spell_template.effect1-3 (SpellEffects in VMaNGOS SpellDefines.h). */
export const SPELL_EFFECTS: Array<[number, string]> = [
	[0, 'None'],
	[1, 'Instakill'],
	[2, 'Damage'],
	[3, 'Dummy (a server script)'],
	[4, 'Portal teleport'],
	[5, 'Teleport units'],
	[6, 'Apply aura'],
	[7, 'Environmental damage'],
	[8, 'Power drain'],
	[9, 'Health leech'],
	[10, 'Heal'],
	[11, 'Bind'],
	[12, 'Portal'],
	[13, 'Ritual base'],
	[14, 'Ritual specialize'],
	[15, 'Ritual activate portal'],
	[16, 'Quest complete'],
	[17, 'Weapon damage noschool'],
	[18, 'Resurrect'],
	[19, 'Add extra attacks'],
	[20, 'Dodge'],
	[21, 'Evade'],
	[22, 'Parry'],
	[23, 'Block'],
	[24, 'Create item'],
	[25, 'Weapon'],
	[26, 'Defense'],
	[27, 'Persistent area aura'],
	[28, 'Summon'],
	[29, 'Leap'],
	[30, 'Energize'],
	[31, 'Weapon percent damage'],
	[32, 'Trigger missile'],
	[33, 'Open lock'],
	[34, 'Summon change item'],
	[35, 'Apply area aura party'],
	[36, 'Learn spell'],
	[37, 'Spell defense'],
	[38, 'Dispel'],
	[39, 'Language'],
	[40, 'Dual wield'],
	[41, 'Summon wild'],
	[42, 'Summon guardian'],
	[43, 'Teleport units face caster'],
	[44, 'Skill step'],
	[45, 'Add honor'],
	[46, 'Spawn'],
	[47, 'Trade skill'],
	[48, 'Stealth'],
	[49, 'Detect'],
	[50, 'Trans door'],
	[51, 'Force critical hit'],
	[52, 'Guarantee hit'],
	[53, 'Enchant item'],
	[54, 'Enchant item temporary'],
	[55, 'Tamecreature'],
	[56, 'Summon pet'],
	[57, 'Learn pet spell'],
	[58, 'Weapon damage'],
	[59, 'Open lock item'],
	[60, 'Proficiency'],
	[61, 'Send event'],
	[62, 'Power burn'],
	[63, 'Threat'],
	[64, 'Trigger spell'],
	[65, 'Health funnel'],
	[66, 'Power funnel'],
	[67, 'Heal max health'],
	[68, 'Interrupt cast'],
	[69, 'Distract'],
	[70, 'Pull'],
	[71, 'Pickpocket'],
	[72, 'Add farsight'],
	[73, 'Summon possessed'],
	[74, 'Summon totem'],
	[75, 'Heal mechanical'],
	[76, 'Summon object wild'],
	[77, 'Script effect'],
	[78, 'Attack'],
	[79, 'Sanctuary'],
	[80, 'Add combo points'],
	[81, 'Create house'],
	[82, 'Bind sight'],
	[83, 'Duel'],
	[84, 'Stuck'],
	[85, 'Summon player'],
	[86, 'Activate object'],
	[87, 'Summon totem slot1'],
	[88, 'Summon totem slot2'],
	[89, 'Summon totem slot3'],
	[90, 'Summon totem slot4'],
	[91, 'Threat all'],
	[92, 'Enchant held item'],
	[93, 'Summon phantasm'],
	[94, 'Self resurrect'],
	[95, 'Skinning'],
	[96, 'Charge'],
	[97, 'Summon critter'],
	[98, 'Knock back'],
	[99, 'Disenchant'],
	[100, 'Inebriate'],
	[101, 'Feed pet'],
	[102, 'Dismiss pet'],
	[103, 'Reputation'],
	[104, 'Summon object slot1'],
	[105, 'Summon object slot2'],
	[106, 'Summon object slot3'],
	[107, 'Summon object slot4'],
	[108, 'Dispel mechanic'],
	[109, 'Summon dead pet'],
	[110, 'Destroy all totems'],
	[111, 'Durability damage'],
	[112, 'Summon demon'],
	[113, 'Resurrect new'],
	[114, 'Attack me'],
	[115, 'Durability damage %'],
	[116, 'Skin player corpse'],
	[117, 'Spirit heal'],
	[118, 'Skill'],
	[119, 'Apply area aura pet'],
	[120, 'Teleport graveyard'],
	[121, 'Normalized weapon dmg'],
	[122, 'Unused (122)'],
	[123, 'Send taxi'],
	[124, 'Player pull'],
	[125, 'Modify threat percent'],
	[126, 'Unused (126)'],
	[127, 'Unused (127)'],
	[128, 'Apply area aura friend'],
	[129, 'Apply area aura enemy'],
	[130, 'Despawn object'],
	[131, 'Nostalrius (server custom)'],
	[132, 'Apply area aura raid'],
	[133, 'Apply area aura owner'],
]

/** spell_template.effectApplyAuraName1-3 (AuraType in VMaNGOS SpellAuraDefines.h). */
export const SPELL_AURAS: Array<[number, string]> = [
	[0, 'None'],
	[1, 'Bind sight'],
	[2, 'Modify possess'],
	[3, 'Periodic damage'],
	[4, 'Dummy (a server script)'],
	[5, 'Modify confuse'],
	[6, 'Modify charm'],
	[7, 'Modify fear'],
	[8, 'Periodic heal'],
	[9, 'Modify attackspeed'],
	[10, 'Modify threat'],
	[11, 'Modify taunt'],
	[12, 'Modify stun'],
	[13, 'Modify damage done'],
	[14, 'Modify damage taken'],
	[15, 'Damage shield'],
	[16, 'Modify stealth'],
	[17, 'Modify stealth detect'],
	[18, 'Modify invisibility'],
	[19, 'Modify invisibility detection'],
	[20, 'Modify (observed) health'],
	[21, 'Modify (observed) mana'],
	[22, 'Modify resistance'],
	[23, 'Periodic trigger spell'],
	[24, 'Periodic energize'],
	[25, 'Modify pacify'],
	[26, 'Modify root'],
	[27, 'Modify silence'],
	[28, 'Reflect spells'],
	[29, 'Modify stat'],
	[30, 'Modify skill'],
	[31, 'Modify increase speed'],
	[32, 'Modify increase mounted speed'],
	[33, 'Modify decrease speed'],
	[34, 'Modify increase health'],
	[35, 'Modify increase energy'],
	[36, 'Modify shapeshift'],
	[37, 'Effect immunity'],
	[38, 'State immunity'],
	[39, 'School immunity'],
	[40, 'Damage immunity'],
	[41, 'Dispel immunity'],
	[42, 'Proc trigger spell'],
	[43, 'Proc trigger damage'],
	[44, 'Track creatures'],
	[45, 'Track resources'],
	[46, 'Modify parry skill'],
	[47, 'Modify parry percent'],
	[48, 'Modify dodge skill'],
	[49, 'Modify dodge percent'],
	[50, 'Modify block skill'],
	[51, 'Modify block percent'],
	[52, 'Modify crit percent'],
	[53, 'Periodic leech'],
	[54, 'Modify hit chance'],
	[55, 'Modify spell hit chance'],
	[56, 'Transform'],
	[57, 'Modify spell crit chance'],
	[58, 'Modify increase swim speed'],
	[59, 'Modify damage done creature'],
	[60, 'Modify pacify silence'],
	[61, 'Modify scale'],
	[62, 'Periodic health funnel'],
	[63, 'Periodic mana funnel'],
	[64, 'Periodic mana leech'],
	[65, 'Modify casting speed not stack'],
	[66, 'Feign death'],
	[67, 'Modify disarm'],
	[68, 'Modify stalked'],
	[69, 'School absorb'],
	[70, 'Extra attacks'],
	[71, 'Modify spell crit chance school'],
	[72, 'Modify power cost school %'],
	[73, 'Modify power cost school'],
	[74, 'Reflect spells school'],
	[75, 'Modify language'],
	[76, 'Far sight'],
	[77, 'Mechanic immunity'],
	[78, 'Mounted'],
	[79, 'Modify damage percent done'],
	[80, 'Modify percent stat'],
	[81, 'Split damage %'],
	[82, 'Water breathing'],
	[83, 'Modify base resistance'],
	[84, 'Modify regen'],
	[85, 'Modify power regen'],
	[86, 'Channel death item'],
	[87, 'Modify damage percent taken'],
	[88, 'Modify health regen percent'],
	[89, 'Periodic damage percent'],
	[90, 'Modify resist chance'],
	[91, 'Modify detect range'],
	[92, 'Prevents fleeing'],
	[93, 'Modify unattackable'],
	[94, 'Interrupt regen'],
	[95, 'Ghost'],
	[96, 'Spell magnet'],
	[97, 'Mana shield'],
	[98, 'Modify skill talent'],
	[99, 'Modify attack power'],
	[100, 'Auras visible'],
	[101, 'Modify resistance %'],
	[102, 'Modify melee attack power versus'],
	[103, 'Modify total threat'],
	[104, 'Water walk'],
	[105, 'Feather fall'],
	[106, 'Hover'],
	[107, 'Add flat modifier'],
	[108, 'Add % modifier'],
	[109, 'Add target trigger'],
	[110, 'Modify power regen percent'],
	[111, 'Add caster hit trigger'],
	[112, 'Override class scripts'],
	[113, 'Modify ranged damage taken'],
	[114, 'Modify ranged damage taken %'],
	[115, 'Modify healing'],
	[116, 'Modify regen during combat'],
	[117, 'Modify mechanic resistance'],
	[118, 'Modify healing %'],
	[119, 'Share pet tracking'],
	[120, 'Untrackable'],
	[121, 'Empathy'],
	[122, 'Modify offhand damage %'],
	[123, 'Modify target resistance'],
	[124, 'Modify ranged attack power'],
	[125, 'Modify melee damage taken'],
	[126, 'Modify melee damage taken %'],
	[127, 'Ranged attack power attacker bonus'],
	[128, 'Modify possess pet'],
	[129, 'Modify speed always'],
	[130, 'Modify mounted speed always'],
	[131, 'Modify ranged attack power versus'],
	[132, 'Modify increase energy percent'],
	[133, 'Modify increase health percent'],
	[134, 'Modify mana regen interrupt'],
	[135, 'Modify healing done'],
	[136, 'Modify healing done percent'],
	[137, 'Modify total stat percentage'],
	[138, 'Modify melee haste'],
	[139, 'Force reaction'],
	[140, 'Modify ranged haste'],
	[141, 'Modify ranged ammo haste'],
	[142, 'Modify base resistance %'],
	[143, 'Modify resistance exclusive'],
	[144, 'Safe fall'],
	[145, 'Charisma'],
	[146, 'Persuaded'],
	[147, 'Mechanic immunity mask'],
	[148, 'Retain combo points'],
	[149, 'Resist pushback'],
	[150, 'Modify shield blockvalue %'],
	[151, 'Track stealthed'],
	[152, 'Modify detected range'],
	[153, 'Split damage flat'],
	[154, 'Modify stealth level'],
	[155, 'Modify water breathing'],
	[156, 'Modify reputation gain'],
	[157, 'Pet damage multi'],
	[158, 'Modify shield blockvalue'],
	[159, 'No pvp credit'],
	[160, 'Modify aoe avoidance'],
	[161, 'Modify health regen in combat'],
	[162, 'Power burn mana'],
	[163, 'Modify crit damage bonus'],
	[164, 'Unused (164)'],
	[165, 'Melee attack power attacker bonus'],
	[166, 'Modify attack power %'],
	[167, 'Modify ranged attack power %'],
	[168, 'Modify damage done versus'],
	[169, 'Modify crit percent versus'],
	[170, 'Detect amore'],
	[171, 'Modify speed not stack'],
	[172, 'Modify mounted speed not stack'],
	[173, 'Allow champion spells'],
	[174, 'Modify spell damage of stat percent'],
	[175, 'Modify spell healing of stat percent'],
	[176, 'Spirit of redemption'],
	[177, 'Aoe charm'],
	[178, 'Modify debuff resistance'],
	[179, 'Modify attacker spell crit chance'],
	[180, 'Modify flat spell damage versus'],
	[181, 'Modify flat spell crit damage versus'],
	[182, 'Modify resistance of stat percent'],
	[183, 'Modify critical threat'],
	[184, 'Modify attacker melee hit chance'],
	[185, 'Modify attacker ranged hit chance'],
	[186, 'Modify attacker spell hit chance'],
	[187, 'Modify attacker melee crit chance'],
	[188, 'Modify attacker ranged crit chance'],
	[189, 'Modify rating'],
	[190, 'Modify faction reputation gain'],
	[191, 'Use normal movement speed'],
	[192, 'Aura spell'],
]

/** spell_template.effectImplicitTargetA1-3 and B1-3 (Targets in VMaNGOS SpellDefines.h). */
export const SPELL_TARGETS: Array<[number, string]> = [
	[0, 'None'],
	[1, 'Caster (self)'],
	[2, 'Unit enemy near caster'],
	[3, 'Unit friend near caster'],
	[4, 'Unit near caster'],
	[5, "Caster's pet"],
	[6, 'Enemy target'],
	[7, 'Enum units script aoe at src loc'],
	[8, 'Enum units script aoe at dest loc'],
	[9, 'Location caster home bind'],
	[10, 'Location caster divine bind (not in the game)'],
	[11, 'Player (not in the game)'],
	[12, 'Player near caster (not in the game)'],
	[13, 'Player enemy (not in the game)'],
	[14, 'Player friend (not in the game)'],
	[15, 'Enemies in an area at the source'],
	[16, 'Enemies in an area at the destination'],
	[17, 'Location database'],
	[18, 'Location caster dest'],
	[19, 'Unk 19'],
	[20, 'Enum units party within caster range'],
	[21, 'Friendly target'],
	[22, 'The caster as the source'],
	[23, 'Gameobject'],
	[24, 'Enum units enemy in cone 24'],
	[25, 'Any target'],
	[26, 'Locked'],
	[27, 'Unit caster master'],
	[28, 'Enum units enemy aoe at dynobj loc'],
	[29, 'Enum units friend aoe at dynobj loc'],
	[30, 'Enum units friend aoe at src loc'],
	[31, 'Enum units friend aoe at dest loc'],
	[32, 'Location unit minion position'],
	[33, 'Enum units party aoe at src loc'],
	[34, 'Enum units party aoe at dest loc'],
	[35, 'Unit party'],
	[36, 'Enum units enemy within caster range'],
	[37, 'Unit friend and party'],
	[38, 'Unit script near caster'],
	[39, 'Location caster fishing spot'],
	[40, 'Gameobject script near caster'],
	[41, 'Location caster front right'],
	[42, 'Location caster back right'],
	[43, 'Location caster back left'],
	[44, 'Location caster front left'],
	[45, 'Unit friend chain heal'],
	[46, 'Location script near caster'],
	[47, 'Location caster front'],
	[48, 'Location caster back'],
	[49, 'Location caster left'],
	[50, 'Location caster right'],
	[51, 'Enum gameobjects script aoe at src loc'],
	[52, 'Enum gameobjects script aoe at dest loc'],
	[53, 'Location caster target position'],
	[54, 'Enum units enemy in cone 54'],
	[55, 'Location caster front leap'],
	[56, 'Enum units raid within caster range'],
	[57, 'Unit raid'],
	[58, 'Unit raid near caster'],
	[59, 'Enum units friend in cone'],
	[60, 'Enum units script in cone 60'],
	[61, 'Unit raid and class'],
	[62, 'Player raid (not in the game)'],
	[63, 'Location unit position'],
]
