import type * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import { editor, setStatus, ui } from '../state/editor.svelte'
import { displayName } from '../models/assets'
import type { WorldObject } from '../world/ObjectLayer'
import { layerAt } from './TerrainTools'
import { loadCreatureTemplates, loadObjectTemplates, creatureKey, objectKey } from '../../components/SpawnBrowser.svelte'
import { spawnType } from '../world/spawnInfo'
import type { vmangos } from '../../../wailsjs/go/models'

// The pipette: Alt+click picks what is under the cursor. In the Select and Place tools, a model's type
// becomes the model to place and the ground's texture becomes the paint texture; in Paint and Road,
// the ground's texture.

/**
 * Makes the texture under a terrain point the active layer. Returns false when no texture is there.
 * Alt+click in Select, Place, Paint and Road uses it.
 */
export function pickLayer(t: Terrain, hit: THREE.Vector3): boolean {
	const i = layerAt(t, hit.x, hit.z)
	if (i < 0) {
		setStatus('No texture at that spot.', 2000)
		return false
	}
	editor.paintLayer = i
	const p = editor.palette[i]
	if (!p.startsWith('#')) revealAsset(`tex:${p}`)
	const name = p.startsWith('#') ? p : p.slice(p.search(/[^\/]*$/)).replace(/\.blp$/i, '')
	setStatus(`Picked ${name}`, 2000)
	return true
}

/** Asks the asset browser to show `key` (a catalog key) and scroll to it. */
function revealAsset(key: string) {
	ui.revealAsset = { key, seq: (ui.revealAsset?.seq ?? 0) + 1 }
}

/** Makes a placed model's type the model to place next and switches to the Place tool (Alt+click on it). */
export function pickModel(o: WorldObject) {
	editor.prefab = o.type
	ui.placeCreature = ui.placeObject = null
	editor.tool = 'place'
	revealAsset(o.type)
	setStatus(`Picked ${displayName(o.type)}: click to place more.`, 3000)
}

/**
 * Makes a spawn's template (creature or game object) what the Place tool puts down next, from the
 * browser's lists, and shows it in the browser (Alt+click on a creature or object of the region).
 */
export async function pickSpawn(s: vmangos.WorldSpawn) {
	try {
		if (s.kind === 'object') {
			const t = (await loadObjectTemplates()).find((x) => x.entry === s.entry)
			if (!t) return setStatus(`Object ${s.entry} is not in the world database's templates.`, 4000)
			ui.placeObject = t
			ui.placeCreature = null
			editor.prefab = spawnType({ model: t.model })
			revealAsset(objectKey(t))
		} else {
			const t = (await loadCreatureTemplates()).find((x) => x.entry === s.entry)
			if (!t) return setStatus(`Creature ${s.entry} is not in the world database's templates.`, 4000)
			ui.placeCreature = t
			ui.placeObject = null
			editor.prefab = spawnType({ model: t.model, look: t.look })
			revealAsset(creatureKey(t))
		}
		editor.tool = 'place'
		setStatus(`Picked ${s.name}: click to place more.`, 3000)
	} catch (err) {
		setStatus(`Could not pick ${s.name}: ${err}`, 6000)
	}
}
