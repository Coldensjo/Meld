import { CLASSES } from '../wow/classes'
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
  /** A 0/1 checkbox. */
  bool?: boolean
  hint?: string
  /** A number that names a thing: a picker that shows its name (components/RefField.svelte). */
  ref?: RefKind
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
 * a quest (by its absolute value), a faction (Faction.dbc), a zone (positive) or quest sort
 * (negative), a skill or an emote.
 */
export type RefKind = 'item' | 'creature or object' | 'spell' | 'quest' | 'faction' | 'zone or sort' | 'skill' | 'emote'

export interface CreatureFieldGroup {
  title: string
  fields: CreatureField[]
  /** The grid's columns, 3 when absent (2 for pairs, such as an item's stat and its amount). */
  columns?: number
}

const named = (names: string[], from = 0): Array<[number, string]> => names.map((n, i) => [i + from, n] as [number, string]).filter(([, n]) => n !== '')

const SCHOOLS = named(['Physical', 'Holy', 'Fire', 'Nature', 'Frost', 'Shadow', 'Arcane'])

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
      { col: 'unit_class', label: 'Class', options: [[0, 'None'], [1, 'Warrior'], [2, 'Paladin'], [4, 'Rogue'], [8, 'Mage']], classes: 'id' },
      { col: 'faction', label: 'Faction', hint: 'FactionTemplate ID: 14 attacks everyone, 35 is friendly to everyone' },
      { col: 'pet_family', label: 'Pet family' },
      { col: 'civilian', label: 'Civilian', bool: true },
      { col: 'racial_leader', label: 'Racial leader', bool: true },
    ],
  },
  {
    title: 'Services',
    fields: [
      { col: 'npc_flags', label: 'Roles', flags: NPC_FLAGS.map(([bit, n]) => [bit, n[0].toUpperCase() + n.slice(1)] as [number, string]) },
      { col: 'gossip_menu_id', label: 'Gossip menu' },
      { col: 'vendor_id', label: 'Vendor list' },
      { col: 'trainer_id', label: 'Trainer list' },
      { col: 'trainer_type', label: 'Trainer type', options: [[0, 'Class'], [1, 'Mounts'], [2, 'Trade skills'], [3, 'Pets']] },
      { col: 'trainer_spell', label: 'Trainer spell', ref: 'spell' },
      { col: 'trainer_class', label: 'Trainer class', options: [[0, 'None'], ...CLASSES], classes: 'id' },
      { col: 'trainer_race', label: 'Trainer race' },
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
      { col: 'mount_display_id', label: 'Mount display' },
      { col: 'equipment_id', label: 'Equipment', hint: 'creature_equip_template entry: the weapons it holds' },
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
      { col: 'movement_type', label: 'Default movement', options: [[0, 'Idle'], [1, 'Random'], [2, 'Waypoints']] },
      { col: 'inhabit_type', label: 'Lives', options: [[1, 'On the ground'], [2, 'In water'], [3, 'Ground and water'], [4, 'In the air'], [7, 'Anywhere']] },
      { col: 'detection_range', label: 'Aggro range' },
      { col: 'call_for_help_range', label: 'Call for help range' },
      { col: 'leash_range', label: 'Leash range' },
      { col: 'ai_name', label: 'AI', hint: 'EventAI, or empty for the default' },
      { col: 'script_name', label: 'Script' },
      { col: 'spell_list_id', label: 'Spell list' },
      { col: 'pet_spell_list_id', label: 'Pet spell list' },
      { col: 'spawn_spell_id', label: 'Spawn spell', ref: 'spell' },
      { col: 'totem_spell_id', label: 'Totem spell', ref: 'spell' },
      { col: 'auras', label: 'Auras', hint: 'Spell IDs, separated by spaces', spells: true, wide: true },
    ],
  },
  {
    title: 'Loot',
    fields: [
      { col: 'loot_id', label: 'Loot' },
      { col: 'pickpocket_loot_id', label: 'Pickpocket loot' },
      { col: 'skinning_loot_id', label: 'Skinning loot' },
      { col: 'gold_min', label: 'Money from', money: true },
      { col: 'gold_max', label: 'Money to', money: true },
    ],
  },
  {
    title: 'Flags',
    fields: [
      { col: 'mechanic_immune_mask', label: 'Mechanic immunities' },
      { col: 'school_immune_mask', label: 'School immunities' },
      { col: 'immunity_flags', label: 'Immunity flags' },
      { col: 'static_flags1', label: 'Static flags 1' },
      { col: 'static_flags2', label: 'Static flags 2' },
      { col: 'flags_extra', label: 'Extra flags' },
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
