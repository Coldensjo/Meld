// Keyboard moves inside a menu (#370), shared by the menu bar's dropdowns and the right-click menu:
// Up and Down step between the enabled items (separators, headers and disabled items are skipped,
// since they are not buttons or cannot take the focus), wrapping at the ends; Home and End go to the
// first and last.

/** The index the focus moves to for `key` among `count` items from `current` (-1: none focused), or null for a key that doesn't move it. */
export function menuStep(key: string, current: number, count: number): number | null {
	if (count === 0) return null
	switch (key) {
		case 'ArrowDown':
			return current < 0 ? 0 : (current + 1) % count
		case 'ArrowUp':
			return current < 0 ? count - 1 : (current - 1 + count) % count
		case 'Home':
			return 0
		case 'End':
			return count - 1
		default:
			return null
	}
}

/** The menu's items that can take the focus, in order. */
export function menuItems(menu: HTMLElement): HTMLElement[] {
	return Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)'))
}

/** Focuses the first (or last) enabled item of `menu`; false if it has none. */
export function focusMenuEdge(menu: HTMLElement | null | undefined, last = false): boolean {
	if (!menu) return false
	const list = menuItems(menu)
	const el = last ? list[list.length - 1] : list[0]
	el?.focus({ preventScroll: false })
	return !!el
}

/** Moves the focus within `menu` for an arrow, Home or End key; true if the key was one of those. */
export function menuMoveFocus(menu: HTMLElement, key: string): boolean {
	const list = menuItems(menu)
	const i = menuStep(key, list.indexOf(document.activeElement as HTMLElement), list.length)
	if (i === null) return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End'
	list[i].focus()
	return true
}
