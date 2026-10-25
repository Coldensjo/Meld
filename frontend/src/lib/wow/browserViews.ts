// Where each tab of the asset browser was: its search, zone, category and scroll, kept in the
// preferences (prefs.browserViews, keyed by the tab's kind) so a tab change or a restart finds it
// as it was left (#123).

/** One tab's place in the asset browser. */
export interface BrowserView {
	query: string
	category: string
	zone: string
	/** The grid's scroll position in px. */
	scroll: number
	/** The creature tabs' order (#659): the database's ('') or by level, lowest or highest first. */
	sort: BrowserSort
}

export type BrowserSort = '' | 'level' | 'level-desc'

const EMPTY: BrowserView = { query: '', category: '', zone: '', scroll: 0, sort: '' }

/** A tab's view from the stored views, every field checked, since the config file may hold anything. */
export function readView(views: unknown, kind: string): BrowserView {
	const v = views && typeof views === 'object' && !Array.isArray(views) ? (views as Record<string, unknown>)[kind] : undefined
	if (!v || typeof v !== 'object') return EMPTY
	const r = v as Record<string, unknown>
	const str = (x: unknown) => (typeof x === 'string' ? x : '')
	return {
		query: str(r.query),
		category: str(r.category),
		zone: str(r.zone),
		scroll: typeof r.scroll === 'number' && Number.isFinite(r.scroll) && r.scroll > 0 ? r.scroll : 0,
		sort: r.sort === 'level' || r.sort === 'level-desc' ? r.sort : '',
	}
}

/**
 * The stored views with a tab's view changed by patch. The same object comes back when nothing
 * changes, so writing it into the preferences doesn't wake their savers.
 */
export function writeView(views: Record<string, BrowserView>, kind: string, patch: Partial<BrowserView>): Record<string, BrowserView> {
	const old = readView(views, kind)
	const next = { ...old, ...patch }
	if (next.query === old.query && next.category === old.category && next.zone === old.zone && next.scroll === old.scroll && next.sort === old.sort && views[kind]) return views
	return { ...views, [kind]: next }
}

/** Orders creatures by level (#659): the lowest level, then the highest, then the name; `desc` puts the highest levels first, the names still A to Z. */
export function byLevel<T extends { levelMin: number; levelMax: number; name: string }>(desc: boolean): (a: T, b: T) => number {
	const d = desc ? -1 : 1
	return (a, b) => d * (a.levelMin - b.levelMin) || d * (a.levelMax - b.levelMax) || a.name.localeCompare(b.name)
}
