// Publishing a map made for the client, and Save, which publishes one.
import { PublishVmangosMap } from '../../../wailsjs/go/main/App'
import { guarded } from './backend'
import type { Engine } from '../engine/Engine'
import { editor, setStatus, ui } from '../state/editor.svelte'
import { savingDetail, startSaving } from '../state/saving'
import { mapToTiles, type ExportObject } from './vmangosExport'
import { TILE_SIZE, teleportCommand, wmoOnlyTiles } from './portCoords'
import { maskBytes } from '../terrain/tileMask'
import { TILE_CELLS } from '../wow/format'
import { vmangos } from '../../../wailsjs/go/models'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { saveMap } from './mapio'

/** The `.go` line the last publish's message gives: the map's start, or a WMO-only map's building. */
let lastGo = ''
/** Clears the Saving bar of the publish running in the background; a no-op when none is. */
let endPublish = () => {}
let listening = false

/** Routes progress from the background publish to the status bar, once. */
function listenToPublish() {
	if (listening) return
	listening = true
	EventsOn('publish:log', (line: string) => {
		setStatus(line, 0)
		savingDetail(line)
	})
	EventsOn('publish:done', (msg: string) => {
		ui.busy = false
		endPublish()
		if (msg) setStatus(`Publish failed: ${msg}`, 0)
		else setStatus(`Map published. Start the world server and the game, then type ${lastGo} in the game to go there.`, 15000)
	})
}

/**
 * Publishes a map made for the client: it's written into the client's patch, added to the server, and the
 * server's map data is extracted again before the world server restarts. Runs in the background.
 */
export function publishVmangosMap(engine: Engine) {
	return guarded('Publish', async () => {
		const ref = engine.activeVmangos()
		if (!ref) {
			setStatus('Only a map made for the client publishes this way. Make one with File › New World…')
			return
		}
		listenToPublish()
		const input = engine.exportInput()
		// The map's place on the client's grid and the tiles of its square it leaves out (#46).
		const n = input.size / TILE_CELLS
		const present = maskBytes(ref.tiles, n)
		const tx0 = ref.tileX ?? 0
		const ty0 = ref.tileY ?? 0
		const out = mapToTiles(input, { x: tx0, y: ty0, present })
		const notes: string[] = []
		if (out.colorChunks) notes.push(`${out.colorChunks} chunks painted with a colour were left out`)
		if (out.outside) notes.push(`${out.outside} models outside the map were left out`)
		// A WMO-only map is its first building: the WDT places it, and the map has no tiles.
		let global: ExportObject | undefined
		if (ref.info?.wmoOnly) {
			global = input.objects.find((o) => o.type.startsWith('wmo:'))
			if (!global) {
				setStatus('A WMO-only map needs a building (a WMO) on it: place one first, or untick WMO-only in Map Properties.', 6000)
				return
			}
			out.tiles = []
		}
		// A WMO-only map's building goes to the world's middle (#272), so the line points there, a little
		// over its origin; another map's points at the middle of its first tile, over the ground or the sea.
		const at = global && wmoOnlyTiles(global)
		if (global && at) lastGo = teleportCommand({ x: global.x, y: global.y + 2, z: global.z }, ref.mapId, at.x, at.y)
		else {
			const first = present ? Math.max(0, present.indexOf(1)) : 0
			const x = ((first % n) + 0.5) * TILE_SIZE
			const z = (Math.floor(first / n) + 0.5) * TILE_SIZE
			const y = Math.max(engine.terrain.heightAt(x, z), input.waterEnabled ? input.waterLevel : -Infinity) + 10
			lastGo = teleportCommand({ x, y, z }, ref.mapId, tx0, ty0)
		}
		ui.busy = true
		endPublish = startSaving(`Publishing ${ref.dir}`)
		setStatus(`Publishing ${ref.dir}…${notes.length ? ' ' + notes.join('. ') + '.' : ''}`, 0)
		try {
			await PublishVmangosMap(
				vmangos.MapSpec.createFrom({
					Dir: ref.dir,
					MapID: ref.mapId,
					Tiles: out.tiles,
					Water: input.waterEnabled,
					WaterLevel: input.waterLevel,
					Info: ref.info,
					Global: global ? { Type: global.type, X: global.x, Y: global.y, Z: global.z, RotY: global.rotY, TiltX: global.tiltX ?? 0, TiltZ: global.tiltZ ?? 0, Scale: global.scale } : undefined,
				}),
			)
		} catch (e) {
			ui.busy = false
			endPublish()
			throw e
		}
	})
}

/**
 * Save for a map made for the client is a publish: it asks first, because the world server stops and
 * players are disconnected. Other maps just save.
 */
export function saveOrPublish(engine: Engine, saveAs = false) {
	if (!saveAs && engine.activeVmangos()) {
		ui.dialog = 'publish'
		return
	}
	return saveMap(engine, saveAs)
}

/** Saves the map, then publishes it, if the save went through. */
export async function saveAndPublish(engine: Engine) {
	await saveMap(engine)
	if (!editor.dirty) await publishVmangosMap(engine)
}
