import { ItemIcons, ReadItem, SpellTexts } from '../../../wailsjs/go/main/App'
import { texturePreview } from './api'
import type { TooltipNames } from './itemTooltip'
import { refName } from './refNames'

// Items for the Shop tab (#202): each display's inventory icon from the client (ItemDisplayInfo.dbc,
// then Interface\Icons), and each item's item_template row for its tooltip, both read once a session.

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
			for (const [id, done] of asked) done(names?.[id] ?? null)
		})
		.catch(() => {
			for (const done of asked.values()) done(null)
		})
}

/** An image URL of a display's inventory icon, or null when the client has none. */
export function itemIcon(displayId: number): Promise<string | null> {
	let p = icons.get(displayId)
	if (!p) {
		const name = new Promise<string | null>((done) => pending.set(displayId, done))
		if (!flush) flush = window.setTimeout(flushIcons, 0)
		p = name.then((n) => (n ? iconImage(n) : null))
		icons.set(displayId, p)
	}
	return p
}

const named = new Map<string, Promise<string | null>>()

/** An image URL of the icon named `name` (under Interface\Icons), or null when the client has none. */
export function iconImage(name: string): Promise<string | null> {
	const key = name.toLowerCase()
	let p = named.get(key)
	if (!p) {
		p = texturePreview(`Interface\\Icons\\${name}.blp`, 36).catch(() => null)
		named.set(key, p)
	}
	return p
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
		p = ReadItem(entry)
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
	return (await SpellTexts(ids).catch(() => null)) ?? {}
}

/** The names an item row's tooltip shows: its effects' texts, and the skill, spell and faction it requires. */
export async function itemTooltipNames(row: Record<string, string>): Promise<TooltipNames> {
	const name = async (kind: 'skill' | 'spell' | 'faction', col: string) => {
		const id = Number(row[col])
		return id > 0 ? ((await refName(kind, id))?.name ?? undefined) : undefined
	}
	const [spells, skill, spell, faction] = await Promise.all([
		itemSpellTexts(row),
		name('skill', 'required_skill'),
		name('spell', 'required_spell'),
		name('faction', 'required_reputation_faction'),
	])
	return { spells, skill, spell, faction }
}
