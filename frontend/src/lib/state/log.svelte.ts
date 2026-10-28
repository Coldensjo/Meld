// The app log (Help > Log…) and the session's log file (#319); split out of editor.svelte.ts (#459),
// which re-exports it.
import { prefs } from './prefs.svelte'

/**
 * The Log window's lines (Help › Log…): every status message, the Go side's progress lines (which
 * arrive as status messages) and, with Log file loading on, every file read from the client. The
 * newest is last; at most LOG_LINES are kept.
 */
export const appLog = $state({ lines: [] as Array<{ time: string; text: string }> })
const LOG_LINES = 500

export function logLine(text: string) {
	const d = new Date()
	const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
	appLog.lines.push({ time, text })
	if (appLog.lines.length > LOG_LINES) appLog.lines.splice(0, appLog.lines.length - LOG_LINES)
	if (logPending) {
		logPending.push(`${time} ${text}`)
		logTimer ??= setTimeout(flushLog, LOG_FLUSH_MS)
	}
}

/** Lines waiting to go to the session's log file (#319); null until `startLogFile` gives a sink. */
let logPending: string[] | null = null
let logSink: ((lines: string[]) => Promise<void>) | null = null
let logTimer: ReturnType<typeof setTimeout> | undefined
const LOG_FLUSH_MS = 1000

/** Sends the lines logged since the last flush to the log file's sink, in one call. */
export function flushLog() {
	clearTimeout(logTimer)
	logTimer = undefined
	if (!logSink || !logPending?.length) return
	const lines = logPending
	logPending = []
	logSink(lines).catch(() => {})
}

/** Starts writing the Log window's lines to the session's log file (#319), starting with those already logged. */
export function startLogFile(sink: (lines: string[]) => Promise<void>) {
	logSink = sink
	logPending = appLog.lines.map((l) => `${l.time} ${l.text}`)
	flushLog()
}

export function clearLog() {
	appLog.lines = []
}

/** Logs a file read from the client (its kind, path, time taken and any error) when Log file loading is on. */
export function logFile(kind: string, path: string, ms: number, err?: unknown) {
	if (!prefs.logFileLoading) return
	logLine(err ? `${kind} ${path}: failed after ${Math.round(ms)} ms: ${err instanceof Error ? err.message : err}` : `${kind} ${path} (${Math.round(ms)} ms)`)
}
