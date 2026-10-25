// The menu bar and the right-click menu work from the keyboard (#370): focus on the first item when a menu opens, arrows between items and menus, Escape back to the title, and no map hotkey fires meanwhile.
// touches: frontend/src/components/MenuBar.svelte, frontend/src/components/ContextMenu.svelte, frontend/src/lib/ui/menuKeys.ts
// tier: smoke
const { ui, editor } = await P.state()
const press = (key, init = {}) => {
	const target = document.activeElement ?? document.body
	const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
	target.dispatchEvent(ev)
	return ev
}
const titleOf = (name) => [...document.querySelectorAll('.menubar .menu > .title')].find((b) => b.textContent.trim() === name)
const active = () => document.activeElement
const activeLabel = () => active()?.querySelector?.('.label')?.textContent.trim() ?? null
const items = () => [...document.querySelectorAll('.menubar .dropdown [role^="menuitem"]:not(:disabled)')]
const r = {}
editor.tool = 'select'

// Roles and state.
const file = titleOf('File')
r.menubar = !!document.querySelector('.menubar .menus[role="menubar"]')
r.haspopup = file.getAttribute('aria-haspopup') === 'menu'
r.collapsed = file.getAttribute('aria-expanded') === 'false'

// A click on a title opens its menu on the first item.
file.click()
await P.until(() => items().length > 0 && items()[0] === active(), 5000, 'focus on the first File item')
r.clickFocusesFirst = true
r.expanded = file.getAttribute('aria-expanded') === 'true'

// Down moves on, Up from the first wraps to the last, Home and End.
const list = items()
press('ArrowDown')
r.downMoves = active() === list[1]
press('Home')
r.home = active() === list[0]
press('ArrowUp')
r.upWraps = active() === list[list.length - 1]
press('End')
r.end = active() === list[list.length - 1]

// A tool letter or Delete pressed in the menu doesn't reach the map.
const tool = editor.tool
press('b')
r.hotkeyStopped = editor.tool === tool

// Right goes to the next menu (Edit) on its first item; Left comes back.
press('ArrowRight')
await P.frames(2)
const edit = titleOf('Edit')
r.rightOpensNext = edit.getAttribute('aria-expanded') === 'true' && items()[0] === active()
press('ArrowLeft')
await P.frames(2)
r.leftComesBack = file.getAttribute('aria-expanded') === 'true' && items()[0] === active()

// Escape closes the menu and focuses its title.
press('Escape')
await P.frames(2)
r.escapeCloses = !document.querySelector('.menubar .dropdown')
r.escapeToTitle = active() === file
r.collapsedAgain = file.getAttribute('aria-expanded') === 'false'

// From the title: Down opens on the first item, Up on the last, Right moves to the next title closed.
press('ArrowDown')
await P.until(() => items()[0] === active(), 5000, 'Down on the title')
r.downOnTitle = true
press('Escape')
await P.frames(2)
press('ArrowUp')
await P.until(() => items().length > 0 && items()[items().length - 1] === active(), 5000, 'Up on the title')
r.upOnTitle = true
press('Escape')
await P.frames(2)
press('Enter')
await P.until(() => items()[0] === active(), 5000, 'Enter on the title')
r.enterOnTitle = true
press('Escape')
await P.frames(2)
press('ArrowRight')
r.rightOnTitle = active() === edit && !document.querySelector('.menubar .dropdown')

// Tab closes the menu (the browser moves on from the title; a synthetic Tab doesn't move the focus).
press('Enter')
await P.until(() => items()[0] === active(), 5000, 'Enter on Edit')
press('Tab')
await P.frames(2)
r.tabCloses = !document.querySelector('.menubar .dropdown') && active() === edit
edit.blur()

// The right-click menu takes the focus, steps over its separator and disabled item, and Escape gives the focus back.
const opener = document.createElement('button')
opener.textContent = 'opener'
document.body.append(opener)
opener.focus()
let ran = ''
ui.contextMenu = {
	x: 200,
	y: 200,
	title: 'Probe',
	items: [
		{ label: 'One', run: () => (ran = 'one') },
		{ separator: true, label: '' },
		{ label: 'Off', disabled: true },
		{ label: 'Two', run: () => (ran = 'two') },
	],
}
await P.until(() => activeLabel() === 'One', 5000, 'focus on the context menu')
r.ctxFocusesFirst = true
press('ArrowDown')
r.ctxSkips = activeLabel() === 'Two'
press('ArrowDown')
r.ctxWraps = activeLabel() === 'One'
press('b')
r.ctxHotkeyStopped = editor.tool === tool
press('Escape')
await P.frames(2)
r.ctxEscapeCloses = ui.contextMenu === null
r.ctxFocusBack = active() === opener
// A pick with Enter (a click on the focused button) runs the item.
ui.contextMenu = {
	x: 200,
	y: 200,
	items: [
		{ label: 'One', run: () => (ran = 'one') },
		{ label: 'Two', run: () => (ran = 'two') },
	],
}
await P.until(() => activeLabel() === 'One', 5000, 'focus on the second context menu')
press('End')
active().click()
await P.frames(2)
r.ctxPickRuns = ran === 'two' && ui.contextMenu === null
opener.remove()

// The control: with the menus closed, the same key does reach the map.
document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true }))
r.hotkeyWorksAfter = editor.tool === 'paint'
editor.tool = tool

const ok = Object.values(r).every((v) => v === true)
return { ok, r }
