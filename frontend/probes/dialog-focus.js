// A dialog takes the focus when it opens, keeps Tab inside it, and gives the focus back when it closes (#369); an Esc in its field only leaves the field (#573).
const { ui } = await P.state()
const press = (key, init = {}) => {
	const target = document.activeElement ?? document.body
	const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
	target.dispatchEvent(ev)
	return ev
}
const tabbables = (node) =>
	[...node.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(
		(el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
	)
const r = {}

// Open About from a button outside, as a menu title would be.
const opener = document.createElement('button')
opener.textContent = 'opener'
document.body.append(opener)
opener.focus()
ui.dialog = 'about'
const dlg = await P.until(() => document.querySelector('[role="dialog"]'), 20_000, 'the About dialog')
await P.until(() => dlg.contains(document.activeElement), 20_000, 'focus inside the dialog')
r.focusInside = true
const label = dlg.getAttribute('aria-labelledby')
r.labelledByHeading = !!label && document.getElementById(label)?.tagName === 'H2'

const list = tabbables(dlg)
r.controls = list.length
// Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last.
list[list.length - 1].focus()
r.tabWrapPrevented = press('Tab').defaultPrevented
r.tabWraps = document.activeElement === list[0]
r.shiftTabWrapPrevented = press('Tab', { shiftKey: true }).defaultPrevented
r.shiftTabWraps = document.activeElement === list[list.length - 1]
// Tab with the focus outside the dialog pulls it back in.
opener.focus()
press('Tab')
r.tabPullsBackIn = dlg.contains(document.activeElement)

ui.dialog = null
await P.frames(2)
r.focusReturned = document.activeElement === opener
opener.remove()

// A dialog opened from a menu item gives the focus to the menu's title, since the item is gone.
const title = [...document.querySelectorAll('.menubar .title')].find((b) => b.textContent.trim() === 'Help')
title.click()
const item = await P.until(() => document.querySelector('[role="menu"] [role="menuitem"]'), 20_000, 'the Help menu')
item.focus()
ui.dialog = 'about'
await P.until(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement), 20_000, 'focus in the dialog opened from the menu')
document.querySelector('.menubar .title.open')?.click()
ui.dialog = null
await P.frames(2)
r.menuTitleRefocused = document.activeElement === title
title.blur()

// An Esc in a dialog's field only leaves the field; the next Esc closes the dialog (#573).
ui.dialog = 'about'
const over = await P.until(() => document.querySelector('[role="dialog"][aria-labelledby]'), 20_000, 'About')
await P.until(() => over.contains(document.activeElement), 20_000, 'focus inside About')
const field = document.createElement('input')
over.querySelector('.body').append(field)
field.focus()
press('Escape')
await P.frames(2)
r.escInFieldBlurs = document.activeElement !== field && ui.dialog === 'about'
press('Escape')
await P.frames(2)
r.escCloses = ui.dialog === null
ui.dialog = null
await P.frames(2)

// Keyboard Shortcuts opens and lists the Arrow keys row once; a duplicate key in its keyed each threw (#377).
ui.dialog = 'shortcuts'
const sc = await P.until(() => document.querySelector('[role="dialog"]'), 20_000, 'the shortcuts dialog')
r.arrowRows = [...sc.querySelectorAll('tr, li, div')].filter((el) => el.children.length >= 2 && el.firstElementChild?.textContent.trim().startsWith('Arrow keys')).length
ui.dialog = null
await P.frames(2)

const ok = r.focusInside && r.labelledByHeading && r.controls > 0 && r.tabWraps && r.tabWrapPrevented && r.shiftTabWraps && r.shiftTabWrapPrevented && r.tabPullsBackIn && r.focusReturned && r.menuTitleRefocused && r.escInFieldBlurs && r.escCloses && r.arrowRows === 1
return { ok, r }
