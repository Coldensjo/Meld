// The toolbar, the asset browser's tabs and facets and the tiles tell assistive tech what is selected (#373).
// touches: frontend/src/components/Toolbar.svelte, frontend/src/components/AssetBrowser.svelte, frontend/src/components/PaletteTile.svelte
const { editor } = await P.state()
const e = P.e
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(3)
const bar = document.querySelector('.toolbar')
const pressed = () => [...bar.querySelectorAll('[aria-pressed="true"]')].map((b) => b.getAttribute('aria-label'))
editor.tool = 'sculpt'
await P.frames(3)
const first = pressed()
editor.tool = 'select'
await P.frames(3)
const second = pressed()
const results = {
	oneToolPressed: first.length === 1 && second.length === 1,
	moves: first[0] !== second[0],
	allToolsHaveState: bar.querySelectorAll('button:not([aria-pressed])').length === 0,
}
// A keyboard focus on a tool shows its tip and a blur hides it. A script's focus() is keyboard focus
// (:focus-visible) only in a page whose last input was a key, which the probe cannot fake (a synthetic
// Tab would toggle the panels), so the tip is checked only where the browser says so; else press Tab by hand.
const btn = bar.querySelector('button')
btn.focus()
if (btn.matches(':focus-visible')) {
	await new Promise((r) => setTimeout(r, 500))
	results.tipOnFocus = !!document.querySelector('.tip[role="tooltip"]')
}
btn.blur()
await P.frames(2)
results.tipGoneOnBlur = !document.querySelector('.tip[role="tooltip"]')
const tabs = document.querySelectorAll('.kinds [role="tab"]')
results.assetTabs = tabs.length > 0 && [...tabs].every((t) => t.hasAttribute('aria-selected'))
results.facetsPressed = [...document.querySelectorAll('.facet')].every((f) => f.hasAttribute('aria-pressed'))
const bare = () => [...document.querySelectorAll('[role="listbox"]')].some((l) => l.querySelector('button.tile') && !l.querySelector('[role="option"]'))
// Every browser tab (models, prefabs, the spawn templates) has valid grids: no bare listbox, and its tiles carry aria-pressed.
let bareSeen = bare()
let tilesPressed = true
let gridsSeen = 0
for (const t of tabs) {
	t.click()
	await new Promise((r) => setTimeout(r, 600))
	bareSeen = bareSeen || bare()
	for (const g of document.querySelectorAll('.grid-wrap')) {
		const tiles = g.querySelectorAll('button.tile')
		if (tiles.length) gridsSeen++
		if ([...tiles].some((b) => !b.hasAttribute('aria-pressed'))) tilesPressed = false
	}
}
results.noBareListbox = !bareSeen
results.gridTilesPressed = tilesPressed
return { ok: Object.values(results).every(Boolean), results, gridsSeen, first, second }
