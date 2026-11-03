import { WindowFullscreen, WindowIsFullscreen, WindowUnfullscreen } from '../wails/runtime'
import { hasBackend } from '../io/backend'
import { ui } from '../state/editor.svelte'
// Display settings that live outside the renderer's per-frame state (#24): full screen, and whether
// the WebGL context is made with anti-aliasing, which only a new context can change.

/** Where Preferences › Graphics › Anti-aliasing is mirrored, so the next start reads it before the prefs load. */
const ANTIALIAS_KEY = 'meld.antialias'

/** Whether the renderer is made with anti-aliasing (on unless the author turned it off). */
export function antialiasAtStart(): boolean {
	try {
		return localStorage.getItem(ANTIALIAS_KEY) !== 'off'
	} catch {
		return true
	}
}

/** Keeps Preferences › Graphics › Anti-aliasing for the next start. */
export function rememberAntialias(on: boolean) {
	try {
		localStorage.setItem(ANTIALIAS_KEY, on ? 'on' : 'off')
	} catch {
		// Storage off: the next start keeps its default.
	}
}

/** Puts the window into full screen or takes it out: the desktop window through Wails, the dev page through the browser. */
export async function toggleFullScreen() {
	if (hasBackend()) {
		if (await WindowIsFullscreen()) {
			WindowUnfullscreen()
			ui.fullScreen = false
		} else {
			WindowFullscreen()
			ui.fullScreen = true
		}
		return
	}
	if (document.fullscreenElement) await document.exitFullscreen()
	else await document.documentElement.requestFullscreen()
}

/**
 * Keeps `ui.fullScreen` true while the window is in full screen, however it got there or left (the OS, Esc in the
 * browser): the browser's fullscreenchange event, and on the desktop a re-check on each window resize. Returns the stop function.
 */
export function trackFullScreen(): () => void {
	const fromDocument = () => (ui.fullScreen = !!document.fullscreenElement)
	const fromWindow = () => void WindowIsFullscreen().then((on) => (ui.fullScreen = on))
	document.addEventListener('fullscreenchange', fromDocument)
	if (hasBackend()) {
		window.addEventListener('resize', fromWindow)
		fromWindow()
	} else fromDocument()
	return () => {
		document.removeEventListener('fullscreenchange', fromDocument)
		window.removeEventListener('resize', fromWindow)
	}
}
