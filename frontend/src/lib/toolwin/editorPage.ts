// A database editor's side of its own OS window (#912, editors.ts): what an editor calls that must reach
// the main page as well when it runs in a tool window's page. In the main page (the browser page, or an
// editor that could not open its window) these do nothing more.
import { sendToolCommand } from './client'
import type { EditorCommand, EditorForget, EditorKind } from './editors'

/** The kind of editor window this page is, '' in the main page. */
let pageKind: EditorKind | '' = ''

/** Marks this page as the window of the editor of `kind` (EditorToolWindow.svelte). */
export function setEditorPage(kind: EditorKind) {
	pageKind = kind
}

/** Sends the main page a command, when this page is an editor's window. */
export function sendEditorCommand(cmd: EditorCommand) {
	if (pageKind) sendToolCommand(pageKind, cmd)
}

/** Has the main page forget caches the editor made stale, so its names, tooltips and pickers read them again. */
export function shareForget(forget: EditorForget) {
	sendEditorCommand({ type: 'forget', forget })
}
