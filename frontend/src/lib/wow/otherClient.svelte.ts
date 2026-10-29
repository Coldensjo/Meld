import { BrowseOtherClient, ImportOtherAssets, OpenOtherClient } from '../wails/App'
import type { main } from '../wails/models'
import { EventsOn } from '../wails/runtime'
import { hasBackend } from '../io/backend'
import { prefs } from '../state/editor.svelte'
import { refreshAssetLists } from './api'

// The client models and textures are imported from (#858): Tools › Import from Another Client…
// (components/OtherClientDialog.svelte). Go opens it read-only beside the current one and serves it
// at /wowx/*; a path of it is written `@<id>:<path>` (api.ts `otherPath`), so its textures and
// thumbnails never mix with the current client's of the same path. The clients to pick from are
// `prefs.otherClients`, a name and a folder each.

export interface OtherClient {
	name: string
	path: string
}

/** The other client open now: its folder ('' for none), and whether it loaded. */
export const other = $state({ path: '', loaded: false, loading: false, error: '', files: 0 })

/** A short id for a client folder (FNV-1a of its lower-case path, base 36), the `@<id>:` of its paths. */
export function clientId(path: string): string {
	let h = 0x811c9dc5
	const p = path.toLowerCase()
	for (let i = 0; i < p.length; i++) {
		h ^= p.charCodeAt(i)
		h = Math.imul(h, 0x01000193) >>> 0
	}
	return h.toString(36)
}

/** Opens the client at `path` as the other one ('' closes it, freeing what Go decoded from it). */
export async function openOther(path: string): Promise<void> {
	if (!hasBackend()) return
	other.loading = true
	other.error = ''
	try {
		const s = await OpenOtherClient(path)
		other.path = s.path
		other.loaded = s.loaded
		other.files = s.files
		other.error = s.error
	} catch (e) {
		other.path = path
		other.loaded = false
		other.error = String(e)
	} finally {
		other.loading = false
	}
}

/** The other client's paths of a kind ('m2', 'wmo' or 'tileset'), none when it isn't open. */
export async function listOther(kind: 'm2' | 'wmo' | 'tileset'): Promise<string[]> {
	if (!other.loaded) return []
	try {
		const r = await fetch(`/wowx/list?kind=${kind}`)
		return r.ok ? ((await r.json()) as string[]) : []
	} catch {
		return []
	}
}

/** A folder's last name, the name a new entry in the list starts with. */
export function folderName(path: string): string {
	const parts = path.split(/[\\/]+/).filter(Boolean)
	return parts[parts.length - 1] ?? path
}

/** Asks for a client folder; '' when cancelled (or in the browser page, which has no dialogs). */
export async function browseOther(): Promise<string> {
	if (!hasBackend()) return ''
	return (await BrowseOtherClient()) ?? ''
}

/** Adds a client to the saved list (named after its folder unless `name` is given), or renames the entry it has. */
export function saveOtherClient(path: string, name = ''): OtherClient {
	const entry = { name: name.trim() || folderName(path), path }
	prefs.otherClients = [...prefs.otherClients.filter((c) => c.path.toLowerCase() !== path.toLowerCase()), entry]
	return entry
}

/** Takes a client off the saved list, closing it when it is the open one. */
export async function forgetOtherClient(path: string): Promise<void> {
	prefs.otherClients = prefs.otherClients.filter((c) => c.path.toLowerCase() !== path.toLowerCase())
	if (other.path.toLowerCase() === path.toLowerCase()) await openOther('')
}

/**
 * Copies the other client's assets at `paths` with what they need into the current client's patch
 * (Go's `ImportOtherAssets`), then has the asset browser list the client again when they went in.
 */
export async function importOther(paths: string[]): Promise<main.AssetsImported> {
	const res = await ImportOtherAssets(paths)
	if (res.files > 0 && !res.waiting) refreshAssetLists()
	if (res.files > 0 && res.waiting) listOnceWritten()
	return res
}

let offPending: (() => void) | null = null

/** Lists the client again once the files waiting for the game to close are in the patch. */
function listOnceWritten() {
	offPending ??= EventsOn('client:pending', (n: number) => {
		if (n > 0) return
		offPending?.()
		offPending = null
		refreshAssetLists()
	})
}
