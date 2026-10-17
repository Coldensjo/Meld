// An item's tooltip as the 1.12 client draws it, from the server's item_template row (#202): the name
// in its quality's colour, binding, slot and type, damage and speed, armour, stats, resistances,
// durability, required level, the effects' spell texts (Spell.dbc, #217; "spell 433" where the client has none) and the sell price. The row comes by column name
// (`ReadItem`), so a column a VMaNGOS version lacks is just left out.

/** Item quality colours, as the game draws item names. */
export const QUALITY_COLORS = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e6cc80']

/** One line of a tooltip: text on the left, optional text on the right, and how it is drawn. */
export interface TooltipLine {
	left: string
	right?: string
	/** A CSS colour; the tooltip's white when absent. */
	color?: string
	/** The name line, drawn larger. */
	title?: boolean
}

const GREEN = '#1eff00'
const YELLOW = '#ffd100'
const DIM = '#9d9d9d'

const BONDING = ['', 'Binds when picked up', 'Binds when equipped', 'Binds when used', 'Quest Item']

/** inventory_type's slot names (INVTYPE_*), as the tooltip's left column shows them. */
const SLOTS = [
	'',
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
	'One-Hand',
	'Off Hand',
	'Ranged',
	'Back',
	'Two-Hand',
	'Bag',
	'Tabard',
	'Chest',
	'Main Hand',
	'Off Hand',
	'Held In Off-hand',
	'Projectile',
	'Thrown',
	'Ranged',
	'Quiver',
	'Relic',
]

/** Weapon (class 2) subclasses, as the tooltip's right column names them. */
const WEAPONS: Record<number, string> = {
	0: 'Axe',
	1: 'Axe',
	2: 'Bow',
	3: 'Gun',
	4: 'Mace',
	5: 'Mace',
	6: 'Polearm',
	7: 'Sword',
	8: 'Sword',
	10: 'Staff',
	13: 'Fist Weapon',
	15: 'Dagger',
	16: 'Thrown',
	18: 'Crossbow',
	19: 'Wand',
	20: 'Fishing Pole',
}

/** Armour (class 4) subclasses the tooltip names. */
const ARMOR: Record<number, string> = { 1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate', 6: 'Shield', 7: 'Libram', 8: 'Idol', 9: 'Totem' }

/** stat_type values (ITEM_MOD_*) of 1.12. */
const STATS: Record<number, string> = { 0: 'Mana', 1: 'Health', 3: 'Agility', 4: 'Strength', 5: 'Intellect', 6: 'Spirit', 7: 'Stamina' }

const SCHOOLS = ['', 'Holy', 'Fire', 'Nature', 'Frost', 'Shadow', 'Arcane']

const RESISTANCES: [string, string][] = [
	['holy_res', 'Holy'],
	['fire_res', 'Fire'],
	['nature_res', 'Nature'],
	['frost_res', 'Frost'],
	['shadow_res', 'Shadow'],
	['arcane_res', 'Arcane'],
]

const TRIGGERS = ['Use', 'Equip', 'Chance on hit']

/** Copper as the game writes money: "1g 2s 3c", leaving out the empty coins. */
export function money(copper: number): string {
	const g = Math.floor(copper / 10000)
	const s = Math.floor(copper / 100) % 100
	const c = copper % 100
	const parts = [g ? `${g}g` : '', s ? `${s}s` : '', c || (!g && !s) ? `${c}c` : '']
	return parts.filter(Boolean).join(' ')
}

/** The tooltip of an item_template row (column → value). */
export function tooltipLines(row: Record<string, string>, spells: Record<number, string> = {}): TooltipLine[] {
	const n = (col: string) => {
		const v = Number(row[col])
		return Number.isFinite(v) ? v : 0
	}
	const out: TooltipLine[] = []
	const quality = n('quality')
	out.push({ left: row.name || `Item ${row.entry ?? ''}`.trim(), color: QUALITY_COLORS[quality] ?? QUALITY_COLORS[1], title: true })
	const bonding = BONDING[n('bonding')]
	if (bonding) out.push({ left: bonding })
	if (n('max_count') === 1) out.push({ left: 'Unique' })
	if (n('start_quest') > 0) out.push({ left: 'This Item Begins a Quest' })

	const cls = n('class')
	const sub = n('subclass')
	const slot = SLOTS[n('inventory_type')] ?? ''
	const type = cls === 2 ? (WEAPONS[sub] ?? '') : cls === 4 ? (ARMOR[sub] ?? '') : ''
	if (slot === 'Bag' && n('container_slots') > 0) out.push({ left: `${n('container_slots')} Slot Bag` })
	else if (slot || type) out.push({ left: slot, right: type || undefined })

	const delay = n('delay')
	for (let i = 1; i <= 5; i++) {
		const lo = n(`dmg_min${i}`)
		const hi = n(`dmg_max${i}`)
		if (lo <= 0 && hi <= 0) continue
		const school = SCHOOLS[n(`dmg_type${i}`)] ?? ''
		const text = `${Math.round(lo)} - ${Math.round(hi)}${school ? ` ${school}` : ''} Damage`
		if (i === 1) out.push({ left: text, right: delay > 0 ? `Speed ${(delay / 1000).toFixed(2)}` : undefined })
		else out.push({ left: `+ ${text}` })
	}
	if (delay > 0 && (n('dmg_min1') > 0 || n('dmg_max1') > 0)) {
		let dps = 0
		for (let i = 1; i <= 5; i++) dps += (n(`dmg_min${i}`) + n(`dmg_max${i}`)) / 2
		out.push({ left: `(${(dps / (delay / 1000)).toFixed(1)} damage per second)` })
	}
	if (n('armor') > 0) out.push({ left: `${n('armor')} Armor` })
	if (n('block') > 0) out.push({ left: `${n('block')} Block` })
	for (let i = 1; i <= 10; i++) {
		const v = n(`stat_value${i}`)
		const name = STATS[n(`stat_type${i}`)]
		if (v && name) out.push({ left: `${v > 0 ? '+' : ''}${v} ${name}` })
	}
	for (const [col, name] of RESISTANCES) {
		const v = n(col)
		if (v) out.push({ left: `${v > 0 ? '+' : ''}${v} ${name} Resistance` })
	}
	const durability = n('max_durability')
	if (durability > 0) out.push({ left: `Durability ${durability} / ${durability}` })
	const level = n('required_level')
	if (level > 1) out.push({ left: `Requires Level ${level}` })
	for (let i = 1; i <= 5; i++) {
		const spell = n(`spellid_${i}`)
		if (spell <= 0) continue
		const trigger = TRIGGERS[n(`spelltrigger_${i}`)] ?? 'Use'
		out.push({ left: `${trigger}: ${spells[spell] ?? `spell ${spell}`}`, color: GREEN })
	}
	if (row.description) out.push({ left: `"${row.description}"`, color: YELLOW })
	const item = n('item_level')
	if (item > 0) out.push({ left: `Item Level ${item}`, color: DIM })
	const sell = n('sell_price')
	if (sell > 0) out.push({ left: `Sell Price: ${money(sell)}` })
	return out
}
