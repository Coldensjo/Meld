// The status bar's message and the viewport's hint; split out of editor.svelte.ts (#459), which
// re-exports them. Both write `ui`, read only when called, so the import cycle with editor.svelte.ts
// never runs at load time.
import { ui } from './editor.svelte'
import { logLine } from './log.svelte'

let hintTimer: ReturnType<typeof setTimeout> | undefined
/** Show `msg` over the viewport for `timeout` ms. Another call restarts the clock. */
export function setViewportHint(msg: string, timeout = 1500) {
	ui.viewportHint = msg
	ui.viewportHintSeq++
	clearTimeout(hintTimer)
	hintTimer = setTimeout(() => (ui.viewportHint = ''), timeout)
}

let queuedHint: string | null = null
/**
 * Like `setViewportHint`, for a drag that calls it on every pointer move (#621): the text waits in a
 * plain variable and `publishViewportHint` shows it once a frame.
 */
export function queueViewportHint(msg: string) {
	queuedHint = msg
}
/** Shows the hint `queueViewportHint` left, if any. The same text again only restarts the fade timer. */
export function publishViewportHint() {
	if (queuedHint === null) return
	const msg = queuedHint
	queuedHint = null
	if (msg !== ui.viewportHint) setViewportHint(msg)
	else {
		clearTimeout(hintTimer)
		hintTimer = setTimeout(() => (ui.viewportHint = ''), 1500)
	}
}

let statusTimer: ReturnType<typeof setTimeout> | undefined
/** Where a tool window's page sends its status lines (#912): the main window's status bar, which it has none of. */
let statusElsewhere: ((msg: string, timeout: number) => void) | null = null
export function forwardStatus(fn: ((msg: string, timeout: number) => void) | null) {
	statusElsewhere = fn
}
/** Shows `msg` in the status bar, and the log, for `timeout` ms (0 keeps it). */
export function setStatus(msg: string, timeout = 4000) {
	if (statusElsewhere) {
		statusElsewhere(msg, timeout)
		return
	}
	if (msg && msg !== 'Ready' && msg !== ui.status) logLine(msg)
	ui.status = msg
	clearTimeout(statusTimer)
	if (timeout > 0) statusTimer = setTimeout(() => (ui.status = 'Ready'), timeout)
}
