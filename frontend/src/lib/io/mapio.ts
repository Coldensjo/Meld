// The map file: File › Save, Open and Revert of a .wmap (mapData.ts converts it).
import { LoadMap, OpenMapDialog, SaveMap, SaveMapDialog } from '../../../wailsjs/go/main/App'
import { guarded } from './backend'
import { fromMapData, toMapData } from './mapData'
import type { Engine } from '../engine/Engine'
import { editor, setStatus, ui } from '../state/editor.svelte'
import { withSaving } from '../state/saving'

export function saveMap(engine: Engine, saveAs = false) {
	return guarded('Save', async () => {
		// A world view holds nothing of its own to save (#15).
		if (engine.activeWorld()) {
			setStatus('A world view is not saved: Edit Here (File menu) opens the block around the camera, which saves and compiles.', 6000)
			return
		}
		let path = editor.filePath
		if (!path || saveAs) {
			path = await SaveMapDialog(editor.mapName)
			if (!path) return
		}
		const t0 = performance.now()
		await withSaving('Saving map', () => SaveMap(path, toMapData(engine.snapshot())))
		editor.filePath = path
		editor.dirty = false
		engine.refreshTabs()
		setStatus(`Saved ${path} (${Math.round(performance.now() - t0)} ms)`)
	})
}

export function openMap(engine: Engine) {
	return guarded('Open', async () => {
		const path = await OpenMapDialog()
		if (!path) return
		if (engine.focusPath(path)) {
			setStatus('That map is already open.')
			return
		}
		const t0 = performance.now()
		const data = await LoadMap(path)
		engine.openDocument(fromMapData(data), path)
		setStatus(`Loaded ${path} (${Math.round(performance.now() - t0)} ms)`)
	})
}

/**
 * Re-reads the active map from its file in the same tab, dropping its unsaved changes and undo history.
 * The UI asks first when there are unsaved changes.
 */
export function revertMap(engine: Engine) {
	return guarded('Revert', async () => {
		const path = editor.filePath
		if (!path) return
		const id = engine.activeDocumentId()
		const t0 = performance.now()
		const data = await LoadMap(path)
		engine.openDocument(fromMapData(data), path, id)
		setStatus(`Reverted to ${path} (${Math.round(performance.now() - t0)} ms)`)
	})
}

/** Asks before reverting a map with unsaved changes, then reverts it. */
export function requestRevert(engine: Engine) {
	if (editor.dirty) ui.dialog = 'revert'
	else revertMap(engine)
}
