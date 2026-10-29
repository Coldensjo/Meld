// Right-clicking a tile of the Creatures, NPCs or Objects tab offers Edit, which opens the creature or game object editor on the template (#848); the model tabs have none. Needs the world database.
// touches: frontend/src/components/SpawnBrowser.svelte, frontend/src/lib/ui/copyId.ts
await P.frames(3)
const { prefs, ui } = await P.state()
const was = { collapsed: prefs.browserCollapsed }
prefs.browserCollapsed = false
const root = () => document.querySelector('[data-ui="AssetBrowser"]')
const tab = (name) => [...root().querySelectorAll('.tab')].find((b) => b.textContent.trim() === name)
const r = {}
for (const [name, label, field] of [
	['Creatures', 'Edit creature…', 'creatureEditor'],
	['NPCs', 'Edit creature…', 'creatureEditor'],
	['Objects', 'Edit game object…', 'objectEditor'],
]) {
	tab(name).click()
	await P.until(() => root().querySelector('.tile, [data-ui="PaletteTile"]'), 30_000, `${name} tiles`)
	await P.frames(2)
	const hit = root().querySelector('[data-ui="PaletteTile"]')
	const before = JSON.stringify(ui.placing ?? null)
	hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 160 }))
	await P.frames(1)
	const items = ui.contextMenu?.items.map((i) => i.label) ?? []
	const edit = ui.contextMenu?.items.find((i) => i.label === label)
	edit?.run()
	await P.frames(1)
	r[name] = { first: items[0], hasEdit: !!edit, copy: items.some((l) => l?.startsWith('Copy')), key: ui[field]?.key, entry: ui[field]?.entry > 0, untouched: before === JSON.stringify(ui.placing ?? null) }
	ui.creatureEditor = null
	ui.objectEditor = null
	ui.contextMenu = null
}
prefs.browserCollapsed = was.collapsed
const ok = Object.values(r).every((x) => x.first && x.hasEdit && x.copy && x.key === null && x.entry && x.untouched)
return { ok, ...r }
