// The asset browser's virtualised grid (VirtualGrid, lib/ui/virtualGrid.ts, #578): on the Doodads tab, scrolled down 40 rows, the rendered rows cover the view with at most one row to spare each side and hold no more tiles than those rows; the scroll is kept for the tab (#123), so after Textures and back the grid is at the same place and still covers the view.
// touches: frontend/src/components/VirtualGrid.svelte, frontend/src/lib/ui/virtualGrid.ts, frontend/src/components/AssetBrowser.svelte
await P.frames(3)
const { prefs } = await P.state()
const was = { kind: prefs.browserKind, collapsed: prefs.browserCollapsed }
prefs.browserCollapsed = false
const root = () => document.querySelector('[data-ui="AssetBrowser"]')
const tab = (name) => [...root().querySelectorAll('.tab')].find((b) => b.textContent.trim() === name).click()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Where the rendered block sits against the scroller's view, in px and rows. */
function measure() {
	const scroller = root().querySelector('.grid-wrap')
	const virtual = root().querySelector('[data-ui="VirtualGrid"]')
	const grid = virtual.querySelector('.grid')
	const tiles = grid.querySelectorAll('.tile')
	const view = scroller.getBoundingClientRect()
	const g = grid.getBoundingClientRect()
	const first = tiles[0].getBoundingClientRect()
	const cols = [...tiles].filter((t) => Math.abs(t.getBoundingClientRect().top - first.top) < 1).length
	const rowH = cols < tiles.length ? tiles[cols].getBoundingClientRect().top - first.top : first.height
	const r = {
		scrollTop: Math.round(scroller.scrollTop),
		cols,
		rowH: Math.round(rowH),
		tiles: tiles.length,
		// Rows rendered above the view's top and below its bottom: the window keeps one each side.
		above: Math.round(((view.top - g.top) / rowH) * 10) / 10,
		below: Math.round(((g.bottom - view.bottom) / rowH) * 10) / 10,
		blockHeight: Math.round(virtual.getBoundingClientRect().height),
	}
	const viewRows = Math.ceil(view.height / rowH) + 3
	r.ok =
		g.top <= Math.max(view.top, virtual.getBoundingClientRect().top) + 1 &&
		(g.bottom >= view.bottom - 1 || virtual.getBoundingClientRect().bottom - g.bottom < rowH) &&
		r.above <= 2.05 &&
		r.tiles <= viewRows * cols &&
		r.blockHeight > scroller.clientHeight
	return r
}

tab('Doodads')
await P.until(() => root().querySelector('[data-ui="VirtualGrid"] .tile'), 60_000, 'a Doodads tile')
await P.frames(3)
const scroller = root().querySelector('.grid-wrap')
const top0 = measure()
scroller.scrollTo(0, top0.rowH * 40)
scroller.dispatchEvent(new Event('scroll'))
await P.frames(3)
const scrolled = measure()
// The scroll is kept 300 ms after it stops.
await sleep(800)
tab('Textures')
await P.frames(3)
tab('Doodads')
await P.until(() => root().querySelector('[data-ui="VirtualGrid"] .tile'), 60_000, 'the Doodads tiles again')
await P.frames(5)
const back = measure()
const restored = Math.abs(back.scrollTop - scrolled.scrollTop) <= 1
prefs.browserKind = was.kind
prefs.browserCollapsed = was.collapsed
return { ok: top0.ok && scrolled.ok && back.ok && restored && scrolled.scrollTop > 0, restored, top: top0, scrolled, back }
