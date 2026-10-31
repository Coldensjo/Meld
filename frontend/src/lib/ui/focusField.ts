// A template editor opened on a column (File › Check Map's Edit, #951): scroll to the column's field,
// which TemplateFields marks with `data-col`, focus its input and flash it. The tab it is on may still
// be rendering, so it looks again for a few frames.

/** Scrolls to column `col`'s field, focuses it and flashes it; gives up after `tries` frames without it. */
export function focusField(col: string, tries = 30) {
	const cell = document.querySelector(`[data-col="${CSS.escape(col)}"]`)
	const el = cell?.firstElementChild
	if (!(el instanceof HTMLElement)) {
		if (tries > 0) requestAnimationFrame(() => focusField(col, tries - 1))
		return
	}
	el.scrollIntoView({ block: 'center' })
	el.querySelector<HTMLElement>('input, select, textarea, button')?.focus({ preventScroll: true })
	el.classList.add('field-flash')
	setTimeout(() => el.classList.remove('field-flash'), 1600)
}
