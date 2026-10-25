// The Hotkey Manager (#396): a key pressed on a row's "+" rebinds it, and the key handler, View › Show grid's shortcut text, the toolbar's key, the Shortcuts dialog and the camera all follow; a key taken from another command leaves it, and Reset all puts every default back.
// touches: frontend/src/components/HotkeyManager.svelte, frontend/src/lib/ui/commands.ts, frontend/src/lib/engine/CameraController.ts, frontend/src/components/Toolbar.svelte, frontend/src/components/AppDialogs.svelte
// tier: full
const e = P.e
const { ui, editor, prefs } = await P.state()
const cmds = await P.app('/src/lib/ui/commands.ts')
e.newDocument(256, 'flat', 0, 'Probe')
prefs.keymap = {}
await P.frames(2)
const r = {}
const press = (target, key, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
const row = (id) => document.querySelector(`[role="dialog"] tr[data-row="${id}"]`)

ui.dialog = 'hotkeys'
await P.frames(3)
r.opens = !!row('grid') && !!row('camForward')

// Add Ctrl+K to Show grid: the capture button takes the press, the map doesn't see it.
const grid = editor.grid
row('grid').querySelector('.add').click()
await P.frames(2)
const cap = row('grid').querySelector('.capture')
r.captures = !!cap && document.activeElement === cap
press(cap, 'k', { code: 'KeyK', ctrlKey: true })
await P.frames(2)
r.saved = JSON.stringify(prefs.keymap.grid) === JSON.stringify(['g', 'ctrl+k'])
r.mapDidntSee = editor.grid === grid && ui.dialog === 'hotkeys'

// Move the Sculpt tool from 2 to L, through its first key's chip.
row('tool:sculpt').querySelector('.chip .key').click()
await P.frames(2)
press(row('tool:sculpt').querySelector('.capture'), 'l', { code: 'KeyL' })
await P.frames(2)
r.toolChip = row('tool:sculpt').querySelector('.chip .key')?.textContent.trim() === 'L'

// A camera key taken from a command: I leaves the Inspector.
row('camForward').querySelector('.chip .key').click()
await P.frames(2)
press(row('camForward').querySelector('.capture'), 'i', { code: 'KeyI' })
await P.frames(2)
r.cameraKeys = cmds.CAMERA_KEYS.camForward.join() === 'KeyI'
r.inspectorLeft = cmds.keysOf('inspector') === '' && /moved here/.test(document.querySelector('[role="dialog"] .note')?.textContent ?? '')

// A reserved key is refused.
row('grid').querySelector('.add').click()
await P.frames(2)
press(row('grid').querySelector('.capture'), 'Delete', { code: 'Delete' })
await P.frames(2)
r.refused = !prefs.keymap.grid.includes('delete') && !!row('grid').querySelector('.capture')
press(row('grid').querySelector('.capture'), 'Escape', { code: 'Escape' })
await P.frames(2)
r.escCancels = !row('grid').querySelector('.capture') && ui.dialog === 'hotkeys'
ui.dialog = null
await P.frames(2)

// The key handler, the menu, the toolbar and the Shortcuts dialog follow.
press(window, 'k', { code: 'KeyK', ctrlKey: true })
r.ctrlKRuns = editor.grid === !grid
press(window, 'k', { code: 'KeyK', ctrlKey: true })
editor.tool = 'select'
press(window, 'l', { code: 'KeyL' })
r.lPicksSculpt = editor.tool === 'sculpt'
press(window, '2', { code: 'Digit2' })
await P.frames(2)
r.twoFreed = editor.tool === 'sculpt'
const view = [...document.querySelectorAll('.menubar .menu > .title')].find((t) => t.textContent.trim() === 'View')
view.click()
await P.frames(2)
const item = [...document.querySelectorAll('.menubar .dropdown [role^="menuitem"]')].find((b) => b.querySelector('.label')?.textContent.trim() === 'Show grid')
r.menuLabel = item?.querySelector('.sc')?.textContent.trim() === 'G / Ctrl+K'
press(document.activeElement ?? window, 'Escape')
await P.frames(2)
const sculptBtn = document.querySelector('.toolbar button[aria-label="Sculpt Terrain"] .key')
r.toolbarKey = sculptBtn?.textContent.trim() === 'L'
ui.dialog = 'shortcuts'
await P.frames(3)
const gridRow = [...document.querySelectorAll('[role="dialog"] tbody tr')].find((tr) => tr.textContent.includes('Toggle grid'))
r.shortcutsDialog = gridRow?.querySelector('kbd')?.textContent.trim() === 'G / Ctrl+K'

// The camera flies on I now, and no longer on W.
ui.dialog = null
await P.frames(2)
const hold = async (code, key) => {
	const before = e.camera.position.clone()
	window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }))
	await P.frames(10)
	window.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true }))
	await P.frames(2)
	return e.camera.position.distanceTo(before)
}
r.flyOnI = (await hold('KeyI', 'i')) > 0.01
r.notOnW = (await hold('KeyW', 'w')) < 1e-6

// Reset all.
ui.dialog = 'hotkeys'
await P.frames(3)
;[...document.querySelectorAll('[role="dialog"] footer button')].find((b) => b.textContent.trim() === 'Reset all').click()
await P.frames(2)
r.resetAll = Object.keys(prefs.keymap).length === 0 && cmds.CAMERA_KEYS.camForward.join() === 'KeyW' && cmds.keysOf('grid') === 'G' && cmds.keysOf('tool:sculpt') === '2'
ui.dialog = null
prefs.keymap = {}
await P.frames(2)
return { ok: Object.values(r).every((v) => v === true), r }
