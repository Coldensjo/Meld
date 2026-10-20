import { SpellCategories, SpellRefs } from '../../../wailsjs/go/main/App'
import type { vmangos } from '../../../wailsjs/go/models'
import { texturePreview } from './api'

// Client spells for the creature editor's Spells tab (#243): each spell's name, rank, icon and text
// from Spell.dbc, asked for in one binding call per batch, and each icon's image, both kept a session.

const refs = new Map<number, Promise<vmangos.SpellRef | null>>()
const pending = new Map<number, (r: vmangos.SpellRef | null) => void>()
let flush = 0

function flushRefs() {
	flush = 0
	const asked = new Map(pending)
	pending.clear()
	SpellRefs([...asked.keys()])
		.then((got) => {
			for (const [id, done] of asked) done(got?.[id] ?? null)
		})
		.catch(() => {
			for (const done of asked.values()) done(null)
		})
}

/** A spell from the client, or null when the client has no such spell. */
export function spellRef(id: number): Promise<vmangos.SpellRef | null> {
	let p = refs.get(id)
	if (!p) {
		p = new Promise<vmangos.SpellRef | null>((done) => pending.set(id, done))
		if (!flush) flush = window.setTimeout(flushRefs, 0)
		refs.set(id, p)
	}
	return p
}

/** Forgets a spell, after the spell editor (#294) changed it, so it is read again. */
export function forgetSpell(id: number) {
	refs.delete(id)
}

/** Remembers spells a search found, so the list shows them without asking again. */
export function rememberSpells(list: vmangos.SpellRef[]) {
	for (const r of list) if (!refs.has(r.id)) refs.set(r.id, Promise.resolve(r))
}

let categories: Promise<vmangos.SpellCategory[]> | null = null

/** The categories the Spells tab browses spells by (#340), read once a session. */
export function spellCategories(): Promise<vmangos.SpellCategory[]> {
	categories ??= SpellCategories()
		.then((c) => c ?? [])
		.catch((err) => {
			categories = null
			throw err
		})
	return categories
}

/** Spell.dbc's schools by number, for the Spells tab's school filter (#340). */
export const SPELL_SCHOOLS = ['Physical', 'Holy', 'Fire', 'Nature', 'Frost', 'Shadow', 'Arcane']

const icons = new Map<string, Promise<string | null>>()

/** An image URL of a spell icon (a texture path without .blp), or null when it can't be read. */
export function spellIcon(path: string): Promise<string | null> {
	let p = icons.get(path)
	if (!p) {
		p = texturePreview(`${path}.blp`, 36).catch(() => null)
		icons.set(path, p)
	}
	return p
}

/** Forgets the images of the icons named `names` (under Interface\Icons), after they were added or drawn again (#364). */
export function forgetSpellIcons(names: string[]) {
	const drop = new Set(names.map((n) => `interface\\icons\\${n}`.toLowerCase()))
	for (const key of [...icons.keys()]) if (drop.has(key.toLowerCase())) icons.delete(key)
}
