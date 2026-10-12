import type * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import type { Terrain } from '../terrain/Terrain'
import { editor, setStatus } from '../state/editor.svelte'
import { layerAt } from './TerrainTools'

/**
 * Makes the texture under a terrain point the active layer. Returns false when no texture is there.
 * The Pipette tool and Alt+click in Paint and Road both use it.
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

/** Click the terrain to pick its texture as the active layer, then go back to painting. */
export class PipetteTool implements Tool {
  readonly usesBrush = false

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null) {
    if (!hit || !pickLayer(ctx.terrain, hit)) return
    editor.tool = 'paint'
  }
}
