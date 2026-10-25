// An item's tooltip as the 1.12 client draws it, from the server's item_template row (#202): the
// lines in the order of the client's tooltip builder as Benilla documents it
// (crates/benilla-ui/src/script/tooltip_item/render.rs, ported, not copied): the name in its
// quality's colour, binding, uniqueness, the slot and type, damage and speed, armour, stats in the
// client's order, resistances, durability, who may use it, its requirements, the effects' spell texts
// (Spell.dbc, #217; "spell 433" where the client has none), charges, the set block (#355), the
// description and the right-click line. The item level and sell price, which the 1.12 tooltip doesn't show, follow as
// Meld's own dim lines. The row comes by column name (`ReadItem`), so a column a VMaNGOS version
// lacks is just left out.

/** Item quality colours, as the game draws item names. */
export const QUALITY_COLORS = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e6cc80']

/** The same qualities for names on the page rather than in the tooltip: theme tokens (--q0 to --q6 in app.css), so white and grey stay readable on the light theme (#708). */
export const QUALITY_VARS = QUALITY_COLORS.map((_, i) => `var(--q${i})`)

/** One line of a tooltip: text on the left, optional text on the right, and how it is drawn. */
export interface TooltipLine {
	left: string
	right?: string
	/** A CSS colour; the tooltip's white when absent. */
	color?: string
	/** The name line, drawn larger. */
	title?: boolean
	/** Meld's own line, not the game's (item level, sell price). */
	extra?: boolean
	/** A copper count drawn after `left` as coins (the sell price, #679). */
	money?: number
}

/** Names the tooltip shows that the row only has as numbers; a line whose name is missing is left out. */
export interface TooltipNames {
	/** The effects' spell texts by spell ID. */
	spells?: Record<number, string>
	/** required_skill's name (SkillLine.dbc). */
	skill?: string
	/** required_spell's name. */
	spell?: string
	/** required_reputation_faction's name (Faction.dbc). */
	faction?: string
	/** set_id's set (ItemSet.dbc, #355), with its members' names and its bonuses' texts. */
	set?: TooltipSet
}

/** An item set as its tooltip block shows it. */
export interface TooltipSet {
	name: string
	/** The members' names in the client's order; a member without a name has no line but still counts. */
	members: Array<string | undefined>
	/** The bonuses: how many members each needs, and its spell's text. */
	bonuses: Array<{ threshold: number; text: string }>
	/** The required skill's name and rank; no line without a name. */
	skill?: string
	skillRank?: number
}

const GREEN = '#00ff00'
const GOLD = '#ffd200'
const DIM = '#808080'
const GRAY = '#808080'
/** A blank line; a no-break space, so it keeps its height. */
const BLANK = ' '

/** inventory_type's slot names (INVTYPE_*); 24 to 27 have none in the 1.12 client, so a gun shows only its type. */
const SLOTS: Record<number, string> = {
	1: 'Head',
	2: 'Neck',
	3: 'Shoulder',
	4: 'Shirt',
	5: 'Chest',
	6: 'Waist',
	7: 'Legs',
	8: 'Feet',
	9: 'Wrist',
	10: 'Hands',
	11: 'Finger',
	12: 'Trinket',
	13: 'One-Hand',
	14: 'Off Hand',
	15: 'Ranged',
	16: 'Back',
	17: 'Two-Hand',
	19: 'Tabard',
	20: 'Chest',
	21: 'Main Hand',
	22: 'Off Hand',
	23: 'Held In Off-hand',
	28: 'Relic',
}

/** The subclass names the tooltip's type cell shows (ItemSubClass.dbc's display names), by class. */
const TYPES: Record<number, Record<number, string>> = {
	1: { 0: 'Bag', 1: 'Soul Bag', 2: 'Herb Bag', 3: 'Enchanting Bag', 4: 'Engineering Bag' },
	2: {
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
		11: 'Exotic',
		12: 'Exotic',
		13: 'Fist Weapon',
		14: 'Miscellaneous',
		15: 'Dagger',
		16: 'Thrown',
		17: 'Spear',
		18: 'Crossbow',
		19: 'Wand',
		20: 'Fishing Pole',
	},
	4: { 1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate', 5: 'Buckler', 6: 'Shield', 7: 'Libram', 8: 'Idol', 9: 'Totem' },
	6: { 2: 'Arrow', 3: 'Bullet' },
	11: { 2: 'Quiver', 3: 'Ammo Pouch' },
}

/** stat_type values (ITEM_MOD_*) of 1.12, and the order the client lists them in. */
const STATS: Record<number, string> = { 0: 'Mana', 1: 'Health', 3: 'Agility', 4: 'Strength', 5: 'Intellect', 6: 'Spirit', 7: 'Stamina' }
const STAT_ORDER = [4, 3, 7, 5, 6, 1, 0]

const SCHOOLS = ['', 'Holy', 'Fire', 'Nature', 'Frost', 'Shadow', 'Arcane']

/** The resistance columns by school (1 Holy … 6 Arcane). */
const RESISTANCES = ['', 'holy_res', 'fire_res', 'nature_res', 'frost_res', 'shadow_res', 'arcane_res']
/** The client lists Arcane first and never Holy alone. */
const RESIST_ORDER = [6, 2, 3, 4, 5]

/** The playable classes and races by their bit in allowable_class and allowable_race. */
const CLASSES: Array<[number, string]> = [
	[1, 'Warrior'],
	[2, 'Paladin'],
	[3, 'Hunter'],
	[4, 'Rogue'],
	[5, 'Priest'],
	[7, 'Shaman'],
	[8, 'Mage'],
	[9, 'Warlock'],
	[11, 'Druid'],
]
const RACES: Array<[number, string]> = [
	[1, 'Human'],
	[2, 'Orc'],
	[3, 'Dwarf'],
	[4, 'Night Elf'],
	[5, 'Undead'],
	[6, 'Tauren'],
	[7, 'Gnome'],
	[8, 'Troll'],
]

/** Reputation ranks, for "Requires <faction> - <rank>". */
export const REP_RANKS = ['Hated', 'Hostile', 'Unfriendly', 'Neutral', 'Friendly', 'Honored', 'Revered', 'Exalted']

/** Copper as the game writes money: "1g 2s 3c", leaving out the empty coins. */
export function money(copper: number): string {
	const g = Math.floor(copper / 10000)
	const s = Math.floor(copper / 100) % 100
	const c = copper % 100
	const parts = [g ? `${g}g` : '', s ? `${s}s` : '', c || (!g && !s) ? `${c}c` : '']
	return parts.filter(Boolean).join(' ')
}

/** The client's biased rounding of damage bounds: 38.7 - 85.7 reads "38 - 86", and 3.000001 stays 3. */
const BIAS = 0.99999
const floorMin = (m: number) => Math.trunc(m > 0 ? m : m - BIAS)
const ceilMax = (m: number) => Math.trunc(m > 0 ? m + BIAS : m)

/** "+5" or "-5", the sign the client's %c fills in. */
const signed = (v: number) => `${v > 0 ? '+' : '-'}${Math.abs(v)}`

/** The names of the mask's bits, or null when it has every one (or none, or is -1: every one), which shows no line. */
function allowed(mask: number, list: Array<[number, string]>): string | null {
	if (mask === 0 || mask === -1) return null
	const all = list.reduce((m, [id]) => m | (1 << (id - 1)), 0)
	if ((mask & all) === all) return null
	const names = list.filter(([id]) => mask & (1 << (id - 1))).map(([, n]) => n)
	return names.length ? names.join(', ') : null
}

/** The tooltip of an item_template row (column → value), with the names its numbers stand for. */
export function tooltipLines(row: Record<string, string>, known: TooltipNames = {}): TooltipLine[] {
	const spells = known.spells ?? {}
	const n = (col: string) => {
		const v = Number(row[col])
		return Number.isFinite(v) ? v : 0
	}
	const out: TooltipLine[] = []
	const quality = n('quality')
	const flags = n('flags')
	out.push({ left: row.name || `Item ${row.entry ?? ''}`.trim(), color: QUALITY_COLORS[quality] ?? QUALITY_COLORS[1], title: true })
	if (flags & 0x2000) out.push({ left: '<Right Click for Details>', color: GREEN })
	if (flags & 0x2) out.push({ left: 'Conjured Item' })
	const bonding = n('bonding')
	const bind = bonding === 4 || bonding === 5 ? 'Quest Item' : ['', 'Binds when picked up', 'Binds when equipped', 'Binds when used'][bonding]
	if (bind) out.push({ left: bind })
	const unique = n('max_count')
	if (unique === 1) out.push({ left: 'Unique' })
	else if (unique > 1) out.push({ left: `Unique (${unique})` })
	if (n('start_quest') > 0) out.push({ left: 'This Item Begins a Quest' })

	const cls = n('class')
	const sub = n('subclass')
	const inv = n('inventory_type')
	const typeName = TYPES[cls]?.[sub]
	if (inv === 18) {
		// A bag's line says its slots and kind ("16 Slot Bag"); a kind without a name has no line.
		if (typeName) out.push({ left: `${n('container_slots')} Slot ${typeName}` })
	} else {
		const slot = cls === 6 ? 'Projectile' : SLOTS[inv]
		const type = inv === 16 || cls === 1 || cls === 11 ? undefined : typeName
		if (slot && type) out.push({ left: slot, right: type })
		else if (slot || type) out.push({ left: (slot || type)! })
	}

	const delay = n('delay')
	let first = true
	let dps = 0
	for (let i = 1; i <= 5; i++) {
		const min = n(`dmg_min${i}`)
		const max = n(`dmg_max${i}`)
		const lo = floorMin(min)
		const hi = ceilMax(max)
		if (lo === 0 && hi === 0) continue
		const school = SCHOOLS[n(`dmg_type${i}`)] ?? ''
		let text: string
		if (cls === 6) text = `Adds ${(lo + hi) / 2}${school ? ` ${school}` : ''} damage per second`
		else if (school) text = `${lo} - ${hi} ${school} Damage`
		else if (lo === hi) text = `${lo} Damage`
		else text = `${lo} - ${hi} Damage`
		if (!first) text = `+ ${text}`
		const speed = first && cls === 2 ? `Speed ${(delay / 1000).toFixed(2)}` : undefined
		out.push({ left: text, right: speed })
		dps += (min + max) / 2
		first = false
	}
	if (!first && cls === 2 && delay > 0) out.push({ left: `(${(dps / (delay / 1000)).toFixed(1)} damage per second)` })
	if (n('armor') > 0) out.push({ left: `${n('armor')} Armor` })
	if (n('block') > 0) out.push({ left: `${n('block')} Block` })
	for (const want of STAT_ORDER) {
		for (let i = 1; i <= 10; i++) {
			const v = n(`stat_value${i}`)
			if (n(`stat_type${i}`) === want && v !== 0) out.push({ left: `${signed(v)} ${STATS[want]}` })
		}
	}
	const res = RESISTANCES.map((col) => (col ? n(col) : 0))
	if (res[1] !== 0 && res.slice(1).every((r) => r === res[1])) out.push({ left: `${signed(res[1])} to All Resistances` })
	else for (const s of RESIST_ORDER) if (res[s] !== 0) out.push({ left: `${signed(res[s])} ${SCHOOLS[s]} Resistance` })
	if (n('random_property') > 0 && !(flags & 0x2000)) out.push({ left: '<Random enchantment>', color: GREEN })

	const durability = n('max_durability')
	if (durability > 0) out.push({ left: `Durability ${durability} / ${durability}` })
	const classes = allowed(n('allowable_class'), CLASSES)
	if (classes) out.push({ left: `Classes: ${classes}` })
	const races = allowed(n('allowable_race'), RACES)
	if (races) out.push({ left: `Races: ${races}` })
	const level = n('required_level')
	if (level > 1) out.push({ left: `Requires Level ${level}` })
	if (n('required_skill') > 0 && known.skill) {
		const rank = n('required_skill_rank')
		out.push({ left: rank > 0 ? `Requires ${known.skill} (${rank})` : `Requires ${known.skill}` })
	}
	if (n('required_spell') > 0 && known.spell) out.push({ left: `Requires ${known.spell}` })
	if (n('required_reputation_faction') > 0 && known.faction) out.push({ left: `Requires ${known.faction} - ${REP_RANKS[n('required_reputation_rank')] ?? 'Hated'}` })
	for (let i = 1; i <= 5; i++) {
		const spell = n(`spellid_${i}`)
		if (spell <= 0) continue
		const t = n(`spelltrigger_${i}`)
		const trigger = t === 0 || t === 5 ? 'Use:' : t === 1 ? 'Equip:' : t === 2 ? 'Chance on hit:' : ''
		if (trigger) out.push({ left: `${trigger} ${spells[spell] ?? `spell ${spell}`}`, color: GREEN })
	}
	const charges = n('spellcharges_1')
	if (charges > 0) out.push({ left: `${charges} ${charges === 1 ? 'Charge' : 'Charges'}` })
	// The set block, as the client's: a blank line, the gold "name (worn/total)", the set's skill, each
	// member indented two spaces, a blank line, then the bonuses by count. Nothing is worn in an editor,
	// so the members and the bonuses are gray and every bonus shows its count (ITEM_SET_BONUS_GRAY).
	const set = n('set_id') > 0 ? known.set : undefined
	if (set) {
		out.push({ left: BLANK, color: GOLD })
		out.push({ left: `${set.name} (0/${set.members.length})`, color: GOLD })
		if (set.skill) out.push({ left: set.skillRank ? `Requires ${set.skill} (${set.skillRank})` : `Requires ${set.skill}` })
		for (const m of set.members) if (m) out.push({ left: `  ${m}`, color: GRAY })
		out.push({ left: BLANK, color: GOLD })
		for (const b of [...set.bonuses].sort((a, b) => a.threshold - b.threshold)) out.push({ left: `(${b.threshold}) Set: ${b.text}`, color: GRAY })
	}
	if (row.description) out.push({ left: `"${row.description}"`, color: GOLD })
	if (flags & 0x4 && !n('lock_id')) out.push({ left: '<Right Click to Open>', color: GREEN })
	else if (n('page_text') > 0) out.push({ left: '<Right Click to Read>', color: GREEN })

	const item = n('item_level')
	if (item > 0) out.push({ left: `Item Level ${item}`, color: DIM, extra: true })
	const sell = n('sell_price')
	if (sell > 0) out.push({ left: 'Sell Price:', money: sell, extra: true })
	return out
}
