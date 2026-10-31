import { ItemIcons, ItemSets, ReadItem, SpellTexts } from '../wails/App'
import { goIntMap, goMap } from '../wails/maps'
import { texturePreview } from './api'
import type { TooltipNames, TooltipSet } from './itemTooltip'
import { refName } from './refNames'

// Items for the Shop tab (#202): each display's inventory icon from the client (ItemDisplayInfo.dbc,
// then Interface\Icons), and each item's item_template row for its tooltip, both read once a session.

/** Each display's icon name, asked for once. */
const icons = new Map<number, Promise<string | null>>()
const pending = new Map<number, (name: string | null) => void>()
let flush = 0

/** The icon names of the displays asked for since the last flush, in one binding call. */
function flushIcons() {
	flush = 0
	const asked = new Map(pending)
	pending.clear()
	ItemIcons([...asked.keys()])
		.then((names) => {
			for (const [id, done] of asked) done(goIntMap(names)[id] ?? null)
		})
		.catch(() => {
			for (const done of asked.values()) done(null)
		})
}

/** An image URL of a display's inventory icon at `px` pixels, or null when the client has none. */
export function itemIcon(displayId: number, px = 36): Promise<string | null> {
	let p = icons.get(displayId)
	if (!p) {
		p = new Promise<string | null>((done) => pending.set(displayId, done))
		if (!flush) flush = window.setTimeout(flushIcons, 0)
		icons.set(displayId, p)
	}
	return p.then((n) => (n ? iconImage(n, px) : null))
}

const named = new Map<string, Promise<string | null>>()

/** An image URL of the icon named `name` (under Interface\Icons) at `px` pixels, or null when the client has none. */
export function iconImage(name: string, px = 36): Promise<string | null> {
	const key = `${name.toLowerCase()}|${px}`
	let p = named.get(key)
	if (!p) {
		p = texturePreview(`Interface\\Icons\\${name}.blp`, px, px > 40).catch(() => null)
		named.set(key, p)
	}
	return p
}

/** Forgets the images of the icons named `names`, after they were added or drawn again (#364). */
export function forgetIconImages(names: string[]) {
	const drop = new Set(names.map((n) => n.toLowerCase()))
	for (const key of [...named.keys()]) if (drop.has(key.slice(0, key.lastIndexOf('|')))) named.delete(key)
}

/** Forgets every display's icon, after the client's displays changed (a display was added). */
export function forgetItemIcons() {
	icons.clear()
}

const rows = new Map<number, Promise<Record<string, string>>>()

/** An item template's row, every column by name. */
export function itemRow(entry: number): Promise<Record<string, string>> {
	let p = rows.get(entry)
	if (!p) {
		p = ReadItem(entry).then(goMap)
		p.catch(() => rows.delete(entry))
		rows.set(entry, p)
	}
	return p
}

/** Drops an item's row, after the item editor saved it, so its next tooltip reads it again. */
export function forgetItemRow(entry: number) {
	rows.delete(entry)
}

/** The descriptions of an item row's effect spells by spell ID (Spell.dbc, #217); {} when the client can't say. */
export async function itemSpellTexts(row: Record<string, string>): Promise<Record<number, string>> {
	const ids: number[] = []
	for (let i = 1; i <= 5; i++) {
		const id = Number(row[`spellid_${i}`])
		if (id > 0) ids.push(id)
	}
	if (!ids.length) return {}
	return goIntMap((await SpellTexts(ids).catch(() => null)) ?? {})
}

const sets = new Map<number, Promise<TooltipSet | undefined>>()

/** Item set `id` (ItemSet.dbc) with its members' names and its bonuses' texts, read once a session (#355); undefined when the client has none. */
export function itemSet(id: number): Promise<TooltipSet | undefined> {
	let p = sets.get(id)
	if (!p) {
		p = (async () => {
			const [set] = (await ItemSets([id]).catch(() => null)) ?? []
			if (!set) return undefined
			const spells = set.bonuses.map((b) => b.spell)
			const [members, texts, skill] = await Promise.all([
				Promise.all(set.items.map(async (item) => (await refName('item', item))?.name ?? undefined)),
				spells.length ? SpellTexts(spells).catch(() => null) : null,
				set.requiredSkill > 0 ? refName('skill', set.requiredSkill) : null,
			])
			return {
				name: set.name,
				members,
				bonuses: set.bonuses.map((b) => ({ threshold: b.threshold, text: (texts ? goIntMap(texts)[b.spell] : undefined) ?? `spell ${b.spell}` })),
				skill: skill?.name ?? undefined,
				skillRank: set.requiredSkillRank,
			}
		})()
		sets.set(id, p)
	}
	return p
}

/** The names an item row's tooltip shows: its effects' texts, the skill, spell and faction it requires, and its set. */
export async function itemTooltipNames(row: Record<string, string>): Promise<TooltipNames> {
	const name = async (kind: 'skill' | 'spell' | 'faction', col: string) => {
		const id = Number(row[col])
		return id > 0 ? ((await refName(kind, id))?.name ?? undefined) : undefined
	}
	const setId = Number(row.set_id)
	const [spells, skill, spell, faction, set] = await Promise.all([
		itemSpellTexts(row),
		name('skill', 'required_skill'),
		name('spell', 'required_spell'),
		name('faction', 'required_reputation_faction'),
		setId > 0 ? itemSet(setId) : undefined,
	])
	return { spells, skill, spell, faction, set }
}
