import { Factions, QuestTables, SpawnEmotes, TemplateNames } from '../../../wailsjs/go/main/App'
import type { vmangos } from '../../../wailsjs/go/models'
import { areaName, loadAreas } from './areas'
import { spellRef } from './spells'

// Names for the quest editor's references (#259): what an item, creature, object, quest, spell,
// faction, faction template, skill, zone, quest sort or emote number stands for. The world database's templates are
// asked for in one TemplateNames call per kind and batch, the client's tables read once, and every
// answer kept for the session (forgetName drops one that a save changed).

/** What a reference number can be once its sign is read (see refTarget). */
export type NameKind = 'item' | 'creature' | 'object' | 'quest' | 'spell' | 'faction' | 'faction template' | 'skill' | 'zone' | 'sort' | 'emote'

export interface RefName {
	name: string
	/** An item's quality and display (for its icon). */
	quality?: number
	displayId?: number
	/** A spell's icon path. */
	icon?: string
	/** A creature's lowest level, a quest's level. */
	level?: number
}

type TemplateKind = 'item' | 'creature' | 'object' | 'quest'

/** Go's vmangos.NamedRef, which Wails leaves out of models.ts since only a map's values use it. */
interface NamedRef {
	name: string
	quality: number
	displayId: number
	level: number
}

const cache = new Map<string, Promise<RefName | null>>()
const pending = new Map<TemplateKind, Map<number, (r: RefName | null) => void>>()
let flush = 0

function flushNames() {
	flush = 0
	const asked = new Map(pending)
	pending.clear()
	for (const [kind, ids] of asked) {
		TemplateNames(kind, [...ids.keys()])
			.then((got: Record<number, NamedRef> | null) => {
				for (const [id, done] of ids) {
					const r = got?.[id]
					done(r ? { name: r.name, quality: r.quality, displayId: r.displayId, level: r.level } : null)
				}
			})
			.catch(() => {
				for (const done of ids.values()) done(null)
			})
	}
}

let tables: Promise<vmangos.QuestTables> | null = null
/** The client's quest sorts, skills and reputation factions, read once. */
export function questTables(): Promise<vmangos.QuestTables> {
	if (!tables) {
		tables = QuestTables().then((t) => ({ sorts: t.sorts ?? [], skills: t.skills ?? [], factions: t.factions ?? [] }) as vmangos.QuestTables)
		tables.catch(() => (tables = null))
	}
	return tables
}

let emotes: Promise<vmangos.Emote[]> | null = null
/** The client's emotes by ID, read once. */
export function emoteList(): Promise<vmangos.Emote[]> {
	if (!emotes) {
		emotes = SpawnEmotes().then((e) => e ?? [])
		emotes.catch(() => (emotes = null))
	}
	return emotes
}

let templates: Promise<vmangos.FactionInfo[]> | null = null
/** The client's faction templates (what a creature's or object's `faction` holds), read once. */
export function factionTemplates(): Promise<vmangos.FactionInfo[]> {
	if (!templates) {
		templates = Factions().then((f) => f ?? [])
		templates.catch(() => (templates = null))
	}
	return templates
}

/** How a faction template treats the two sides' players, such as "friendly to Alliance, hostile to Horde" (#699). */
export function reactionText(f: Pick<vmangos.FactionInfo, 'alliance' | 'horde'>): string {
	if (f.alliance === f.horde) return `${f.alliance} to both`
	return `${f.alliance} to Alliance, ${f.horde} to Horde`
}

/** A faction template's name as a picker shows it: its faction's name and how it treats players. */
export function factionTemplateName(f: vmangos.FactionInfo): string {
	return `${f.name || 'Unnamed'} (${reactionText(f)})`
}

/** A client table row's name, or null. */
async function tableName(kind: 'faction' | 'skill' | 'sort', id: number): Promise<RefName | null> {
	const t = await questTables()
	const list = kind === 'faction' ? t.factions : kind === 'skill' ? t.skills : t.sorts
	const row = list.find((r) => r.id === id)
	return row ? { name: row.name } : null
}

/** The name of thing `id` of `kind`, or null when there is no such thing. */
export function refName(kind: NameKind, id: number): Promise<RefName | null> {
	const key = `${kind}:${id}`
	let p = cache.get(key)
	if (p) return p
	switch (kind) {
		case 'item':
		case 'creature':
		case 'object':
		case 'quest': {
			p = new Promise<RefName | null>((done) => {
				let ids = pending.get(kind)
				if (!ids) pending.set(kind, (ids = new Map()))
				ids.set(id, done)
			})
			if (!flush) flush = window.setTimeout(flushNames, 0)
			break
		}
		case 'spell':
			p = spellRef(id).then((s) => (s ? { name: s.rank ? `${s.name} (${s.rank})` : s.name, icon: s.icon } : null))
			break
		case 'zone':
			p = loadAreas().then((list) => (list.some((a) => a.id === id) ? { name: areaName(id) } : null))
			break
		case 'faction template':
			p = factionTemplates().then((list) => {
				const f = list.find((x) => x.id === id)
				return f ? { name: factionTemplateName(f) } : null
			})
			break
		case 'emote':
			p = emoteList().then((list) => {
				const e = list.find((x) => x.id === id)
				return e ? { name: e.name } : null
			})
			break
		default:
			p = tableName(kind, id)
	}
	p = p.catch(() => null)
	cache.set(key, p)
	return p
}

/** Keeps names a search found, so the field shows them without asking again. */
export function rememberName(kind: NameKind, id: number, r: RefName) {
	cache.set(`${kind}:${id}`, Promise.resolve(r))
}

/** Drops a name a save may have changed (a quest's title, a template's name). */
export function forgetName(kind: NameKind, id: number) {
	cache.delete(`${kind}:${id}`)
}

/**
 * What a reference column's value names: a creature for a positive and a game object for a
 * negative ReqCreatureOrGOId, a zone or a quest sort for ZoneOrSort, a quest for either sign of the
 * chain columns. Null for 0.
 */
export function refTarget(ref: string, value: number): { kind: NameKind; id: number } | null {
	if (!value || !Number.isFinite(value)) return null
	const id = Math.abs(value)
	switch (ref) {
		case 'creature or object':
			return { kind: value < 0 ? 'object' : 'creature', id }
		case 'zone or sort':
			return { kind: value < 0 ? 'sort' : 'zone', id }
		case 'quest':
			return { kind: 'quest', id }
	}
	return { kind: ref as NameKind, id: value }
}
