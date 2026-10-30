// The main page's side of the database editors' own windows (#912, editors.ts; components/EditorWindows.svelte).
import type { EditorKind } from './editors'
import { nativeToolWindows } from './host'

/** The editors whose window failed to open this session: they show full screen in the main page instead. */
export const editorWindowFailed = $state<Partial<Record<EditorKind, boolean>>>({})

/** Whether the editor of `kind` opens in its own OS window (the desktop app), rather than full screen in the page. */
export const editorInWindow = (kind: EditorKind) => nativeToolWindows() && !editorWindowFailed[kind]
