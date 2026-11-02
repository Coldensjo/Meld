// The scroll-bar rule (#933, #986): the Texture looks and Brush stack dialogs have no list of their own that scrolls; with 18 textures and 10 brushes (more than their old 420 px and 380 px caps held) each fits the probe page (1400x900, 805 px inside) with no scroll bar, the dialog's body included.
// touches: frontend/src/components/TextureLooksDialog.svelte, frontend/src/components/BrushStackDialog.svelte, frontend/src/components/GroundEffectsDialog.svelte, frontend/src/components/IconImportDialog.svelte, frontend/src/components/Modal.svelte
const { editor, prefs, ui } = await P.state()
const { newStackItem } = await P.app('/src/lib/tools/brushStack.ts')
const paletteWas = editor.palette
const stacksWas = prefs.brushStacks
const activeWas = prefs.brushStack
/** The elements under the dialog that scroll now, by class: none is the rule kept. */
const scrolling = (dlg) => [dlg, ...dlg.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)).map((el) => el.className || el.tagName)
const r = { page: [innerWidth, innerHeight] }
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
} finally {
	ui.dialog = null
	editor.palette = paletteWas
	prefs.brushStacks = stacksWas
	prefs.brushStack = activeWas
	await P.frames(1)
}
return {
	ok: r.looksRows === 18 && r.looksRowsHeight > 420 && !r.looksScrolling.length && r.stackRowsHeight > 380 && !r.stackScrolling.length,
	...r,
}
