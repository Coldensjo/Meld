import type { Engine } from '../engine/Engine'

/** The single Engine instance, set by Viewport once the canvas exists. */
export const engineRef: { current: Engine | null } = { current: null }

// For poking at the editor from the browser console (wails dev): window.__engine.
if (import.meta.env.DEV) {
	Object.defineProperty(window, '__engine', { get: () => engineRef.current, configurable: true })
}
