// Whether the Go side is there, and `guarded`, which runs a file or client action once at a time and
// reports its failure in the status bar. Every io module builds on these.
import { setStatus, ui } from '../state/editor.svelte'

/** True when running inside the Wails webview (Go bindings available). */
export const hasBackend = () => typeof (window as Window & { go?: unknown }).go !== 'undefined'

export async function guarded(label: string, fn: () => Promise<void>) {
	if (!hasBackend()) {
		setStatus('File operations need the desktop app (run via `wails dev`).')
		return
	}
	if (ui.busy) return
	ui.busy = true
	try {
		await fn()
	} catch (err) {
		console.error(err)
		setStatus(`${label} failed: ${err}`, 8000)
	} finally {
		ui.busy = false
	}
}
