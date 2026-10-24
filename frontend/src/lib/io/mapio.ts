import { ImportTibiaMap, PlayWorld, OpenMapDialog, LoadWorld, SaveWorld, SaveWorldDialog } from '../../../wailsjs/go/main/App'
import type { Engine } from '../engine/Engine'
import { editor, logLine, setStatus, ui } from '../state/editor.svelte'
import { withSaving } from '../state/saving'
import { main } from '../../../wailsjs/go/models'
import { CubeWorld } from '../cubes/world'
import * as THREE from 'three'
import { playSpot } from '../cubes/play'

/** True when running inside the Wails webview (Go bindings available). */
export const hasBackend = () => typeof (window as unknown as { go?: unknown }).go !== 'undefined'

async function guarded(label: string, fn: () => Promise<void>) {
	if (!hasBackend()) {
		setStatus('File operations need the desktop app (run via `wails dev`).')
		return
	}
	if (ui.busy) return
	ui.busy = true
	try {
		await fn()
	} catch (err) {
		console.error(err)
		setStatus(`${label} failed: ${err}`, 8000)
	} finally {
		ui.busy = false
	}
}

/** Saves the active world in the game's world format (#29), to its .world file (Save As, or a new world, asks where). */
export function saveMap(engine: Engine, saveAs = false) {
	return guarded('Save', async () => {
		const world = engine.activeDocument().world
		let path = editor.filePath
		if (!path || saveAs) {
			path = await SaveWorldDialog(editor.mapName)
			if (!path) return
		}
		const t0 = performance.now()
		await withSaving('Saving world', () => SaveWorld(path, main.WorldData.createFrom(world.toData())))
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
			setStatus('That world is already open.')
			return
		}
		const t0 = performance.now()
		await openPath(engine, path)
		setStatus(`Loaded ${path} (${Math.round(performance.now() - t0)} ms)`)
	})
}

/**
 * File › Import Tibia Map (3dgame #218): Go asks for an Open Tibia map, the items.otb it was made with
 * and where to save, imports it into a cube world (internal/otbm), and the world opens in a tab.
 */
export function importTibiaMap(engine: Engine) {
	return guarded('Import', async () => {
		const t0 = performance.now()
		const done = await ImportTibiaMap()
		if (!done?.path) return
		await openPath(engine, done.path)
		const lines = done.summary.trim().split('\n')
		for (const line of lines) logLine(line)
		setStatus(`Imported ${done.path} (${Math.round(performance.now() - t0)} ms): ${lines[0]} Help › Log has the rest.`, 8000)
	})
}

/**
 * Re-reads the active world from its file in the same tab, dropping its unsaved changes and undo
 * history. The UI asks first when there are unsaved changes.
 */
export function revertMap(engine: Engine) {
	return guarded('Revert', async () => {
		const path = editor.filePath
		if (!path) return
		const id = engine.activeDocumentId()
		const t0 = performance.now()
		await openPath(engine, path, id)
		setStatus(`Reverted to ${path} (${Math.round(performance.now() - t0)} ms)`)
	})
}

/** Reads the cube world at `path` and opens it in a tab, or with `replaceId` in that tab's place. Throws when it does not read. */
export async function openPath(engine: Engine, path: string, replaceId?: number) {
	const data = await LoadWorld(path)
	const name = path.replace(/^.*[\\/]/, '').replace(/\.world$/i, '')
	engine.openWorld(CubeWorld.fromData(data), name, path, replaceId)
}

/** Asks before reverting a world with unsaved changes, then reverts it. */
export function requestRevert(engine: Engine) {
	if (editor.dirty) ui.dialog = 'revert'
	else revertMap(engine)
}

/**
 * Play World (#33): saves the open cube world (a world with changes, or none yet, asks where first),
 * then starts the 3dgame client on it with the player where the camera is. The client plays alone on
 * a server it starts itself.
 */
export async function playWorld(engine: Engine | null) {
	if (!hasBackend() || !engine) return
	if (editor.dirty || !editor.filePath) {
		await saveMap(engine)
		if (editor.dirty || !editor.filePath) return
	}
	const cam = engine.camera
	const dir = cam.getWorldDirection(new THREE.Vector3())
	try {
		await PlayWorld(editor.filePath, playSpot(cam.position, dir))
		setStatus('Starting the game in this world where the camera is…', 5000)
	} catch (e) {
		setStatus(`The game didn't start: ${e}`, 10000)
	}
}
