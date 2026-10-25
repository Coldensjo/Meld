// Brush size and falloff control, after Photoshop's: [ and ] step the size through bands that are
// fine for a small brush and coarse for a big one, Shift+[ ] step the hardness, and Alt+right-drag
// sizes the brush on the spot (sideways for the size, up and down for the falloff).

/** Size bands: up to each `below`, [ and ] move the radius by `step` (world units), on that step's grid. */
const BANDS: Array<{ below: number; step: number }> = [
	{ below: 5, step: 0.5 },
	{ below: 20, step: 1 },
	{ below: 50, step: 2.5 },
	{ below: 100, step: 5 },
	{ below: 200, step: 10 },
	{ below: Infinity, step: 25 },
]

function stepAt(r: number): number {
	for (const b of BANDS) if (r < b.below) return b.step
	return BANDS[BANDS.length - 1].step
}

/**
 * The radius one notch bigger (`dir` 1) or smaller (-1) than `r`, within [min, max]. A radius off its
 * band's grid first snaps to the grid in that direction, so a few presses reach round numbers.
 */
export function stepRadius(r: number, dir: 1 | -1, min: number, max: number): number {
	// Going down from a band's lower edge uses the finer band below it (20 → 19, not 20 → 17.5).
	const step = dir > 0 ? stepAt(r) : stepAt(r - 1e-6)
	const n = r / step
	const next = dir > 0 ? Math.floor(n + 1e-6) + 1 : Math.ceil(n - 1e-6) - 1
	return Math.min(max, Math.max(min, Math.round(next * step * 100) / 100))
}

/** The falloff one notch (0.1) harder or softer, in [0, 1]. */
export function stepFalloff(f: number, dir: 1 | -1): number {
	const next = Math.round(f * 10 + 1e-6) + dir
	return Math.min(1, Math.max(0, next / 10))
}

/**
 * The radius a drag of `dx` pixels sideways from `start` gives: it doubles every DRAG_DOUBLE pixels to
 * the right and halves to the left, so the hand moves the same distance for the same feel at any size.
 */
export const DRAG_DOUBLE = 160
export function dragRadius(start: number, dx: number, min: number, max: number): number {
	const r = start * Math.pow(2, dx / DRAG_DOUBLE)
	return Math.min(max, Math.max(min, Math.round(r * 10) / 10))
}

/** The falloff a drag of `dy` pixels (down is positive) from `start` gives: up hardens, down softens, 0.1 per 40 px. */
export function dragFalloff(start: number, dy: number): number {
	const f = start + dy / 400
	return Math.min(1, Math.max(0, Math.round(f * 100) / 100))
}
