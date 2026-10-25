import { BrowsePrefabFolder, ListPrefabs, SavePrefabDialog, WriteTextFile } from '../../../wailsjs/go/main/App'
import type { Engine } from '../engine/Engine'
import { prefs, setStatus, ui } from '../state/editor.svelte'
import { formatPrefab, parsePrefab, prefabHash, type Prefab } from '../wow/prefabs'
import { hasBackend } from './backend'
// The prefab folder (#170): Models › Save Selection as Prefab writes a TOML file into it, and the
// asset browser's Prefabs tab lists what it holds.

/** One prefab of the folder: its file name, the prefab read from it, and the key its thumbnail is made under. */
export interface PrefabEntry {
	file: string
	prefab: Prefab
	thumbKey: string
}

/** Asks for the prefab folder. Returns whether one was chosen. */
export async function choosePrefabFolder(): Promise<boolean> {
	if (!hasBackend()) return false
	const dir = await BrowsePrefabFolder(prefs.prefabDir)
	if (!dir) return false
	prefs.prefabDir = dir
	ui.prefabsVersion++
	return true
}

/** The prefabs of the folder, with the files that couldn't be read. */
export async function readPrefabs(): Promise<{ entries: PrefabEntry[]; problems: string[] }> {
	if (!hasBackend() || !prefs.prefabDir) return { entries: [], problems: [] }
	const files = (await ListPrefabs(prefs.prefabDir)) ?? []
	const entries: PrefabEntry[] = []
	const problems: string[] = []
	for (const f of files) {
		const { prefab, errors } = parsePrefab(f.text, f.name.replace(/\.toml$/i, ''))
		if (!prefab) {
			problems.push(`${f.name}: ${errors[0] ?? 'not a prefab'}`)
			continue
		}
		entries.push({ file: f.name, prefab, thumbKey: `prefab:${prefabHash(f.text)}` })
	}
	return { entries, problems }
}

/** Models › Save Selection as Prefab: the selected models into a TOML file of the prefab folder. */
export async function saveSelectionAsPrefab(engine: Engine) {
	if (!hasBackend()) {
		setStatus('Prefabs need the desktop app.')
		return
	}
	const clip = engine.selectionClip()
	if (!clip) {
		setStatus('Select the models to keep as a prefab first (Select tool).')
		return
	}
	if (!prefs.prefabDir && !(await choosePrefabFolder())) return
	try {
		const path = await SavePrefabDialog(prefs.prefabDir, 'prefab')
		if (!path) return
		const name = path.slice(path.search(/[^\\/]*$/)).replace(/\.toml$/i, '')
		await WriteTextFile(path, formatPrefab({ name, objects: clip.objects }))
		ui.prefabsVersion++
		const n = clip.objects.length
		setStatus(`Saved ${n} ${n === 1 ? 'model' : 'models'} as the prefab "${name}". Place it from the asset browser's Prefabs tab.`, 6000)
	} catch (err) {
		setStatus(`Saving the prefab failed: ${err}`, 8000)
	}
}
