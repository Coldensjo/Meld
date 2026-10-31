// Open in Blender (#290): a placed client model exported as glTF into a work folder of its own and opened
// in Blender (app_blender.go, internal/blender), and the Blender folder the preferences choose.
import { Blender, BrowseBlenderFolder, OpenInBlender, SetBlenderPath } from '../wails/App'
import { hasBackend } from './backend'
import { setStatus } from '../state/editor.svelte'
import { displayName, isWowType } from '../models/assets'

/** Whether a placed object of type `type` can open in Blender: a model of the client's own. */
export const opensInBlender = (type: string) => hasBackend() && isWowType(type) && !type.slice(type.indexOf(':') + 1).startsWith('@')

/** Opens the model of type `type` in Blender, saying in the status bar where its files are. */
export async function openInBlender(type: string) {
	const name = displayName(type)
	setStatus(`Opening ${name} in Blender…`)
	try {
		const r = await OpenInBlender(type)
		setStatus(r.fresh ? `${name} opened in Blender, saved as a .blend in ${r.folder}. Ctrl+S in Blender saves your edits there.` : `${name}'s .blend opened in Blender, with your earlier edits, from ${r.folder}.`, 10000)
	} catch (e) {
		setStatus(`Could not open ${name} in Blender: ${e}`, 10000)
	}
}

/** The Blender folder chosen in the preferences, and the program Open in Blender starts (found beside the client's folder or on the PATH when none is chosen). */
export async function blenderInfo(): Promise<{ path: string; program: string; error: string }> {
	if (!hasBackend()) return { path: '', program: '', error: '' }
	return Blender().catch((e: unknown) => ({ path: '', program: '', error: `${e}` }))
}

/** Picks the Blender folder (a portable Blender, or its install folder). */
export async function chooseBlenderFolder() {
	if (!hasBackend()) return
	try {
		const dir = await BrowseBlenderFolder()
		if (!dir) return
		await SetBlenderPath(dir)
		setStatus(`Blender folder: ${dir}. Right-click a model › Open in Blender opens it there.`, 8000)
	} catch (e) {
		setStatus(`${e}`, 8000)
	}
}
