import type * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import { editor, setStatus } from '../state/editor.svelte'
import { displayName } from '../models/assets'
import type { WorldObject } from '../world/ObjectLayer'
import { layerAt } from './TerrainTools'

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
  const name = p.startsWith('#') ? p : p.slice(p.search(/[^\/]*$/)).replace(/\.blp$/i, '')
  setStatus(`Picked ${name}`, 2000)
  return true
}

/** Makes a placed model's type the model to place next and switches to the Place tool (Alt+click on it). */
export function pickModel(o: WorldObject) {
  editor.prefab = o.type
  editor.tool = 'place'
  setStatus(`Picked ${displayName(o.type)}: click to place more.`, 3000)
}
