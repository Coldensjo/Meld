// The channel between the main page and the tool windows that open as their own OS windows (#909,
// app_windows.go). Each tool window is its own Wails window and JavaScript context, so it can't reach
// the Engine or the main page's `editor`/`ui` state: the main page publishes the window's state over a
// Wails event (throttled, never per frame), the window sends commands back, and a window that loads
// asks for the current state with a `hello` command. Every message carries the window's kind, since
// Go sends each event to every window. This module holds only the message shapes, so the tests load it.

/** The event the main page publishes a tool window's state on: a {@link StateMessage}. */
export const STATE_EVENT = 'toolwin:state'
/** The event a tool window sends its commands on: a {@link CommandMessage}. */
export const COMMAND_EVENT = 'toolwin:cmd'
/** The event Go sends when a tool window closes (its close button, or CloseToolWindow): `{ kind }`. */
export const CLOSED_EVENT = 'toolwin:closed'
/** The event Go sends an open tool window when it is opened again with new arguments: `{ kind, args }`. */
export const ARGS_EVENT = 'toolwin:args'

/** How the main page looks, which a tool window copies: the theme and the interface size (Preferences › General). */
export interface ToolLook {
	theme: 'light' | 'dark'
	zoom: number
}

export interface StateMessage<S> {
	kind: string
	state: S
	look: ToolLook
}

/** A tool window's command: `hello` asks for the current state; the rest are the kind's own. */
export type ToolCommand = { type: 'hello' } | { type: string; [k: string]: unknown }

export interface CommandMessage {
	kind: string
	cmd: ToolCommand
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export function stateMessage<S>(kind: string, state: S, look: ToolLook): StateMessage<S> {
	return { kind, state, look }
}

/** The message if `data` is a state message for `kind`, else null (another kind's, or not one). */
export function readState<S>(data: unknown, kind: string): StateMessage<S> | null {
	if (!isObject(data) || data.kind !== kind || !('state' in data) || !isObject(data.look)) return null
	const look: ToolLook = { theme: data.look.theme === 'light' ? 'light' : 'dark', zoom: typeof data.look.zoom === 'number' ? data.look.zoom : 1 }
	return { kind, state: data.state as S, look }
}

export function commandMessage(kind: string, cmd: ToolCommand): CommandMessage {
	return { kind, cmd }
}

/** The command if `data` is a command message for `kind`, else null. */
export function readCommand(data: unknown, kind: string): ToolCommand | null {
	if (!isObject(data) || data.kind !== kind || !isObject(data.cmd) || typeof data.cmd.type !== 'string') return null
	return data.cmd as ToolCommand
}

/** Whether `data` is Go's message that the tool window of `kind` closed (CLOSED_EVENT), or its new arguments (ARGS_EVENT). */
export function isFor(data: unknown, kind: string): boolean {
	return isObject(data) && data.kind === kind
}

/** The tool window kind a page's query asks for (`?window=history`), or '' for the main page. */
export function toolWindowKind(search: string): string {
	return new URLSearchParams(search).get('window') ?? ''
}

/**
 * Calls `fn` at most once every `ms`: the first call at once, a call within `ms` of the last run once
 * `ms` has passed, however many came in between. `cancel` drops a waiting call.
 */
export function throttle(fn: () => void, ms: number): { (): void; cancel(): void } {
	let last = -Infinity
	let timer: ReturnType<typeof setTimeout> | null = null
	const run = () => {
		timer = null
		last = Date.now()
		fn()
	}
	const call = () => {
		if (timer) return
		const wait = last + ms - Date.now()
		if (wait <= 0) run()
		else timer = setTimeout(run, wait)
	}
	call.cancel = () => {
		if (timer) clearTimeout(timer)
		timer = null
	}
	return call
}
