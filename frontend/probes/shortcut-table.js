// The shortcut table (#583) in the live app: tool keys from the toolbar (K, 0), G and Ctrl+A run the table's commands, every menu's shortcut text is a table row's, Edit › Undo shows the same "Undo: …" status as Ctrl+Z, and Help › Keyboard Shortcuts lists every row.
// touches: frontend/src/App.svelte, frontend/src/components/MenuBar.svelte, frontend/src/components/AppDialogs.svelte, frontend/src/lib/ui/commands.ts, frontend/src/lib/ui/runCommand.ts
// tier: smoke
const e = P.e
const { ui, editor } = await P.state()
const cmds = await P.app('/src/lib/ui/commands.ts')
const sel = await P.app('/src/lib/state/selection.ts')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(2)
const r = {}
const press = (key, init = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))

// Tool keys and the late and early commands.
press('k')
r.kPaths = editor.tool === 'path'
press('0')
r.zeroStamp = editor.tool === 'stamp'
const grid = editor.grid
press('g')
r.gGrid = editor.grid === !grid
press('g')
editor.tool = 'sculpt'
await P.frames(2)
press('a', { ctrlKey: true })
r.ctrlASelects = editor.tool === 'select' && !!editor.selection
e.deselect()

// Every menu's shortcut text is one of the table's.
const known = new Set(cmds.SHORTCUTS.map((s) => cmds.keysOf(s.id)))
const titles = [...document.querySelectorAll('.menubar .menu > .title')]
const shown = []
for (const t of titles) {
	t.click()
	await P.frames(2)
	for (const sc of document.querySelectorAll('.menubar .dropdown .sc')) shown.push(sc.textContent.trim())
	press('Escape')
	await P.frames(2)
}
const unknown = shown.filter((s) => !known.has(s))
r.menuShortcuts = shown.length > 20 && unknown.length === 0

// Edit › Undo runs the same command as Ctrl+Z, with its status.
const o = e.objects.add({ type: 'helper:cube', x: 100, z: 100, yOff: 0, rotY: 0, scale: 1 })
sel.selectObjects(e.objects, [o.id])
e.deleteSelected()
await P.frames(2)
ui.status = 'Ready'
titles.find((t) => t.textContent.trim() === 'Edit').click()
await P.frames(2)
const undo = [...document.querySelectorAll('.menubar .dropdown [role^="menuitem"]')].find((b) => b.querySelector('.label')?.textContent.trim() === 'Undo')
undo?.click()
await P.frames(2)
r.menuUndoStatus = ui.status.startsWith('Undo:') && e.objects.list().some((x) => x.id === o.id)
if (document.querySelector('.menubar .dropdown')) press('Escape')

// The Shortcuts dialog lists every row.
ui.dialog = 'shortcuts'
await P.frames(3)
const rows = document.querySelectorAll('[role="dialog"] tbody tr').length
ui.dialog = null
r.dialogRows = rows === cmds.SHORTCUTS.length
await P.frames(2)
return { ok: Object.values(r).every((v) => v === true), r, unknown, rows, table: cmds.SHORTCUTS.length }
