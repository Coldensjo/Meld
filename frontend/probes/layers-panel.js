// The Layers panel follows the hovered chunk, the selected area and History without polling (#585).
// touches: frontend/src/components/LayersPanel.svelte, frontend/src/lib/terrain/layers.ts
const e = P.e
const { editor } = await P.state()
e.newDocument(128, 'island', 3, 'Layers')
await P.frames(5)
e.regenerateAutoPaint()
await P.frames(3)
const rows = () => document.querySelectorAll('[data-ui="LayersPanel"] .row:not(.empty)').length
const text = () => document.querySelector('[data-ui="LayersPanel"]')?.textContent ?? ''
const settle = async () => {
	await P.frames(3)
	await new Promise((r) => setTimeout(r, 50))
}
editor.selection = null
editor.hoverChunk = -1
await settle()
const hint = text().includes('Move the cursor')
editor.hoverChunk = 8 * 16 + 8
await settle()
const hovered = rows()
editor.selection = { x0: 20, z0: 8, x1: 44, z1: 24 }
await settle()
const selected = text().includes('chunks selected')
const selRows = rows()
const del = document.querySelector('[data-ui="LayersPanel"] .del')
del?.click()
await settle()
const afterDelete = rows()
e.history.undo()
await settle()
const afterUndo = rows()
editor.selection = null
await settle()
const back = rows()
return {
	ok: hint && hovered > 0 && selected && selRows > 0 && afterDelete < selRows && afterUndo === selRows && back === hovered,
	hint,
	hovered,
	selected,
	selRows,
	afterDelete,
	afterUndo,
	back,
}
