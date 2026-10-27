// The images a Lua script loads with load_png (#29): Go reads and decodes the PNG (LoadScriptImage, a path
// relative to the scripts folder or a whole one) and hands its RGBA pixels over as one GET.
import { LoadScriptImage } from '../../../wailsjs/go/main/App'
import { hasBackend } from './backend'
import type { ScriptImage } from '../script/scriptApi'

/** The image at `path`, or why it can't be read. */
export async function loadScriptImage(path: string): Promise<ScriptImage | string> {
	if (!hasBackend()) return 'images can only be read in the desktop app'
	try {
		const r = await LoadScriptImage(path)
		const res = await fetch(r.url)
		if (!res.ok) return `${path}: ${res.status} ${await res.text()}`
		const data = new Uint8Array(await res.arrayBuffer())
		if (data.length !== r.width * r.height * 4) return `${path}: ${data.length} bytes came for a ${r.width}×${r.height} image`
		return { width: r.width, height: r.height, data }
	} catch (e) {
		return e instanceof Error ? e.message : String(e)
	}
}
