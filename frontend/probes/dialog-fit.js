// The scroll-bar rule (#933, #986): the Texture looks and Brush stack dialogs have no list of their own that scrolls; with 18 textures and 10 brushes (more than their old 420 px and 380 px caps held) each fits the probe page (1400x900, 805 px inside) with no scroll bar, the dialog's body included. The database editors' field pages (#1024) fit it too: every tab of the creature editor on Scarlet Commander Mograine (3976) shows no scroll bar but the lists that grow without bound (the display grid, the spell search's results), every tab of the quest editor on Wolves Across the Border (33), its fields in two columns, and every tab of the game object editor on Small Thorium Vein (324), its fields on Object and What it does, and every tab of the item editor on the Worn Shortsword (25), the five effects two rows each, and every tab of the spell editor on Fireball (133), its fields on ten tabs and the short masks ticked in more columns. The Creatures workspace (#1025) fits it on every step of its guide, the factions list filling the page's height instead of its 260 px cap and How it looks showing one picker at a time (Body, Main hand, Off hand, Ranged), its grid filling the height; only the grids and lists that grow without bound scroll. The Inspector (#1026) fits a leader of six followers and a pool of seven with no scroll bar, and thirty kinds of models in one selection scroll the panel itself, not a capped list inside it.
// touches: frontend/src/components/TextureLooksDialog.svelte, frontend/src/components/BrushStackDialog.svelte, frontend/src/components/GroundEffectsDialog.svelte, frontend/src/components/IconImportDialog.svelte, frontend/src/components/Modal.svelte, frontend/src/components/CreatureEditor.svelte, frontend/src/components/SpellsTab.svelte, frontend/src/components/DisplayPicker.svelte, frontend/src/lib/world/creatureFields.ts, frontend/src/components/QuestEditor.svelte, frontend/src/components/EditorFrame.svelte, frontend/src/lib/world/questFields.ts, frontend/src/components/ObjectEditor.svelte, frontend/src/lib/world/objectFields.ts, frontend/src/components/ItemEditor.svelte, frontend/src/lib/world/itemFields.ts, frontend/src/components/SpellEditor.svelte, frontend/src/lib/world/spellFields.ts, frontend/src/components/TemplateFields.svelte, frontend/src/components/CreaturesWorkspace.svelte, frontend/src/components/WeaponPicker.svelte, frontend/src/components/Inspector.svelte, frontend/src/components/PropertiesPanel.svelte, frontend/src/components/PoolFields.svelte, frontend/src/components/FormationFields.svelte
const { editor, prefs, ui } = await P.state()
const { newStackItem } = await P.app('/src/lib/tools/brushStack.ts')
const paletteWas = editor.palette
const stacksWas = prefs.brushStacks
const activeWas = prefs.brushStack
/** The elements under the dialog that scroll now, by class: none is the rule kept. */
const scrolling = (dlg) => [dlg, ...dlg.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)).map((el) => el.className || el.tagName)
const r = { page: [innerWidth, innerHeight] }
/** The lists that grow without bound and keep their scroll bar (docs/architecture/ui.md, "Scroll bars"), and the quest chain's graph (a view that scrolls). */
const LISTS = new Set(['grid-wrap', 'results', 'list tall', 'canvas'])
/** Each tab of a database editor and what scrolls on it but those lists (#1024). */
const editorTabs = async (root) => {
	const out = {}
	for (const b of [...root.querySelectorAll('nav.tabs > button')]) {
		b.click()
		await P.frames(2)
		await new Promise((res) => setTimeout(res, 300))
		const s = scrolling(root).filter(
			(c) =>
				!LISTS.has(
					String(c)
						.replace(/svelte-\w+/g, '')
						.trim(),
				),
		)
		if (s.length) out[b.textContent.trim()] = s
	}
	return out
}
try {
	editor.palette = Array.from({ length: 18 }, (_, i) => `tileset\\probe\\probe texture ${i}.blp`)
	ui.dialog = 'looks'
	const looks = await P.until(() => P.dialog('Texture looks'), 20_000, 'the texture looks dialog')
	await P.frames(2)
	r.looksRows = looks.querySelectorAll('.rows .name').length
	r.looksRowsHeight = Math.round(looks.querySelector('.rows').getBoundingClientRect().height)
	r.looksScrolling = scrolling(looks)
	ui.dialog = null
	await P.frames(1)

	const name = 'Probe stack 986'
	prefs.brushStacks = [...stacksWas, { name, items: Array.from({ length: 10 }, () => newStackItem('sculpt')) }]
	prefs.brushStack = name
	ui.dialog = 'stack'
	const stack = await P.until(() => P.dialog('Brush stack'), 20_000, 'the brush stack dialog')
	await P.frames(2)
	r.stackRowsHeight = Math.round(stack.querySelector('.rows').getBoundingClientRect().height)
	r.stackScrolling = scrolling(stack)
	ui.dialog = null
	await P.frames(1)

	ui.creatureEditor = { key: null, entry: 3976 }
	const creature = await P.until(
		() => document.querySelector('[data-editor="creature"] nav.tabs button') && document.querySelector('[data-editor="creature"] h3') && document.querySelector('[data-editor="creature"]'),
		60_000,
		'the creature editor',
	)
	r.creatureTabs = [...creature.querySelectorAll('nav.tabs > button')].length
	r.creatureScrolling = await editorTabs(creature)
	ui.creatureEditor = null
	await P.frames(1)

	ui.questEditor = { entry: 33 }
	const quest = await P.until(
		() => document.querySelector('[data-editor="quest"] nav.tabs button') && document.querySelector('[data-editor="quest"] .groups h3') && document.querySelector('[data-editor="quest"]'),
		60_000,
		'the quest editor',
	)
	r.questColumns = getComputedStyle(quest.querySelector('.groups')).columnCount
	r.questScrolling = await editorTabs(quest)
	ui.questEditor = null
	await P.frames(1)

	ui.objectEditor = { key: null, entry: 324 }
	const object = await P.until(() => document.querySelector('[data-editor="object"] nav.tabs button') && document.querySelector('[data-editor="object"] h3') && document.querySelector('[data-editor="object"]'), 60_000, 'the object editor')
	r.objectScrolling = await editorTabs(object)
	ui.objectEditor = null
	await P.frames(1)

	ui.itemEditor = { entry: 25 }
	const item = await P.until(() => document.querySelector('[data-editor="item"] nav.tabs button') && document.querySelector('[data-editor="item"] h3') && document.querySelector('[data-editor="item"]'), 60_000, 'the item editor')
	r.itemScrolling = await editorTabs(item)
	ui.itemEditor = null
	await P.frames(1)

	ui.spellEditor = { entry: 133 }
	const spell = await P.until(() => document.querySelector('[data-editor="spell"] nav.tabs button') && document.querySelector('[data-editor="spell"] h3') && document.querySelector('[data-editor="spell"]'), 60_000, 'the spell editor')
	r.spellTabs = spell.querySelectorAll('nav.tabs > button').length
	r.spellTabRows = Math.round(spell.querySelector('nav.tabs').getBoundingClientRect().height / spell.querySelector('nav.tabs > button').getBoundingClientRect().height)
	r.spellScrolling = await editorTabs(spell)
	ui.spellEditor = null
	await P.frames(1)

	// The Creatures workspace (#1025): each step of the guide, and each picker of How it looks.
	ui.creatures = true
	const ws = (await P.until(() => document.querySelector('.ws[aria-label="Creatures"] ol.steps button'), 30_000, 'the creatures workspace')).closest('.ws')
	const wsLists = new Set(['grid-wrap', 'found', 'factions'])
	const wsScrolling = () =>
		scrolling(ws).filter(
			(c) =>
				!wsLists.has(
					String(c)
						.replace(/svelte-\w+/g, '')
						.trim(),
				),
		)
	const nameBox = ws.querySelector('.form input')
	nameBox.value = 'Probe 1025'
	nameBox.dispatchEvent(new Event('input', { bubbles: true }))
	await P.frames(2)
	r.wsScrolling = {}
	const steps = () => [...ws.querySelectorAll('ol.steps button')]
	for (let i = 0; i < 4; i++) {
		steps()[i].click()
		await P.frames(2)
		if (i === 1) {
			await P.until(() => ws.querySelector('.factions input[type=radio]'), 30_000, 'the factions')
			ws.querySelector('.factions input[type=radio]').click()
			await P.frames(2)
			r.factionsHeight = Math.round(ws.querySelector('.factions').getBoundingClientRect().height)
		}
		if (i === 2) {
			r.lookParts = ws.querySelectorAll('.parts button').length
			for (const b of [...ws.querySelectorAll('.parts button')]) {
				b.click()
				await P.frames(2)
				await new Promise((res) => setTimeout(res, 300))
				const s = wsScrolling()
				if (s.length) r.wsScrolling[`${steps()[i].textContent.trim()} ${b.textContent.trim()}`] = s
			}
			continue
		}
		await new Promise((res) => setTimeout(res, 300))
		const s = wsScrolling()
		if (s.length) r.wsScrolling[steps()[i].textContent.trim()] = s
	}

	// The Inspector (#1026): a pool of seven and a leader of six followers fit it; thirty kinds of models scroll the panel, not a list inside it.
	ui.creatures = false
	const e = P.e
	const sel = await P.app('/src/lib/state/selection.ts')
	const se = await P.app('/src/lib/world/spawnEdits.ts')
	e.newDocument(256, 'flat', 0, 'Fit 1026')
	editor.tool = 'select'
	ui.inspector = true
	await P.frames(2)
	const inspector = () => document.querySelector('[data-ui="Inspector"]')
	const settle = async () => {
		await P.frames(3)
		await new Promise((res) => setTimeout(res, 100))
	}
	const L = e.objects
	const objs = Array.from({ length: 30 }, (_, i) => L.add({ type: `helper:cube:${i + 1}`, x: 100 + i * 4, z: 120, yOff: 14, rotY: 0, scale: 1 }))
	sel.selectObjects(
		L,
		objs.map((o) => o.id),
		objs[0].id,
	)
	await settle()
	r.inspector = { thirty: scrolling(inspector()) }
	sel.selectObjects(L, [])
	await settle()
	const look = { model: '', look: '', anim: 0, displayScale: 1 }
	const t = { entry: 38, name: 'Defias Thug', subname: '', levelMin: 5, levelMax: 5, faction: 14, npcFlags: 0, rank: 0, type: 7, display: 0, scale: 1, equipment: 0, model: '', look: '', displayScale: 1 }
	const layer = e.activeDocument().spawnLayer
	// Guids far above the database's, so nothing here could name a real spawn.
	for (const [tag, extra, lead] of [
		['pool', { pool: 78, poolLimit: 1 }, null],
		['lead', null, 9_100_001],
	]) {
		const spawns = Array.from({ length: 7 }, (_, i) =>
			Object.assign(se.newCreatureSpawn(t, 9_100_001 + i, 100, 0, 100 + i * 3, 0, look), extra ?? {}, lead ? { leader: lead, groupFlags: 3, ...(i ? { followDist: 3, followAngle: Math.PI } : {}) } : {}),
		)
		layer.set(spawns)
		se.syncSpawnUi(layer, true)
		se.selectSpawn(layer.get(`${spawns[0].kind}/${spawns[0].guid}`))
		await settle()
		r.inspector[tag] = scrolling(inspector())
		if (!r.inspector[tag].length) r.inspector[tag] = [inspector()?.querySelectorAll('.points li').length === 6 ? 'none' : 'no list']
		sel.selectObjects(L, [])
		await settle()
	}
	layer.set([])
	se.syncSpawnUi(layer, true)
} finally {
	ui.creatures = false
	ui.inspector = false
	ui.spellEditor = null
	ui.itemEditor = null
	ui.creatureEditor = null
	ui.questEditor = null
	ui.objectEditor = null
	ui.dialog = null
	editor.palette = paletteWas
	prefs.brushStacks = stacksWas
	prefs.brushStack = activeWas
	await P.frames(1)
}
return {
	ok:
		r.looksRows === 18 &&
		r.looksRowsHeight > 420 &&
		!r.looksScrolling.length &&
		r.stackRowsHeight > 380 &&
		!r.stackScrolling.length &&
		r.creatureTabs >= 10 &&
		!Object.keys(r.creatureScrolling).length &&
		!Object.keys(r.questScrolling).length &&
		!Object.keys(r.objectScrolling).length &&
		!Object.keys(r.itemScrolling).length &&
		r.spellTabs >= 10 &&
		r.spellTabRows === 1 &&
		!Object.keys(r.spellScrolling).length &&
		r.factionsHeight > 260 &&
		r.lookParts === 4 &&
		!Object.keys(r.wsScrolling).length &&
		r.inspector.pool.every((c) => c === 'none') &&
		r.inspector.lead.every((c) => c === 'none') &&
		r.inspector.thirty.length === 1 &&
		/props/.test(r.inspector.thirty[0]),
	...r,
}
