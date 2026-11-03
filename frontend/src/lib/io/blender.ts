// Open in Blender (#290): a placed client model exported as glTF into a work folder of its own and opened
// in Blender (app_blender.go, internal/blender), and the Blender folder the preferences choose. The way
// back: Import from Blender writes the saved model into the client as a still M2 (World\Meld\<folder>)
// and swaps the placement for it; Import 3D Model does the same for a .blend or GLB made from scratch and
// starts placing it.
import { Blender, BrowseBlenderFolder, BrowseModelFile, ImportFromBlender, ImportModelFile, OpenInBlender, SetBlenderPath } from '../wails/App'
import type { main } from '../wails/models'
import { EventsOn } from '../wails/runtime'
import { hasBackend } from './backend'
import { docs, setStatus } from '../state/editor.svelte'
import { displayName, isWowType, reloadReplaced } from '../models/assets'
import { engineRef } from '../state/engineRef'
import { refreshAssetLists } from '../wow/api'
import { replacedFiles } from '../wow/replaced'
import { forgetThumbs } from '../wow/thumbs'
import { placeModelType } from '../tools/PipetteTool'

/** Whether a placed object of type `type` can open in Blender: a model of the client's own. */
export const opensInBlender = (type: string) => hasBackend() && isWowType(type) && !type.slice(type.indexOf(':') + 1).startsWith('@')

/** Opens the model of type `type` in Blender, saying in the status bar where its files are. */
export async function openInBlender(type: string) {
	const name = displayName(type)
	setStatus(`Opening ${name} in Blender…`)
	try {
		const r = await OpenInBlender(type)
		setStatus(
			r.fresh
				? `${name} opened in Blender, saved as a .blend in ${r.folder}. Save your edits there (Ctrl+S), then right-click › Import from Blender.`
				: `${name}'s .blend opened in Blender, with your earlier edits. Save them (Ctrl+S), then right-click › Import from Blender.`,
			10000,
		)
	} catch (e) {
		setStatus(`Could not open ${name} in Blender: ${e}`, 10000)
	}
}

/**
 * After a model from Blender went into the client: what the page holds of the files written over (an
 * earlier import of it) is loaded again at once, since Meld reads files waiting for the game too, and
 * the asset browser lists the client again once the patch has them.
 */
function written(r: main.BlenderImported) {
	if (r.replaced.length) {
		const files = replacedFiles(r.replaced)
		reloadReplaced(files)
		void forgetThumbs(files)
	}
	if (!r.waiting) {
		refreshAssetLists()
		return
	}
	const off = EventsOn('client:pending', (n: number) => {
		if (n > 0) return
		off()
		refreshAssetLists()
	})
}

/** What the status bar says of model `r`, and of its files waiting for the game to close. */
function summary(r: main.BlenderImported): string {
	const what = `${r.triangles} triangles, ${r.textures} ${r.textures === 1 ? 'texture' : 'textures'}`
	return `${what}${r.waiting ? '; the game gets it once it is closed' : ''}`
}

/**
 * Import from Blender: brings back the model placed object `id` (of type `type`) opened in Blender, from
 * the .blend saved there, as a client model, and swaps the placement for it (one undo step). A building
 * can't become a doodad in its place, so its model is picked for placing instead.
 */
export async function importFromBlender(id: number, type: string) {
	const name = displayName(type)
	const doc = docs.active
	setStatus(`Bringing ${name} back from Blender…`)
	try {
		const r = await ImportFromBlender(type)
		written(r)
		const e = engineRef.current
		const done = `${displayName(r.type)} written into the client (${summary(r)})`
		if (!type.startsWith('m2:')) {
			placeModelType(r.type)
			setStatus(`${done}. A building can't be swapped for a doodad: click to place it.`, 10000)
		} else if (e && docs.active === doc && e.swapModel(id, type, r.type)) {
			setStatus(`${done}, and put in the place of ${name}.`, 10000)
		} else {
			setStatus(`${done}.`, 10000)
		}
	} catch (e) {
		setStatus(`Could not bring ${name} back from Blender: ${e}`, 12000)
	}
}

/** Import 3D Model: writes a .blend or GLB the user picks into the client as a model, and starts placing it. */
export async function importModelFile() {
	if (!hasBackend()) return
	try {
		const file = await BrowseModelFile()
		if (!file) return
		setStatus(`Importing ${file}…`)
		const r = await ImportModelFile(file)
		written(r)
		placeModelType(r.type)
		setStatus(`${displayName(r.type)} written into the client (${summary(r)}): click to place it. Right-click it › Open in Blender opens your file again.`, 10000)
	} catch (e) {
		setStatus(`Could not import the model: ${e}`, 12000)
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
