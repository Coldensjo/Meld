// The scroll-bar rule (#933, #986): the Texture looks and Brush stack dialogs have no list of their own that scrolls; with 18 textures and 10 brushes (more than their old 420 px and 380 px caps held) each fits the probe page (1400x900, 805 px inside) with no scroll bar, the dialog's body included. The database editors' field pages (#1024) fit it too: every tab of the creature editor on Scarlet Commander Mograine (3976) shows no scroll bar but the lists that grow without bound (the display grid, the spell search's results), every tab of the quest editor on Wolves Across the Border (33), its fields in two columns, and every tab of the game object editor on Small Thorium Vein (324), its fields on Object and What it does.
// touches: frontend/src/components/TextureLooksDialog.svelte, frontend/src/components/BrushStackDialog.svelte, frontend/src/components/GroundEffectsDialog.svelte, frontend/src/components/IconImportDialog.svelte, frontend/src/components/Modal.svelte, frontend/src/components/CreatureEditor.svelte, frontend/src/components/SpellsTab.svelte, frontend/src/components/DisplayPicker.svelte, frontend/src/lib/world/creatureFields.ts, frontend/src/components/QuestEditor.svelte, frontend/src/components/EditorFrame.svelte, frontend/src/lib/world/questFields.ts, frontend/src/components/ObjectEditor.svelte, frontend/src/lib/world/objectFields.ts
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
} finally {
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
		!Object.keys(r.objectScrolling).length,
	...r,
}
