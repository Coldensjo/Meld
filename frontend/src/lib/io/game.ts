// The game: which client Meld starts and how its window opens, the Benilla and VMaNGOS folders, Launch,
// Play Here and the port commands.
import { BrowseVmangosFolder, SaveTextDialog, WriteTextFile, GameClient, SetGameClient, GameWindow, SetGameWindow, BrowseBenillaFolder, SetBenillaPath, LaunchGame, LaunchGameAt, PlayHere, SetVmangosPath } from '../../../wailsjs/go/main/App'
import { guarded, hasBackend } from './backend'
import type { Engine } from '../engine/Engine'
import { editor, setStatus, ui } from '../state/editor.svelte'
import { formatPortCoords } from './portCoords'
import { areaName, loadAreas } from '../wow/areas'
import { vmangos } from '../../../wailsjs/go/models'
import { compileRegion, regionName, regionUncompiled } from './compile'

/** Reads which game client Meld uses into ui.gameClient (Game › Game Client). */
export async function refreshGameClient() {
	if (!hasBackend()) return
	try {
		ui.gameClient = (await GameClient()).client === 'benilla' ? 'benilla' : 'wow'
		const w = await GameWindow()
		ui.gameWindow = w.mode === 'windowed' || w.mode === 'fullscreen' ? w.mode : ''
		if (w.resolution) ui.gameResolution = w.resolution
	} catch {
		/* no backend */
	}
}

/** Picks the game Meld closes and opens around an export: the WoW client or Benilla. */
export async function setGameClient(client: 'wow' | 'benilla') {
	if (!hasBackend()) return
	try {
		await SetGameClient(client)
		await refreshGameClient()
		setStatus(client === 'benilla' ? 'Meld now closes and opens Benilla around an export, logged in with the saved Game Login.' : 'Meld now closes and opens World of Warcraft (Wow.exe) around an export.', 6000)
	} catch (e) {
		setStatus(`${e}`, 8000)
	}
}

/**
 * Sets how the game's window opens when Meld starts it (Game › Game Window): the game's own
 * setting, windowed or fullscreen, at `resolution`. Meld writes it into the game's own settings
 * (Benilla's config.toml, Wow.exe's Config.wtf) each time it starts the game.
 */
export async function setGameWindow(mode: '' | 'windowed' | 'fullscreen', resolution = ui.gameResolution) {
	if (!hasBackend()) return
	try {
		await SetGameWindow(mode, resolution)
		await refreshGameClient()
		const size = resolution.replace('x', '×')
		setStatus(mode === '' ? 'The game opens as its own Video options say.' : `The game opens ${mode === 'windowed' ? `in a ${size} window` : `fullscreen (${size} for Wow.exe)`} the next time Meld starts it.`, 6000)
	} catch (e) {
		setStatus(`${e}`, 8000)
	}
}

/** Picks the Benilla folder (its repository, with the release build in target/release). */
export async function chooseBenillaFolder() {
	if (!hasBackend()) return
	try {
		const dir = await BrowseBenillaFolder()
		if (!dir) return
		await SetBenillaPath(dir)
		const info = await GameClient()
		setStatus(info.benillaBuilt ? `Benilla folder: ${dir}. Pick Game › Benilla to use it.` : `Benilla folder: ${dir}, but it isn't built: run cargo build --release -p benilla there.`, 8000)
	} catch (e) {
		setStatus(`${e}`, 8000)
	}
}

/**
 * Opens the chosen game client now, logged in with the saved Game Login. With a saved character, it
 * enters the world where the camera is, when the open map is in the client.
 */
export async function launchGame(engine: Engine | null, opts: { anyway?: boolean } = {}) {
	if (!hasBackend()) return
	const game = ui.gameClient === 'benilla' ? 'Benilla' : 'World of Warcraft'
	// The game shows the client's tiles: an open region with edits they lack asks first (#214).
	if (engine && !opts.anyway && (await uncompiledName(engine))) {
		ui.dialog = 'compileBeforeLaunch'
		return
	}
	try {
		const spot = engine ? await engine.playerSpot() : null
		if (!spot) {
			await LaunchGame()
			setStatus(`Starting ${game}…`, 4000)
			return
		}
		// Placing the character can wait for the server to log it out.
		setStatus(`Starting ${game}…`, 20000)
		const placed = await LaunchGameAt(vmangos.CharacterSpot.createFrom(spot))
		setStatus(placed ? `Starting ${game} with ${placed} where the camera is…` : `Starting ${game}…`, 5000)
	} catch (e) {
		setStatus(`The game didn't start: ${e}`, 8000)
	}
}

/**
 * The active region's name when it has edits the client lacks (`regionUncompiled`), else ''; kept in
 * `ui.uncompiledRegion` for the launch dialog. A failed check (no client folder) doesn't stop a launch.
 */
async function uncompiledName(engine: Engine): Promise<string> {
	const region = engine.activeRegion()
	let stale = false
	try {
		stale = !!region && (await regionUncompiled(engine))
	} catch (e) {
		console.warn('compile check failed', e)
	}
	ui.uncompiledRegion = stale && region ? regionName(region) : ''
	return ui.uncompiledRegion
}

/** The launch dialog's Compile and Launch: Compile to Client, then the launch once the client has the edits. */
export async function compileAndLaunch(engine: Engine) {
	await compileRegion(engine, 'client')
	if (await uncompiledName(engine)) return
	await launchGame(engine, { anyway: true })
}

/**
 * Play here: moves the Game Login's character, in the world now, to where the camera is, through the
 * running world server, without closing the game. When it can't, the status bar says why and points
 * to Launch.
 */
export async function playHere(engine: Engine | null) {
	if (!hasBackend() || !engine) return
	try {
		const spot = await engine.playerSpot()
		if (!spot) {
			setStatus('Play here: the camera is not over a map that is in the client.', 6000)
			return
		}
		const moved = await PlayHere(vmangos.CharacterSpot.createFrom(spot))
		const stale = await uncompiledName(engine)
		setStatus(
			stale ? `Moved ${moved} to where the camera is. The game shows ${stale} without its latest edits: File › Compile to Client writes them (it restarts the game).` : `Moved ${moved} to where the camera is.`,
			stale ? 12000 : 4000,
		)
	} catch (e) {
		setStatus(`Play here didn't move the character: ${e}. Game › Launch puts it there by restarting the game.`, 12000)
	}
}

/** Asks for the VMaNGOS server folder that the map data is built in. */
export async function chooseVmangosFolder() {
	if (!hasBackend()) return
	try {
		const dir = await BrowseVmangosFolder()
		if (!dir) return
		await SetVmangosPath(dir)
		setStatus(`VMaNGOS folder: ${dir}`)
	} catch (e) {
		setStatus(`Not a VMaNGOS server folder: ${e}`, 8000)
	}
}

/** Saves the camera's place as the port commands for the map's server (see portCoords.ts). */
export function exportPortCoords(engine: Engine) {
	return guarded('Export port coordinates', async () => {
		const ref = engine.activeVmangos()
		if (!ref) {
			setStatus('Port commands need the map’s ID. Make the map with File › New World…', 8000)
			return
		}
		const path = await SaveTextDialog(editor.mapName)
		if (!path) return
		const at = engine.camera.position
		const area = engine.areaAt(at.x, at.z)
		if (area) await loadAreas()
		const o = engine.serverOrigin()
		await WriteTextFile(path, formatPortCoords(at, ref.mapId, area ? areaName(area) : '', o.x, o.y))
		setStatus(`Wrote the port commands for map ${ref.mapId} to ${path}.`)
	})
}
