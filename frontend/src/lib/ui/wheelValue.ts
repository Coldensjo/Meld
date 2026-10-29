// Wheel over a slider (#847): scrolling the wheel while the pointer is over a range input steps its
// value one `step` a notch (up on scroll up), without a click first. One document-level listener
// serves every slider in the app, so a new one needs nothing. The change goes through the input's own
// events (a pointerdown for an `onstart`, then input and change), so each slider's undo commit runs
// as for a drag, one step a notch.

/** The range input under the wheel event, when it takes the wheel. */
function rangeUnder(e: WheelEvent): HTMLInputElement | null {
	const t = e.target
	if (!(t instanceof HTMLInputElement) || t.type !== 'range' || t.disabled) return null
	return t
}

function onWheel(e: WheelEvent) {
	// Ctrl+wheel is the browser's zoom; a sideways or empty wheel moves nothing.
	if (e.ctrlKey || e.defaultPrevented || e.deltaY === 0) return
	const input = rangeUnder(e)
	if (!input) return
	e.preventDefault()
	const before = input.value
	if (e.deltaY < 0) input.stepUp()
	else input.stepDown()
	if (input.value === before) return
	input.dispatchEvent(new Event('pointerdown'))
	input.dispatchEvent(new Event('input', { bubbles: true }))
	input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Starts the document's wheel handling for sliders; returns the stop function. */
export function startWheelValue(): () => void {
	document.addEventListener('wheel', onWheel, { passive: false })
	return () => document.removeEventListener('wheel', onWheel)
}
