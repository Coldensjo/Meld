// A tool window's side of the channel (#909, channel.ts): the page of a tool window open as its own OS
// window. It runs no Engine and holds no map; it shows the state the main page publishes and sends
// commands back. It must not load or save prefs, nor listen to the main page's events (App.svelte's).
import { applyUiScale } from '../ui/uiScale'
import { EventsBroadcast, EventsOn } from '../wails/runtime'
import { ARGS_EVENT, COMMAND_EVENT, STATE_EVENT, commandMessage, isFor, readState, type StateMessage, type ToolCommand, type ToolLook } from './channel'

/** Calls `fn` with each state the main page publishes for `kind`; returns a function that stops listening. */
export function onToolState<S>(kind: string, fn: (msg: StateMessage<S>) => void): () => void {
	return EventsOn(STATE_EVENT, (data) => {
		const msg = readState<S>(data, kind)
		if (msg) fn(msg)
	})
}

/** Calls `fn` with the arguments the window gets when it is opened again while open (OpenToolWindow). */
export function onToolArgs(kind: string, fn: (args: Record<string, string>) => void): () => void {
	return EventsOn(ARGS_EVENT, (data) => {
		if (isFor(data, kind)) fn(((data as { args?: Record<string, string> | null }).args ?? {}) as Record<string, string>)
	})
}

/** Sends the main page a command for the tool window of `kind`. */
export function sendToolCommand(kind: string, cmd: ToolCommand) {
	void EventsBroadcast(COMMAND_EVENT, commandMessage(kind, cmd))
}

/** Looks as the main page does: its theme and interface size. */
export function applyLook(look: ToolLook) {
	document.documentElement.dataset.theme = look.theme
	applyUiScale(look.zoom)
}
