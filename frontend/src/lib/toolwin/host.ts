// The main page's side of the tool windows (#909, channel.ts): opening one as its own OS window,
// publishing its state, and running the commands it sends back.
import { hasBackend } from '../io/backend'
import { prefs } from '../state/editor.svelte'
import { uiZoom } from '../ui/uiScale'
import { CloseToolWindow, OpenToolWindow } from '../wails/App'
import { EventsBroadcast, EventsOn, serverMode } from '../wails/runtime'
import { CLOSED_EVENT, COMMAND_EVENT, REPLY_EVENT, STATE_EVENT, isFor, readCommand, stateMessage, type ToolCommand, type ToolLook } from './channel'

/**
 * Whether tool windows can open as their own OS windows: in the desktop app only. The browser page
 * (make dev-page, server mode) has no native windows, so its tool windows stay in the page, and so do
 * the probes'.
 */
export const nativeToolWindows = () => hasBackend() && !serverMode()

/** Opens the tool window of `kind` as its own OS window; false when it can't, and the page shows its in-page window. */
export async function openToolWindow(kind: string, args: Record<string, string> = {}): Promise<boolean> {
	if (!nativeToolWindows()) return false
	try {
		return await OpenToolWindow(kind, args)
	} catch (err) {
		console.error(`Opening the ${kind} window failed:`, err)
		return false
	}
}

/** Closes the tool window of `kind` if it is open as its own OS window. */
export function closeToolWindow(kind: string) {
	if (nativeToolWindows()) void CloseToolWindow(kind)
}

/** How the main page looks now (App.svelte applies the theme, uiScale.ts the size), for the tool windows to copy. */
export function currentLook(): ToolLook {
	const light = prefs.theme === 'light' || (prefs.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches)
	return { theme: light ? 'light' : 'dark', zoom: uiZoom() }
}

/** Sends the tool window of `kind` its state. Call it when the state changes (throttled), never from the render loop. */
export function publishToolState<S>(kind: string, state: S) {
	void EventsBroadcast(STATE_EVENT, stateMessage(kind, state, currentLook()))
}

/** Answers a request of the tool window of `kind` (a command it waits on, such as a thumbnail to make). */
export function sendToolReply(kind: string, reply: Record<string, unknown>) {
	void EventsBroadcast(REPLY_EVENT, { kind, reply })
}

/** Calls `fn` with each command the tool window of `kind` sends; returns a function that stops listening. */
export function onToolCommand(kind: string, fn: (cmd: ToolCommand) => void): () => void {
	return EventsOn(COMMAND_EVENT, (data) => {
		const cmd = readCommand(data, kind)
		if (cmd) fn(cmd)
	})
}

/** Calls `fn` when the tool window of `kind` closes (its own close button, or closeToolWindow). */
export function onToolWindowClosed(kind: string, fn: () => void): () => void {
	return EventsOn(CLOSED_EVENT, (data) => {
		if (isFor(data, kind)) fn()
	})
}
