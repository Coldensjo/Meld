// Preferences › Interface size (#372): the whole UI scaled by CSS `zoom` on the root element, since
// every size in the app is in px and the Wails window has no page zoom of its own.
//
// Under the standardized `zoom` (Chromium 128+, the spec): pointer coordinates (`clientX`) and
// `getBoundingClientRect` stay in the window's own px, while `left`, `top`, `width`, `offsetWidth`,
// `clientWidth` and `scrollTop` are in the zoomed page's CSS px, `zoom` times smaller. So code that
// turns a pointer position or a rect into a CSS position or size goes through `toCss`, and a ratio
// of two rects or two pointer positions needs nothing. The 3D canvas multiplies its pixel ratio by
// the zoom (Engine.applyPrefs) so it stays sharp.

/** The sizes Preferences offers, as factors. */
export const UI_SCALES = [1, 1.25, 1.5, 1.75, 2] as const
export const UI_SCALE_MIN = UI_SCALES[0]
export const UI_SCALE_MAX = UI_SCALES[UI_SCALES.length - 1]

let zoom = 1

/** A stored or typed scale kept to the offered range; anything not a number is 1. */
export function clampUiScale(v: unknown): number {
	const n = Number(v)
	if (!Number.isFinite(n) || n <= 0) return 1
	return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, n))
}

/** The next offered size up (`dir` 1) or down (-1) from `v`, kept at the ends. */
export function stepUiScale(v: number, dir: 1 | -1): number {
	const s = clampUiScale(v)
	if (dir > 0) return UI_SCALES.find((x) => x > s + 1e-6) ?? UI_SCALE_MAX
	return [...UI_SCALES].reverse().find((x) => x < s - 1e-6) ?? UI_SCALE_MIN
}

/** Scales the page by `s` (App.svelte, from `prefs.uiScale`). */
export function applyUiScale(s: number) {
	zoom = clampUiScale(s)
	if (typeof document === 'undefined') return
	const root = document.documentElement.style
	root.zoom = zoom === 1 ? '' : String(zoom)
	// app.css's --vw and --vh divide by it, since zoom scales vw and vh as well.
	root.setProperty('--ui-zoom', String(zoom))
}

/** The zoom applied to the page now. */
export function uiZoom(): number {
	return zoom
}

/** A length in window px (a pointer position, a rect's edge, a drag's distance) in the page's CSS px. */
export function toCss(px: number): number {
	return px / zoom
}

/** The window's width and height in the page's CSS px, for keeping a popup inside it. */
export function cssViewport(): { w: number; h: number } {
	return { w: window.innerWidth / zoom, h: window.innerHeight / zoom }
}
