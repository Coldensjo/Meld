// Names for the numbers of a creature_spells slot, from VMaNGOS's source: whom the spell is cast at
// (ScriptCommands.h, ScriptTarget, TARGET_T_*) with what that target's two parameters mean, and the
// cast flags (ScriptCommands.h, CastFlags, CF_*). The server checks the parameters on load
// (ScriptMgr::CheckScriptTargets) and skips a spell whose target is missing one it needs.

export interface CastTarget {
	id: number
	name: string
	/** What target_param1 and target_param2 hold for this target; null where it is unused. */
	params: [string | null, string | null]
}

/** The targets a creature's own spell list uses; the rest (instance data, map events, by GUID) are for scripts. */
export const CAST_TARGETS: readonly CastTarget[] = [
	{ id: 0, name: 'Itself', params: [null, null] },
	{ id: 1, name: 'Its current target', params: [null, null] },
	{ id: 2, name: 'Second on its threat list', params: ['Select flags', null] },
	{ id: 3, name: 'Last on its threat list', params: ['Select flags', null] },
	{ id: 4, name: 'Anyone on its threat list', params: ['Select flags', null] },
	{ id: 5, name: 'Anyone on its threat list but the top', params: ['Select flags', null] },
	{ id: 6, name: 'Nearest on its threat list', params: ['Select flags', null] },
	{ id: 7, name: 'Farthest on its threat list', params: ['Select flags', null] },
	{ id: 8, name: 'Its owner, or itself', params: [null, null] },
	{ id: 9, name: 'Its owner', params: [null, null] },
	{ id: 10, name: 'Nearest creature of an entry', params: ['Creature entry', 'Radius (yd)'] },
	{ id: 28, name: 'Any nearby creature of an entry', params: ['Creature entry', 'Radius (yd)'] },
	{ id: 16, name: 'Any friend', params: ['Radius (yd)', 'Not its target'] },
	{ id: 17, name: 'Most injured friend', params: ['Radius (yd)', 'Below health %'] },
	{ id: 18, name: 'Most injured friend but its target', params: ['Radius (yd)', 'Below health %'] },
	{ id: 19, name: 'A friend without the aura', params: ['Radius (yd)', 'Aura spell'] },
	{ id: 20, name: 'A friend but its target without the aura', params: ['Radius (yd)', 'Aura spell'] },
	{ id: 21, name: 'A friend under crowd control', params: ['Radius (yd)', null] },
	{ id: 25, name: 'Nearest player', params: ['Radius (yd)', null] },
	{ id: 26, name: 'Nearest hostile player', params: ['Radius (yd)', null] },
	{ id: 27, name: 'Nearest friendly player', params: ['Radius (yd)', null] },
]

/** A target by its number; one this list leaves out gets a plain name and both parameters. */
export function castTarget(id: number): CastTarget {
	return CAST_TARGETS.find((t) => t.id === id) ?? { id, name: `Target type ${id}`, params: ['Parameter 1', 'Parameter 2'] }
}

/** How a target parameter is edited: a number, a creature or spell picker, a tick list or a checkbox (#705). */
export type ParamKind = 'number' | 'creature' | 'spell' | 'select flags' | 'bool'

const PARAM_KINDS: Readonly<Record<string, ParamKind>> = {
	'Creature entry': 'creature',
	'Aura spell': 'spell',
	'Select flags': 'select flags',
	'Not its target': 'bool',
}

/** The way a parameter named `label` (a `CastTarget.params` entry) is edited; a quantity stays a number. */
export function paramKind(label: string): ParamKind {
	return PARAM_KINDS[label] ?? 'number'
}

/** Who on the threat list a target may pick: VMaNGOS's SelectFlags (CreatureDefines.h, SELECT_FLAG_*). */
export const SELECT_FLAGS: readonly { bit: number; name: string }[] = [
	{ bit: 0x001, name: 'In line of sight' },
	{ bit: 0x002, name: 'A player' },
	{ bit: 0x004, name: 'Uses mana' },
	{ bit: 0x008, name: 'Uses rage' },
	{ bit: 0x010, name: 'Uses energy' },
	{ bit: 0x040, name: 'In melee range' },
	{ bit: 0x080, name: 'Out of melee range' },
	{ bit: 0x100, name: 'Not a totem' },
	{ bit: 0x200, name: 'A player, not a GM' },
	{ bit: 0x400, name: 'A pet' },
	{ bit: 0x800, name: 'Not a player' },
	{ bit: 0x1000, name: 'Uses no mana' },
]

export const CAST_FLAGS: readonly { bit: number; name: string; hint: string }[] = [
	{ bit: 0x001, name: 'Interrupts', hint: 'Interrupts whatever it is casting' },
	{ bit: 0x002, name: 'Triggered', hint: 'No mana cost and no cast time' },
	{ bit: 0x004, name: 'Forced', hint: 'Skips the extra checks before casting' },
	{ bit: 0x008, name: 'Main ranged', hint: 'For ranged creatures: it does not chase its target until the cast fails' },
	{ bit: 0x010, name: 'Target unreachable', hint: 'Only when it cannot reach its target' },
	{ bit: 0x020, name: 'Aura not present', hint: 'Only when the target does not have the aura already' },
	{ bit: 0x040, name: 'In melee', hint: 'Only in melee range of its target' },
	{ bit: 0x080, name: 'Not in melee', hint: 'Only out of melee range of its target' },
	{ bit: 0x100, name: 'Target casting', hint: 'Only while its target is casting' },
]

/** A spell's name with its rank, as the spell book shows it. */
export function spellLabel(name: string, rank: string): string {
	if (!name) return '(not in the client)'
	return rank ? `${name} (${rank})` : name
}
