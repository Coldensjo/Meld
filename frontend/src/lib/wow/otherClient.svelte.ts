import { BrowseOtherClient, ImportOtherAssets, OpenOtherClient } from '../wails/App'
import type { main, wow } from '../wails/models'
import { EventsOn } from '../wails/runtime'
import { hasBackend } from '../io/backend'
import { prefs } from '../state/editor.svelte'
import { refreshAssetLists } from './api'
import { reloadReplaced } from '../models/assets'
import { replacedFiles } from './replaced'
import { forgetThumbs } from './thumbs'
import { engineRef } from '../state/engineRef'

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
 * A file the current client has a different copy of is written over only as `opts` allow (#878).
 */
export async function importOther(paths: string[], opts: wow.ImportOptions = { replaceAssets: false, replaceNeeded: false }): Promise<main.AssetsImported> {
	const res = await ImportOtherAssets(paths, opts)
	if (res.files > 0 && !res.waiting) written(res.replaced)
	if (res.files > 0 && res.waiting) listOnceWritten(res.replaced)
	return res
}

/**
 * Once the files are in the patch: lists the client again, and drops what the page holds of the
 * files written over the current client's copy (#922): its models, textures, WMO room data (#928) and
 * thumbnails.
 */
function written(replaced: string[]) {
	refreshAssetLists()
	if (!replaced.length) return
	const files = replacedFiles(replaced)
	reloadReplaced(files)
	engineRef.current?.forgetRooms([...files.models].filter((p) => p.endsWith('.wmo')))
	void forgetThumbs(files)
}

let offPending: (() => void) | null = null
/** The replaced files of the imports waiting for the game to close. */
let replacedPending: string[] = []

/** Does `written` once the files waiting for the game to close are in the patch. */
function listOnceWritten(replaced: string[]) {
	replacedPending.push(...replaced)
	offPending ??= EventsOn('client:pending', (n: number) => {
		if (n > 0) return
		offPending?.()
		offPending = null
		const all = replacedPending
		replacedPending = []
		written(all)
	})
}
