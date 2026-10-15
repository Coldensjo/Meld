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
}

const EMPTY: BrowserView = { query: '', category: '', zone: '', scroll: 0 }

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
  }
}

/**
 * The stored views with a tab's view changed by patch. The same object comes back when nothing
 * changes, so writing it into the preferences doesn't wake their savers.
 */
export function writeView(views: Record<string, BrowserView>, kind: string, patch: Partial<BrowserView>): Record<string, BrowserView> {
  const old = readView(views, kind)
  const next = { ...old, ...patch }
  if (next.query === old.query && next.category === old.category && next.zone === old.zone && next.scroll === old.scroll && views[kind]) return views
  return { ...views, [kind]: next }
}
