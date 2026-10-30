// The main page's side of the database editors' own windows (#912, editors.ts; components/EditorWindows.svelte).
import type { EditorKind, SlotTarget } from './editors'
import { nativeToolWindows } from './host'

/** The editors whose window failed to open this session: they show full screen in the main page instead. */
export const editorWindowFailed = $state<Partial<Record<EditorKind, boolean>>>({})

/** Whether the editor of `kind` opens in its own OS window (the desktop app), rather than full screen in the page. */
export const editorInWindow = (kind: EditorKind) => nativeToolWindows() && !editorWindowFailed[kind]

/** What each editor's window has open now, as it last said (null once closed): the main page moves an open creature editor to a spawn picked there (#915). */
export const editorWindowTarget = $state<Partial<Record<EditorKind, SlotTarget | null>>>({})
