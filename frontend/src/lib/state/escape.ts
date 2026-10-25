import { topDialog } from '../ui/dialogFocus'

// The dialogs and editors each listen for Esc on the window, all on the same target, so neither the
// order they mounted in (#640) nor stopPropagation decides which one acts. The key is claimed once
// instead, and only by the topmost open dialog (#573): a Modal over an editor (the weapon picker over
// the creature editor) takes it and the editor behind it leaves it alone. A WeakSet, since a synthetic
// event isn't cancelable and `defaultPrevented` would not hold.
const taken = new WeakSet<Event>()

/**
 * True for the first caller per event, false for every later one. With `root` (the caller's
 * `use:dialogFocus` element), false too while another dialog is open above it, without claiming the
 * event, so the topmost one still gets it whatever order the listeners run in.
 */
export function takeEscape(e: Event, root?: HTMLElement | null): boolean {
	if (taken.has(e)) return false
	if (root) {
		const top = topDialog()
		if (top && top !== root) return false
	}
	taken.add(e)
	return true
}

/**
 * Esc in a field (an input, a select, a text area) leaves the field rather than closing what it is
 * in: blurs it and returns true. The editors call it after `takeEscape`, before acting on the key.
 */
export function leaveField(e: KeyboardEvent): boolean {
	const el = e.target as HTMLElement | null
	if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA')) return false
	e.preventDefault()
	el.blur()
	return true
}
