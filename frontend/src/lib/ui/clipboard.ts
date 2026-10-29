import { ClipboardSetText } from '../wails/runtime'
import { hasBackend } from '../io/backend'

/** Writes `text` to the clipboard (the app's, or the browser's on the dev page). */
export async function copyToClipboard(text: string) {
	if (hasBackend()) await ClipboardSetText(text)
	else await navigator.clipboard.writeText(text)
}
