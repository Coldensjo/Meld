import { BrowseBrushImageFolder, ListBrushImages, ReadBrushImage } from '../../../wailsjs/go/main/App'
import { editor, prefs, setStatus } from '../state/editor.svelte'
import { setBrushImage } from '../tools/brushImage'
import { base64ToBytes } from './base64'
import { hasBackend } from './backend'
// The image brushes' folder (prefs.brushImageDir, the user's own greyscale images, as Noggit Red's
// Samples folder) and the image picked from it (editor.brushImage.name), read through the bindings.

/** The images in the brush folder; none without one or without the desktop app. */
export async function listBrushImages(): Promise<string[]> {
	if (!hasBackend() || !prefs.brushImageDir) return []
	try {
		return (await ListBrushImages(prefs.brushImageDir)) ?? []
	} catch (err) {
		setStatus(`Brush images not listed: ${err}`, 6000)
		return []
	}
}

/** Asks for the brush image folder. Returns whether one was picked. */
export async function chooseBrushImageFolder(): Promise<boolean> {
	if (!hasBackend()) return false
	const dir = await BrowseBrushImageFolder(prefs.brushImageDir)
	if (!dir) return false
	prefs.brushImageDir = dir
	return true
}

/** Makes `name` (an image of the brush folder, or '' for none) the image that shapes the brushes. */
export async function useBrushImage(name: string) {
	editor.brushImage.name = name
	if (!name) {
		setBrushImage(null)
		return
	}
	try {
		const g = await ReadBrushImage(prefs.brushImageDir, name)
		// A later pick may have come in while this one was read.
		if (editor.brushImage.name !== name) return
		setBrushImage(base64ToBytes(g.pix), g.w, g.h)
	} catch (err) {
		editor.brushImage.name = ''
		setBrushImage(null)
		setStatus(`Brush image not read: ${err}`, 6000)
	}
}
