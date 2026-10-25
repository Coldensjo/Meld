// Every asset browser tab has the same header search, count and tile-size slider (#651): the box searches the shown tab (a creature name narrows the Creatures tab), Ctrl+F focuses it, the zone select is on the model tabs only and the creature order on Creatures and NPCs, and no tab has a search box of its own.
// touches: frontend/src/components/AssetBrowser.svelte, frontend/src/components/SpawnBrowser.svelte, frontend/src/lib/wow/search.ts
await P.frames(3)
const { prefs } = await P.state()
const was = { kind: prefs.browserKind, collapsed: prefs.browserCollapsed, views: prefs.browserViews }
prefs.browserCollapsed = false
const root = () => document.querySelector('[data-ui="AssetBrowser"]')
const header = () => root().querySelector('header')
const tabs = [...root().querySelectorAll('.tab')].map((b) => b.textContent.trim())
const report = {}
let ok = true
for (const name of tabs) {
	;[...root().querySelectorAll('.tab')].find((b) => b.textContent.trim() === name).click()
	await P.frames(3)
	const h = header()
	const search = h.querySelector('input.search')
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
	await P.frames(1)
	const own = [...root().querySelectorAll('input[type=search], input[type=text]')].filter((i) => !h.contains(i) && !i.classList.contains('setname'))
	const r = {
		search: !!search,
		focused: document.activeElement === search,
		slider: !!h.querySelector('.size input[type=range]'),
		count: !!h.querySelector('.count'),
		zone: !!h.querySelector('select[aria-label=Zone]'),
		sort: !!h.querySelector('select[aria-label=Sort]'),
		ownSearch: own.length,
	}
	const modelTab = !['Creatures', 'NPCs', 'Objects', 'Prefabs'].includes(name)
	r.ok = r.search && r.focused && r.slider && r.count && r.zone === modelTab && r.sort === (name === 'Creatures' || name === 'NPCs') && !r.ownSearch
	ok &&= r.ok
	report[name] = r
	document.activeElement?.blur()
}
// The header's box narrows the Creatures tab (needs the world database).
;[...root().querySelectorAll('.tab')].find((b) => b.textContent.trim() === 'Creatures').click()
const count = () => Number(header().querySelector('.count').textContent.replace(/\D/g, ''))
await P.until(() => count() > 0, 30_000).catch(() => {})
const allCreatures = count()
const search = header().querySelector('input.search')
search.value = 'hogger'
search.dispatchEvent(new Event('input', { bubbles: true }))
await P.frames(3)
const hogger = count()
search.value = ''
search.dispatchEvent(new Event('input', { bubbles: true }))
await P.frames(2)
const searched = allCreatures > 0 && hogger > 0 && hogger < allCreatures
prefs.browserViews = was.views
prefs.browserKind = was.kind
prefs.browserCollapsed = was.collapsed
return { ok: ok && searched, allCreatures, hogger, tabs: report }
