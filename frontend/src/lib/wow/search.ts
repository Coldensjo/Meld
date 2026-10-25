import type { CatalogItem } from './catalog'

// Search over the client's models and textures. Every folder segment and file-name word of a path is
// a token, so "elwynn tree" or "orc tent" find things without knowing where the files live, and a
// synonym table maps the words an author would type to the words the client's paths use.

export type AssetKind = 'm2' | 'wmo' | 'tex'

export interface SearchItem extends CatalogItem {
	kind: AssetKind
	/** Lower-case words of the whole path. */
	tokens: string[]
	/** Lower-case words of the file name only (worth more in a match). */
	nameTokens: string[]
	/** All the tokens as one space-separated string, for a quick check that a term is in none of them. */
	text: string
}

/** Words an author types, and the path words that mean the same thing. */
const SYNONYMS: Record<string, string[]> = {
	tree: ['pine', 'oak', 'canopy', 'palm', 'willow', 'bamboo', 'trunk', 'sapling', 'birch', 'spruce', 'fir'],
	bush: ['shrub', 'bushes', 'hedge', 'fern', 'brush'],
	plant: ['flower', 'fern', 'vine', 'reed', 'lily', 'weed', 'mushroom', 'shroom', 'cactus', 'kelp', 'seaweed'],
	rock: ['boulder', 'stone', 'cliff', 'rocks', 'pebble', 'crag', 'stalagmite', 'stalactite'],
	lamp: ['lantern', 'torch', 'sconce', 'candle', 'light', 'brazier', 'lamppost'],
	fire: ['campfire', 'brazier', 'flame', 'bonfire', 'fireplace', 'torch'],
	house: ['inn', 'cottage', 'farm', 'farmhouse', 'hut', 'home', 'building', 'barn', 'shack', 'cabin'],
	fence: ['railing', 'palisade', 'barricade', 'post', 'posts', 'gate'],
	wall: ['walls', 'battlement', 'rampart', 'barrier'],
	grave: ['tomb', 'tombstone', 'headstone', 'coffin', 'crypt', 'graveyard', 'gravestone'],
	bone: ['skull', 'skeleton', 'corpse', 'bones', 'ribcage'],
	crate: ['box', 'boxes', 'chest', 'barrel', 'keg', 'sack', 'basket', 'bag', 'crates'],
	box: ['crate', 'chest', 'crates'],
	barrel: ['keg', 'barrels', 'cask'],
	table: ['desk', 'counter', 'bench', 'workbench'],
	chair: ['stool', 'bench', 'throne', 'seat'],
	bed: ['beds', 'cot', 'bedroll', 'bunk'],
	sign: ['signpost', 'plaque', 'banner', 'marker', 'signs'],
	banner: ['flag', 'standard', 'pennant', 'banners'],
	boat: ['ship', 'canoe', 'raft', 'rowboat', 'boats', 'sailboat'],
	cart: ['wagon', 'carts', 'wheelbarrow', 'caravan'],
	bridge: ['bridges', 'footbridge', 'plank'],
	tower: ['towers', 'watchtower', 'lighthouse', 'spire'],
	ruin: ['ruins', 'rubble', 'debris', 'broken', 'wreck', 'wreckage', 'collapsed'],
	tent: ['tents', 'yurt', 'pavilion', 'canopy'],
	statue: ['statues', 'monument', 'obelisk', 'idol', 'totem'],
	well: ['wells', 'fountain', 'trough'],
	dock: ['docks', 'pier', 'wharf', 'jetty'],
	mine: ['mines', 'minecart', 'ore', 'tunnel', 'shaft'],
	cave: ['caves', 'cavern', 'tunnel', 'grotto'],
	snow: ['snowy', 'ice', 'frost', 'frozen', 'winter', 'icy'],
	sand: ['beach', 'desert', 'dune', 'sandy'],
	grass: ['lawn', 'meadow', 'moss', 'turf', 'grassy'],
	dirt: ['mud', 'soil', 'earth', 'ground', 'muddy'],
	road: ['path', 'cobble', 'cobblestone', 'pave', 'paved', 'brick', 'track'],
	water: ['waterfall', 'pond', 'lake', 'river', 'fountain', 'splash'],
	human: ['stormwind', 'elwynn', 'westfall', 'lordaeron', 'redridge', 'duskwood', 'goldshire'],
	orc: ['orgrimmar', 'durotar', 'horde', 'barrens'],
	elf: ['nightelf', 'darnassus', 'teldrassil', 'ashenvale', 'elven'],
	dwarf: ['ironforge', 'dwarven', 'kharanos', 'dun'],
	gnome: ['gnomer', 'gnomeregan', 'gnomish'],
	undead: ['scourge', 'tirisfal', 'undercity', 'plaguelands', 'forsaken', 'necro'],
	tauren: ['mulgore', 'thunderbluff'],
	troll: ['zul', 'stranglethorn', 'jungle'],
	goblin: ['booty', 'ratchet', 'gadgetzan', 'everlook'],
	weapon: ['sword', 'axe', 'spear', 'mace', 'bow', 'shield', 'dagger', 'weapons'],
	food: ['bread', 'fruit', 'meat', 'fish', 'cheese', 'bowl', 'plate', 'mug', 'cup', 'bottle'],
	effect: ['particle', 'emitter', 'fx', 'glow', 'beam', 'aura', 'sparkle', 'lightshaft'],
	door: ['doors', 'gate', 'portcullis'],
	stairs: ['stair', 'staircase', 'steps', 'ladder'],
	pillar: ['column', 'pillars', 'columns', 'post'],
	book: ['books', 'tome', 'scroll', 'bookshelf', 'shelf'],
	cloth: ['rug', 'carpet', 'tapestry', 'curtain', 'drape'],
	ship: ['boat', 'sailboat', 'wreck', 'shipwreck'],
}

/** Splits a path into lower-case words: on separators, camel-case boundaries and letter-digit boundaries. */
export function tokenize(path: string): string[] {
	return path
		.replace(/\.(m2|wmo|blp)$/i, '')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/([A-Za-z])(\d)/g, '$1 $2')
		.toLowerCase()
		.split(/[\\/_\-. ]+/)
		.filter((t) => t.length > 1 || /\d/.test(t))
}

export function indexCatalog(kind: AssetKind, items: CatalogItem[]): SearchItem[] {
	return items.map((it) => {
		const tokens = tokenize(it.path)
		return { ...it, kind, tokens, nameTokens: tokenize(it.path.slice(it.path.lastIndexOf('\\') + 1)), text: tokens.join(' ') }
	})
}

/** How well one query term matches a token list: exact 3, prefix 2, inside 1, nothing 0. */
function termScore(term: string, tokens: string[]): number {
	let best = 0
	for (const t of tokens) {
		if (t === term) return 3
		if (t.startsWith(term)) best = Math.max(best, 2)
		else if (t.includes(term)) best = Math.max(best, 1)
	}
	return best
}

/** A query term and the synonyms it also accepts (which count a little less). */
function expand(term: string): string[] {
	const out = [term]
	const syn = SYNONYMS[term] ?? SYNONYMS[term.replace(/s$/, '')]
	if (syn) out.push(...syn)
	// Also accept the words whose synonyms include this one ("pine" finds what "tree" finds).
	for (const [k, v] of Object.entries(SYNONYMS)) if (v.includes(term) && !out.includes(k)) out.push(k)
	return out
}

/**
 * Scores an item for the query terms (already lower-cased and split); 0 when any term is missing.
 * File-name words count more than folder words, and synonyms a little less than the word itself.
 */
export function scoreItem(it: SearchItem, terms: string[]): number {
	return scoreExpanded(it, terms.map(expand))
}

/** The best score a term can reach: an exact file-name word. */
const BEST_SCORE = 3 * 1.5

/** scoreItem over terms already expanded with their synonyms, so a search expands each term once, not per item. */
function scoreExpanded(it: SearchItem, expanded: string[][]): number {
	let total = 0
	for (const alts of expanded) {
		let best = 0
		for (let i = 0; i < alts.length; i++) {
			const alt = alts[i]
			// A word in no token at all (the usual case) is settled by one search of the joined tokens.
			if (!it.text.includes(alt)) continue
			const weight = i === 0 ? 1 : 0.7
			const name = termScore(alt, it.nameTokens) * 1.5
			const s = (name === BEST_SCORE ? name : Math.max(name, termScore(alt, it.tokens))) * weight
			if (s > best) best = s
			if (best === BEST_SCORE) break
		}
		if (best === 0) return 0
		total += best
	}
	return total
}

export interface SearchFilter {
	kind: AssetKind | 'all'
	query: string
	category: string
	zone: string
}

export interface SearchResult {
	items: SearchItem[]
	/** Counts over the query's matches (before the category and zone filters), for the facets. */
	categories: Array<{ name: string; count: number }>
	zones: Array<{ name: string; count: number }>
}

/** Orders names as localeCompare does, through one collator instead of one per comparison. */
const byName = new Intl.Collator()

/** Each catalog sorted by name once, for queries with no words, where every item scores the same. */
const sortedByName = new WeakMap<readonly SearchItem[], SearchItem[]>()

function nameOrder(all: readonly SearchItem[]): SearchItem[] {
	let sorted = sortedByName.get(all)
	if (!sorted) {
		sorted = [...all].sort((a, b) => byName.compare(a.name, b.name))
		sortedByName.set(all, sorted)
	}
	return sorted
}

export function searchAssets(all: readonly SearchItem[], f: SearchFilter, categoryOrder: readonly string[]): SearchResult {
	const terms = f.query.toLowerCase().split(/\s+/).filter(Boolean)
	const expanded = terms.map(expand)
	const scored: Array<{ it: SearchItem; s: number }> = []
	// With no words every item scores 1, so the name order is the whole order: take it ready sorted.
	for (const it of terms.length ? all : nameOrder(all)) {
		if (f.kind !== 'all' && it.kind !== f.kind) continue
		const s = terms.length ? scoreExpanded(it, expanded) : 1
		if (s > 0) scored.push({ it, s })
	}
	const catCounts = new Map<string, number>()
	const zoneCounts = new Map<string, number>()
	for (const { it } of scored) {
		if (!f.zone || it.zone === f.zone) catCounts.set(it.category, (catCounts.get(it.category) ?? 0) + 1)
		if (!f.category || it.category === f.category) zoneCounts.set(it.zone, (zoneCounts.get(it.zone) ?? 0) + 1)
	}
	const hits = scored.filter(({ it }) => (!f.category || it.category === f.category) && (!f.zone || it.zone === f.zone))
	if (terms.length) hits.sort((a, b) => b.s - a.s || byName.compare(a.it.name, b.it.name))
	const items = hits.map((x) => x.it)
	const order = new Map(categoryOrder.map((c, i) => [c, i]))
	const categories = [...catCounts].map(([name, count]) => ({ name, count })).sort((a, b) => (order.get(a.name) ?? 999) - (order.get(b.name) ?? 999) || a.name.localeCompare(b.name))
	const zones = [...zoneCounts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
	return { items, categories, zones }
}
