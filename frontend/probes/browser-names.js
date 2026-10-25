// The tile-size slider, Names and the fold button sit at the asset browser header's right end: with room (the dock hidden) over the preview column, its left edge within a few px of it, on every tab; in the narrower browser beside the dock the header shrinks instead and they stay in view. Names off hides the details under the asset preview as well as the tiles' names (#655).
// touches: frontend/src/components/AssetBrowser.svelte, frontend/src/components/AssetPreview.svelte
await P.frames(3)
const { prefs } = await P.state()
const was = { kind: prefs.browserKind, collapsed: prefs.browserCollapsed, names: prefs.browserNames, dock: prefs.dockHidden }
prefs.browserCollapsed = false
prefs.browserNames = true
const root = () => document.querySelector('[data-ui="AssetBrowser"]')
const report = {}
let ok = true
for (const dockHidden of [true, false]) {
	prefs.dockHidden = dockHidden
	for (const name of ['Doodads', 'Creatures', 'Prefabs']) {
		;[...root().querySelectorAll('.tab')].find((b) => b.textContent.trim() === name).click()
		await P.frames(3)
		const browser = root().getBoundingClientRect()
		const opts = root().querySelector('header .view-opts').getBoundingClientRect()
		const side = root().querySelector('.side').getBoundingClientRect()
		const chev = root().querySelector('header .chev').getBoundingClientRect()
		const r = { optsLeft: Math.round(opts.left), sideLeft: Math.round(side.left), chevRight: Math.round(chev.right), browserRight: Math.round(browser.right) }
		r.inView = r.chevRight <= r.browserRight && !!root().querySelector('header .view-opts .size') && !!root().querySelector('header .view-opts .names')
		r.ok = r.inView && (!dockHidden || Math.abs(r.optsLeft - r.sideLeft) <= 4)
		ok &&= r.ok
		report[`${name}${dockHidden ? '' : ' beside the dock'}`] = r
	}
}
// Hover the first Doodads tile so the preview has details, then turn Names off.
;[...root().querySelectorAll('.tab')].find((b) => b.textContent.trim() === 'Doodads').click()
await P.until(() => root().querySelector('.grid .tile'), 30_000, 'a Doodads tile')
root()
	.querySelector('.grid .tile')
	.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
await P.frames(3)
const detailsOn = !!root().querySelector('.side .details')
prefs.browserNames = false
await P.frames(3)
const detailsOff = !root().querySelector('.side .details')
prefs.browserNames = was.names
prefs.dockHidden = was.dock
prefs.browserKind = was.kind
prefs.browserCollapsed = was.collapsed
return { ok: ok && detailsOn && detailsOff, detailsOn, detailsOff, tabs: report }
