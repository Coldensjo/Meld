import { WindowFullscreen, WindowIsFullscreen, WindowUnfullscreen } from '../../../wailsjs/runtime/runtime'
import { hasBackend } from '../io/backend'
// Display settings that live outside the renderer's per-frame state (#24): full screen, and whether
// the WebGL context is made with anti-aliasing, which only a new context can change.

/** Where Graphics › Anti-aliasing is mirrored, so the next start reads it before the prefs load. */
const ANTIALIAS_KEY = 'meld.antialias'

/** Whether the renderer is made with anti-aliasing (on unless the author turned it off). */
export function antialiasAtStart(): boolean {
	try {
		return localStorage.getItem(ANTIALIAS_KEY) !== 'off'
	} catch {
		return true
	}
}

/** Keeps Graphics › Anti-aliasing for the next start. */
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
		if (await WindowIsFullscreen()) WindowUnfullscreen()
		else WindowFullscreen()
		return
	}
	if (document.fullscreenElement) await document.exitFullscreen()
	else await document.documentElement.requestFullscreen()
}
