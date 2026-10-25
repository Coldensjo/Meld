// Keyboard focus for dialogs (#369): `use:dialogFocus` on a dialog's root moves the focus into it when
// it opens, keeps Tab and Shift+Tab inside it while it is the topmost one, and puts the focus back on
// what held it before (or the menu title a menu item opened it from) when it closes.

const FOCUSABLE = ['a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]'].join(',')

/** The open dialogs, the newest last: only the newest one wraps Tab. */
const stack: HTMLElement[] = []

/** Whether a dialog or full-screen editor is open: keys meant for the page behind it should be left alone. */
export function dialogOpen(): boolean {
	return stack.length > 0
}

/** The newest open dialog's root, the one Esc belongs to (`takeEscape`), or null when none is open. */
export function topDialog(): HTMLElement | null {
	return stack.length ? stack[stack.length - 1] : null
}

/** The controls in `node` that Tab reaches, in document order (hidden ones left out). */
export function tabbables(node: HTMLElement): HTMLElement[] {
	return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest('[inert]'))
}

/** Where focus goes back to: the element itself, or for a menu item (removed once the menu closes) its menu's title. */
function returnTarget(el: Element | null): HTMLElement | null {
	if (!(el instanceof HTMLElement) || el === document.body) return null
	const menu = el.closest('[role="menu"]')
	if (menu) {
		const title = menu.previousElementSibling
		return title instanceof HTMLElement ? title : null
	}
	return el
}

export interface DialogFocusOptions {
	/** Where the first focus goes when the dialog doesn't focus a field itself: the first control inside an element matching this selector, before the dialog's first control. */
	prefer?: string
}

export function dialogFocus(node: HTMLElement, options: DialogFocusOptions = {}) {
	const back = returnTarget(document.activeElement)
	stack.push(node)
	if (!node.hasAttribute('tabindex')) node.tabIndex = -1

	// After the dialog's own effects and `autofocus` have run, so a field it focuses itself keeps the focus.
	const timer = setTimeout(() => {
		if (node.contains(document.activeElement)) return
		const area = options.prefer ? node.querySelector<HTMLElement>(options.prefer) : null
		const first = (area && tabbables(area)[0]) || tabbables(node)[0]
		;(first ?? node).focus({ preventScroll: true })
	}, 0)

	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || stack[stack.length - 1] !== node) return
		const list = tabbables(node)
		const active = document.activeElement
		if (list.length === 0) {
			e.preventDefault()
			node.focus()
			return
		}
		const first = list[0]
		const last = list[list.length - 1]
		if (!node.contains(active)) {
			e.preventDefault()
			;(e.shiftKey ? last : first).focus()
		} else if (e.shiftKey && (active === first || active === node)) {
			e.preventDefault()
			last.focus()
		} else if (!e.shiftKey && active === last) {
			e.preventDefault()
			first.focus()
		}
	}
	window.addEventListener('keydown', onKey, true)

	return {
		update(next: DialogFocusOptions = {}) {
			options = next
		},
		destroy() {
			clearTimeout(timer)
			window.removeEventListener('keydown', onKey, true)
			const i = stack.indexOf(node)
			if (i >= 0) stack.splice(i, 1)
			const active = document.activeElement
			// Leave the focus alone if it already moved somewhere outside the dialog (another dialog took it).
			if (active && active !== document.body && !node.contains(active)) return
			if (back?.isConnected) back.focus({ preventScroll: true })
			else if (active instanceof HTMLElement && active !== document.body) active.blur()
		},
	}
}
