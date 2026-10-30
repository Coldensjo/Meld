// The parts of the Wails runtime the page uses, shaped as v2's wailsjs/runtime had them (#854).
import { Browser, Clipboard, Events, Window } from '@wailsio/runtime'

/** Calls fn with the data of each event `name` sent from Go (App.emit); returns a function that stops listening. */
export function EventsOn<T = unknown>(name: string, fn: (data: T) => void): () => void {
	return Events.On(name, (e) => fn(e.data as T))
}

export function WindowSetTitle(title: string): Promise<void> {
	return Window.SetTitle(title)
}

/** Closes this page's window (a tool window's own close button, #909). */
export function WindowClose(): Promise<void> {
	return Window.Close()
}

export function WindowIsFullscreen(): Promise<boolean> {
	return Window.IsFullscreen()
}

export function WindowFullscreen(): Promise<void> {
	return Window.Fullscreen()
}

export function WindowUnfullscreen(): Promise<void> {
	return Window.UnFullscreen()
}

export function BrowserOpenURL(url: string): Promise<void> {
	return Browser.OpenURL(url)
}

/** Whether Go runs as the browser page (make dev-page, Wails' server mode), whose clipboard calls do nothing. */
export const serverMode = () => (globalThis as { __meldServerMode?: boolean }).__meldServerMode === true

// On the browser page the clipboard is the browser's. A write it refuses (no focus or permission, as in the
// probes' headless Chrome) is kept here, and the next read gives it back.
let pageText: string | null = null

export async function ClipboardGetText(): Promise<string> {
	if (!serverMode()) return Clipboard.Text()
	if (pageText !== null) return pageText
	return navigator.clipboard.readText()
}

export async function ClipboardSetText(text: string): Promise<void> {
	if (!serverMode()) return Clipboard.SetText(text)
	try {
		await navigator.clipboard.writeText(text)
		pageText = null
	} catch {
		pageText = text
	}
}

/** Hands an event to the page's own listeners (EventsOn) as if Go had sent it; Go doesn't see it. */
export function EventsEmit(name: string, data?: unknown) {
	const w = window as Window & { _wails?: { dispatchWailsEvent?: (e: { name: string; data: unknown }) => void } }
	w._wails?.dispatchWailsEvent?.({ name, data: data ?? null })
}

/**
 * Sends an event through Go to every window's listeners (EventsOn), this page's too: how the main page and the
 * tool windows talk (lib/toolwin/channel.ts, #909). Send plain objects; unregistered event data arrives as JSON.
 */
export function EventsBroadcast(name: string, data?: unknown): Promise<unknown> {
	return Events.Emit(name, data ?? null)
}

// The probes and the browser console reach these as window.runtime, where v2's runtime put them: a probe
// fakes a Go event with window.runtime.EventsEmit (compile-spawns.js) and reads the clipboard back.
if (typeof window !== 'undefined') Object.assign(window, { runtime: { EventsEmit, ClipboardGetText, ClipboardSetText } })
