import { BrowsePrefabFolder, ListPrefabs, SavePrefabDialog, WriteTextFile } from '../../../wailsjs/go/main/App'
import type { Engine } from '../engine/Engine'
import { prefs, setStatus, ui } from '../state/editor.svelte'
import { formatCubePrefab, isCubePrefabText, parseCubePrefab, type CubePrefab } from '../cubes/prefabs'
import { clipCount } from '../cubes/clip'
import { monsterKind } from '../cubes/monsterKinds'
import { hasBackend } from './mapio'

// The prefab folder (#170) keeps the prefabs of cubes (3dgame #73, cubes/prefabs.ts), saved from a
// world tab's selected box and listed by its cube palette's Prefabs tab. Files that are not prefabs of
// cubes (Meld's prefabs of models) are left out.

/** Asks for the prefab folder. Returns whether one was chosen. */
export async function choosePrefabFolder(): Promise<boolean> {
	if (!hasBackend()) return false
	const dir = await BrowsePrefabFolder(prefs.prefabDir)
	if (!dir) return false
	prefs.prefabDir = dir
	ui.prefabsVersion++
	return true
}

/** One prefab of cubes of the folder: its file name and the prefab read from it. */
export interface CubePrefabEntry {
	file: string
	prefab: CubePrefab
}

/** The prefabs of cubes of the folder, with the cube prefab files that couldn't be read. */
export async function readCubePrefabs(): Promise<{ entries: CubePrefabEntry[]; problems: string[] }> {
	if (!hasBackend() || !prefs.prefabDir) return { entries: [], problems: [] }
	const files = (await ListPrefabs(prefs.prefabDir)) ?? []
	const entries: CubePrefabEntry[] = []
	const problems: string[] = []
	for (const f of files) {
		if (!isCubePrefabText(f.text)) continue
		const { prefab, errors } = parseCubePrefab(f.text, f.name.replace(/\.toml$/i, ''), (k) => !!monsterKind(k))
		if (!prefab) problems.push(`${f.name}: ${errors[0] ?? 'not a prefab of cubes'}`)
		else entries.push({ file: f.name, prefab })
	}
	return { entries, problems }
}

/** The cube palette's Save selection: the world tab's selected box of cubes into a TOML file of the prefab folder. */
export async function saveCubeSelectionAsPrefab(engine: Engine) {
	if (!hasBackend()) {
		setStatus('Prefabs need the desktop app.')
		return
	}
	const clip = engine.cubeSelectionClip()
	if (!clip) return
	if (!prefs.prefabDir && !(await choosePrefabFolder())) return
	try {
		const path = await SavePrefabDialog(prefs.prefabDir, 'cubes')
		if (!path) return
		const name = path.slice(path.search(/[^\\/]*$/)).replace(/\.toml$/i, '')
		await WriteTextFile(path, formatCubePrefab({ name, clip }))
		ui.prefabsVersion++
		const n = clipCount(clip)
		setStatus(`Saved ${n} ${n === 1 ? 'cube' : 'cubes'} as the prefab "${name}". Place it from the cube palette's Prefabs tab.`, 6000)
	} catch (err) {
		setStatus(`Saving the prefab failed: ${err}`, 8000)
	}
}
