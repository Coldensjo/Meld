import { AppendLog } from '../../../wailsjs/go/main/App'
import { flushLog, startLogFile } from '../state/editor.svelte'
import { hasBackend } from './backend'
// The Log window's lines also go to a file in the user cache (`internal/sessionlog`, #319), one file
// a session and the last few kept, so a bug report can be traced after Meld has closed.

/** Starts writing the log to the session's file; returns a stop function. */
export function startSessionLog() {
	if (!hasBackend()) return () => {}
	startLogFile(AppendLog)
	const onHide = () => flushLog()
	window.addEventListener('pagehide', onHide)
	return () => window.removeEventListener('pagehide', onHide)
}
