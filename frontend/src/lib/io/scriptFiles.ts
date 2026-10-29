// The files a Lua script reads and writes (#761): read_file, path_exists, write_file, append_file and
// image:save go to Go bindings (internal/scripts), never a POST. A path is relative to the scripts folder,
// or a whole one; a write stays in the scripts folder unless prefs.scriptWriteAnyFile, which goes with
// each call so Go never takes it from the script.
import { ReadScriptFile, SaveScriptImage, ScriptPathExists, WriteScriptFile } from '../wails/App'
import { hasBackend } from './backend'
import { prefs } from '../state/editor.svelte'
import type { ScriptFiles, ScriptImage } from '../script/scriptApi'

const NO_BACKEND = 'files can only be reached in the desktop app'

const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The bytes as base64, a block at a time (String.fromCharCode takes only so many arguments). */
function base64(data: Uint8Array): string {
	let s = ''
	for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000))
	return btoa(s)
}

export const scriptFiles: ScriptFiles = {
	async read(path) {
		if (!hasBackend()) return NO_BACKEND
		try {
			return { text: await ReadScriptFile(path) }
		} catch (e) {
			return why(e)
		}
	},
	async exists(path) {
		if (!hasBackend()) return NO_BACKEND
		try {
			return await ScriptPathExists(path)
		} catch (e) {
			return why(e)
		}
	},
	async write(path, text, append) {
		if (!hasBackend()) return NO_BACKEND
		try {
			await WriteScriptFile(path, text, append, prefs.scriptWriteAnyFile)
			return true
		} catch (e) {
			return why(e)
		}
	},
	async saveImage(path, img: ScriptImage) {
		if (!hasBackend()) return NO_BACKEND
		try {
			await SaveScriptImage(path, img.width, img.height, base64(img.data), prefs.scriptWriteAnyFile)
			return true
		} catch (e) {
			return why(e)
		}
	},
}
