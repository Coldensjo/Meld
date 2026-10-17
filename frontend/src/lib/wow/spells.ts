import { SpellRefs } from '../../../wailsjs/go/main/App'
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

/** Remembers spells a search found, so the list shows them without asking again. */
export function rememberSpells(list: vmangos.SpellRef[]) {
	for (const r of list) if (!refs.has(r.id)) refs.set(r.id, Promise.resolve(r))
}

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
