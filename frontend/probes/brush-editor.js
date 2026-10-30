// The doodad brush editor on the browser page (#911): with no native windows (server mode) World › Doodad
// Brushes… still covers the page, and its edits go straight into prefs, which the Doodad Brush tool paints
// with: New makes a brush, a click on two model tiles adds them (✓ on each), a typed weight is kept, Esc
// closes it, and Paint with it closes it and picks the Doodad tool. The desktop app opens it as its own OS
// window instead (docs/tests/ui.md, "The doodad brush editor as its own OS window"), which no probe can drive.
// touches: frontend/src/components/DoodadBrushEditor.svelte, frontend/src/components/DoodadBrushWindow.svelte, frontend/src/lib/toolwin/doodadBrushes.ts, frontend/src/lib/tools/doodadBrush.ts
const { ui, prefs, editor } = await P.state()
const was = { brushes: JSON.stringify(prefs.doodadBrushes), brush: prefs.doodadBrush, tool: editor.tool }
const settle = async () => {
	await P.frames(3)
	await new Promise((r) => setTimeout(r, 50))
}
const root = () => document.querySelector('[data-ui~="DoodadBrushEditor"]')
const button = (label) => [...(root()?.querySelectorAll('header button') ?? [])].find((b) => b.textContent.trim() === label)
const report = {}
try {
	ui.brushEditor = true
	await settle()
	report.opened = !!root()
	const before = prefs.doodadBrushes.length
	button('New').click()
	await settle()
	report.made = prefs.doodadBrushes.length === before + 1 && prefs.doodadBrush === prefs.doodadBrushes.at(-1).name
	await P.until(() => root()?.querySelectorAll('.grid-wrap .tile').length >= 2, 30_000, 'two model tiles')
	const tiles = [...root().querySelectorAll('.grid-wrap .tile')].slice(0, 2)
	for (const t of tiles) t.click()
	await settle()
	const brush = () => prefs.doodadBrushes.find((b) => b.name === prefs.doodadBrush)
	report.entries = brush().entries.length
	report.ticked = tiles.filter((t) => t.textContent.includes('✓')).length
	// The first model's weight, typed: the number field next to its slider.
	const num = root().querySelector('.entry .field input.num')
	num.value = '42'
	num.dispatchEvent(new Event('change', { bubbles: true }))
	await settle()
	report.weight = brush().entries[0].weight
	// Esc on the page (not in a field) closes it.
	document.activeElement?.blur()
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
	await settle()
	report.escClosed = !root() && ui.brushEditor === false
	// Paint with it: closes and picks the Doodad tool.
	editor.tool = 'select'
	ui.brushEditor = true
	await settle()
	button('Paint with it').click()
	await settle()
	report.painted = !root() && ui.brushEditor === false && editor.tool === 'doodad'
	report.keysFree = ui.brushEditorWindow === false
} finally {
	ui.brushEditor = false
	prefs.doodadBrushes = JSON.parse(was.brushes)
	prefs.doodadBrush = was.brush
	editor.tool = was.tool
	await settle()
}
return {
	ok: report.opened && report.made && report.entries === 2 && report.ticked === 2 && report.weight === 42 && report.escClosed && report.painted && report.keysFree,
	...report,
}
