// A dialog takes the focus when it opens, keeps Tab inside it, and gives the focus back when it closes (#369).
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

// An editor (own root) takes the focus too, and gives it back.
ui.questEditor = { entry: 0 }
const ed = await P.until(() => document.querySelector('[role="dialog"][aria-label="Quest editor"]'), 20_000, 'the quest editor')
await P.until(() => ed.contains(document.activeElement), 20_000, 'focus inside the quest editor')
r.editorFocusInside = true
ui.questEditor = null
await P.frames(2)
r.editorClosedFocus = document.activeElement?.tagName

const ok = r.focusInside && r.labelledByHeading && r.controls > 0 && r.tabWraps && r.tabWrapPrevented && r.shiftTabWraps && r.shiftTabWrapPrevented && r.tabPullsBackIn && r.focusReturned && r.menuTitleRefocused && r.editorFocusInside && r.editorClosedFocus === 'BODY'
return { ok, r }
