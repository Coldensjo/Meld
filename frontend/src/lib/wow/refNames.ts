import { EquipmentDisplays, Factions, ItemTables, ObjectTables, QuestTables, SpawnEmotes, SpellTables, SpellsWithVisual, TemplateNames, WorldRefNames } from '../../../wailsjs/go/main/App'
import type { vmangos } from '../../../wailsjs/go/models'
import { areaName, loadAreas } from './areas'
import { lockText } from './locks'
import { spellRef } from './spells'

// Names for the quest editor's references (#259): what an item, creature, object, quest, spell,
// faction, faction template, skill, zone, quest sort or emote number stands for. The world database's templates are
// asked for in one TemplateNames call per kind and batch, the client's tables read once, and every
// answer kept for the session (forgetName drops one that a save changed).

/** What a reference number can be once its sign is read (see refTarget). */
export type NameKind = 'item' | 'creature' | 'object' | 'quest' | 'spell' | 'faction' | 'faction template' | 'skill' | 'zone' | 'sort' | 'emote' | 'mail template' | ObjectTableKind | ItemTableKind | SpellTableKind | WorldKind

/** The client tables a game object's data columns name (#702), read once (objectTables); a lock type is also an Open lock effect's misc value (#703). */
export type ObjectTableKind = 'lock' | 'lock type' | 'language' | 'page material' | 'spell focus' | 'cinematic' | 'taxi path' | 'auction house'

/**
 * What the spell editor's columns name besides those (#703): a global cooldown category, an icon and an item enchantment (#709)
 * (SpellTables, read once), and a visual, named by the spells that use it (SpellsWithVisual).
 */
export type SpellTableKind = 'global category' | 'spell icon' | 'spell visual' | 'item enchantment'

/** The client tables the item editor's columns name (#701), read once (itemTables). */
export type ItemTableKind = 'item set' | 'spell category' | 'map'

/**
 * The world database rows a game object's data columns (#702), an item's random enchantment and
 * disenchant columns (#701) and the creature editor's lists and its Messages tab's ids (#700) name,
 * named by WorldRefNames; and the quest editor's start and end scripts and exclusive groups (#704).
 */
export type WorldKind =
	| 'gossip'
	| 'page'
	| 'text'
	| 'event'
	| 'loot'
	| 'enchantment'
	| 'disenchant'
	| 'vendor'
	| 'trainer'
	| 'equipment'
	| 'creature loot'
	| 'pickpocket loot'
	| 'skinning loot'
	| 'spell list'
	| 'gossip script'
	| 'map point'
	| 'condition'
	| 'quest start script'
	| 'quest end script'
	| 'exclusive group'

export const WORLD_KINDS: readonly WorldKind[] = [
	'gossip',
	'page',
	'text',
	'event',
	'loot',
	'enchantment',
	'disenchant',
	'vendor',
	'trainer',
	'equipment',
	'creature loot',
	'pickpocket loot',
	'skinning loot',
	'spell list',
	'gossip script',
	'map point',
	'condition',
	'quest start script',
	'quest end script',
	'exclusive group',
]

/** Whether kind is a world database kind (WorldRefNames, SearchWorldRefs). */
export const isWorldKind = (kind: string): kind is WorldKind => (WORLD_KINDS as readonly string[]).includes(kind)

/** The world kinds found by number only: their names are counts, not words. */
export const NUMBER_ONLY_KINDS: readonly WorldKind[] = ['event', 'loot']
export const ITEM_TABLE_KINDS: readonly ItemTableKind[] = ['item set', 'spell category', 'map']
export const OBJECT_TABLE_KINDS: readonly ObjectTableKind[] = ['lock', 'lock type', 'language', 'page material', 'spell focus', 'cinematic', 'taxi path', 'auction house']

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
const pending = new Map<TemplateKind | WorldKind, Map<number, (r: RefName | null) => void>>()
let flush = 0

function flushNames() {
	flush = 0
	const asked = new Map(pending)
	pending.clear()
	for (const [kind, ids] of asked) {
		if (isWorldKind(kind)) {
			WorldRefNames(kind, [...ids.keys()])
				.then((got: Record<number, string> | null) => {
					for (const [id, done] of ids) done(got?.[id] !== undefined ? { name: got[id] } : null)
				})
				.catch(() => {
					for (const done of ids.values()) done(null)
				})
			continue
		}
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
/** The client's quest sorts, skills, reputation factions and mail templates, read once. */
export function questTables(): Promise<vmangos.QuestTables> {
	if (!tables) {
		tables = QuestTables().then((t) => ({ sorts: t.sorts ?? [], skills: t.skills ?? [], factions: t.factions ?? [], mailTemplates: t.mailTemplates ?? [] }) as vmangos.QuestTables)
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

let objTables: Promise<vmangos.ObjectTables> | null = null
/** The client's tables a game object's data columns name (locks, languages, flight paths…), read once. */
export function objectTables(): Promise<vmangos.ObjectTables> {
	if (!objTables) {
		objTables = ObjectTables().then(
			(t) =>
				({
					locks: t.locks ?? [],
					lockTypes: t.lockTypes ?? [],
					languages: t.languages ?? [],
					pageMaterials: t.pageMaterials ?? [],
					spellFocus: t.spellFocus ?? [],
					cinematics: t.cinematics ?? [],
					taxiPaths: t.taxiPaths ?? [],
					auctionHouses: t.auctionHouses ?? [],
				}) as vmangos.ObjectTables,
		)
		objTables.catch(() => (objTables = null))
	}
	return objTables
}

/** The list of an object table kind other than a lock. */
export function objectTableList(t: vmangos.ObjectTables, kind: Exclude<ObjectTableKind, 'lock'>): vmangos.NamedID[] {
	switch (kind) {
		case 'lock type':
			return t.lockTypes
		case 'language':
			return t.languages
		case 'page material':
			return t.pageMaterials
		case 'spell focus':
			return t.spellFocus
		case 'cinematic':
			return t.cinematics
		case 'taxi path':
			return t.taxiPaths
		case 'auction house':
			return t.auctionHouses
	}
}

let itmTables: Promise<vmangos.ItemTables> | null = null
/** The client's tables the item editor's columns name (item sets, cooldown categories, maps), read once. */
export function itemTables(): Promise<vmangos.ItemTables> {
	if (!itmTables) {
		itmTables = ItemTables().then((t) => ({ sets: t.sets ?? [], spellCategories: t.spellCategories ?? [], maps: t.maps ?? [] }) as vmangos.ItemTables)
		itmTables.catch(() => (itmTables = null))
	}
	return itmTables
}

/** The list of an item table kind. */
export function itemTableList(t: vmangos.ItemTables, kind: ItemTableKind): vmangos.NamedID[] {
	return kind === 'item set' ? t.sets : kind === 'spell category' ? t.spellCategories : t.maps
}

let splTables: Promise<vmangos.SpellTables> | null = null
/** The client's spell tables (cast times, ranges… and the global cooldown categories and icons), read once. */
export function spellTables(): Promise<vmangos.SpellTables> {
	if (!splTables) {
		splTables = SpellTables().then((t) => ({ ...t, globalCategories: t.globalCategories ?? [], icons: t.icons ?? [], enchantments: t.enchantments ?? [] }) as vmangos.SpellTables)
		splTables.catch(() => (splTables = null))
	}
	return splTables
}

/** Drops the spell tables read, after a save changed the client's Spell.dbc or SpellIcon.dbc. */
export function forgetSpellTables() {
	splTables = null
}

/** An icon's name as a picker shows it: its texture's file name. */
export const iconFileName = (path: string) => path.replace(/^.*\\/, '')

/** A visual's name: the names of the spells that use it, "no spell uses it" for none. */
export async function visualName(id: number): Promise<RefName> {
	const users = [...new Set(((await SpellsWithVisual(id)) ?? []).map((s) => s.name))]
	return { name: users.length ? users.join(', ') : 'no spell uses it' }
}

/** A lock's text with its keys' names asked of the world database. */
export async function lockName(lock: vmangos.LockInfo, lockTypes: vmangos.NamedID[]): Promise<string> {
	const keys = (lock.parts ?? []).filter((p) => p.type === 1).map((p) => p.index)
	const names = new Map<number, string>()
	await Promise.all(
		keys.map(async (id) => {
			const r = await refName('item', id)
			if (r) names.set(id, r.name)
		}),
	)
	return lockText(lock, lockTypes, (id) => names.get(id) ?? null)
}

/** A client table row's name, or null. */
async function tableName(kind: QuestTableKind, id: number): Promise<RefName | null> {
	const row = questTableList(await questTables(), kind).find((r) => r.id === id)
	return row ? { name: row.name } : null
}

/** The quest editor's client tables: quest sorts, skills, reputation factions and mail templates (#704). */
export type QuestTableKind = 'faction' | 'skill' | 'sort' | 'mail template'

/** The list of a quest table kind. */
export function questTableList(t: vmangos.QuestTables, kind: QuestTableKind): vmangos.NamedID[] {
	return kind === 'faction' ? t.factions : kind === 'skill' ? t.skills : kind === 'mail template' ? t.mailTemplates : t.sorts
}

/** The name of thing `id` of `kind`, or null when there is no such thing. */
export function refName(kind: NameKind, id: number): Promise<RefName | null> {
	const key = `${kind}:${id}`
	let p = cache.get(key)
	if (p) return p
	if (kind === 'item' || kind === 'creature' || kind === 'object' || kind === 'quest' || isWorldKind(kind)) {
		p = new Promise<RefName | null>((done) => {
			let ids = pending.get(kind)
			if (!ids) pending.set(kind, (ids = new Map()))
			ids.set(id, done)
		})
		if (!flush) flush = window.setTimeout(flushNames, 0)
		p = p.catch(() => null)
		cache.set(key, p)
		return p
	}
	switch (kind) {
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
		case 'lock':
			p = objectTables().then(async (t) => {
				const l = t.locks.find((x) => x.id === id)
				return l ? { name: await lockName(l, t.lockTypes) } : null
			})
			break
		case 'lock type':
		case 'language':
		case 'page material':
		case 'spell focus':
		case 'cinematic':
		case 'taxi path':
		case 'auction house':
			p = objectTables().then((t) => {
				const r = objectTableList(t, kind).find((x) => x.id === id)
				return r ? { name: r.name } : null
			})
			break
		case 'item set':
		case 'spell category':
		case 'map':
			p = itemTables().then((t) => {
				const r = itemTableList(t, kind).find((x) => x.id === id)
				return r ? { name: r.name } : null
			})
			break
		case 'global category':
			p = spellTables().then((t) => {
				const r = t.globalCategories.find((x) => x.id === id)
				return r ? { name: r.name } : null
			})
			break
		case 'item enchantment':
			p = spellTables().then((t) => {
				const r = t.enchantments.find((x) => x.id === id)
				return r ? { name: r.name } : null
			})
			break
		case 'spell icon':
			p = spellTables().then((t) => {
				const r = t.icons.find((x) => x.id === id)
				return r ? { name: iconFileName(r.name), icon: r.name } : null
			})
			break
		case 'spell visual':
			p = visualName(id)
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

const gear = new Map<number, Promise<number[]>>()
const gearAsked = new Map<number, (d: number[]) => void>()
let gearFlush = 0

/**
 * The display IDs of the weapons an equipment template holds (main hand, off hand, ranged; 0 for an
 * empty slot), for the pickers' icons (#707). Asks made in the same tick go to the server as one.
 */
export function equipmentDisplays(id: number): Promise<number[]> {
	let p = gear.get(id)
	if (!p) {
		p = new Promise<number[]>((resolve) => gearAsked.set(id, resolve))
		gear.set(id, p)
		if (!gearFlush) {
			gearFlush = window.setTimeout(() => {
				gearFlush = 0
				const asked = new Map(gearAsked)
				gearAsked.clear()
				EquipmentDisplays([...asked.keys()])
					.then((got: Record<number, number[]> | null) => {
						for (const [k, done] of asked) done(got?.[k] ?? [])
					})
					.catch(() => {
						for (const [k, done] of asked) {
							gear.delete(k)
							done([])
						}
					})
			}, 0)
		}
	}
	return p
}
