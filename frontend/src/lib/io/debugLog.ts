// The debug log (#626): started with MELD_DEBUG_LOG set, the app writes the page's console warnings
// and errors to the session's log file (and Go writes each asset request there, app_debuglog.go), so a
// check in the built app, whose console can't be reached, needs no throwaway build. The lines go
// straight to the file, not to the Log window, which they would flood.
import { AppendLog } from '../wails/App'
import { hasBackend } from './backend'

/** Where Go answers whether the debug log is on ("1" or "0"). */
export const DEBUG_LOG_PATH = '/meld/debug-log'

type Method = 'warn' | 'error'
type Con = Pick<Console, Method>

/** One console argument as text: an Error by its stack (or message), other objects as JSON where they can be. */
export function consoleArg(a: unknown): string {
	if (typeof a === 'string') return a
	if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`
	if (a === undefined || typeof a === 'function' || typeof a === 'symbol') return String(a)
	try {
		return JSON.stringify(a) ?? String(a)
	} catch {
		return String(a)
	}
}

/** A console call as a log line: its time, its level and its arguments. */
export function consoleLine(method: Method, args: readonly unknown[], d = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0')
	return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} console.${method} ${args.map(consoleArg).join(' ')}`
}

/**
 * Has `con`'s warn and error also send their lines to `sink`, gathered and sent at most once every
 * `everyMs`; the console still prints them. `flush` sends what is waiting now; `stop` puts the
 * console back and flushes.
 */
export function forwardConsole(con: Con, sink: (lines: string[]) => Promise<unknown>, everyMs = 1000): { flush: () => void; stop: () => void } {
	let pending: string[] = []
	let timer: ReturnType<typeof setTimeout> | undefined
	const flush = () => {
		clearTimeout(timer)
		timer = undefined
		if (!pending.length) return
		const lines = pending
		pending = []
		sink(lines).catch(() => {})
	}
	const saved = { warn: con.warn, error: con.error }
	for (const m of ['warn', 'error'] as const) {
		const orig = saved[m]
		con[m] = (...args: unknown[]) => {
			orig.apply(con, args)
			pending.push(consoleLine(m, args))
			timer ??= setTimeout(flush, everyMs)
		}
	}
	const stop = () => {
		con.warn = saved.warn
		con.error = saved.error
		flush()
	}
	return { flush, stop }
}

/** Asks Go whether the debug log is on and, if so, forwards the console to the session log. Returns a stop function. */
export async function startDebugLog(): Promise<() => void> {
	if (!hasBackend()) return () => {}
	try {
		const r = await fetch(DEBUG_LOG_PATH, { cache: 'no-store' })
		if (!r.ok || (await r.text()) !== '1') return () => {}
	} catch {
		return () => {}
	}
	const fwd = forwardConsole(console, (lines) => AppendLog(lines))
	// The lines still waiting when the window closes.
	const onHide = () => fwd.flush()
	window.addEventListener('pagehide', onHide)
	const onError = (e: ErrorEvent) => console.error('uncaught', e.error ?? e.message)
	const onRejection = (e: PromiseRejectionEvent) => console.error('unhandled rejection', e.reason)
	window.addEventListener('error', onError)
	window.addEventListener('unhandledrejection', onRejection)
	console.warn('debug log on (MELD_DEBUG_LOG): console warnings and errors and asset requests go to the session log')
	return () => {
		window.removeEventListener('pagehide', onHide)
		window.removeEventListener('error', onError)
		window.removeEventListener('unhandledrejection', onRejection)
		fwd.stop()
	}
}
