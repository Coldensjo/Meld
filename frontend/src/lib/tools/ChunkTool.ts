import type * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import { editor } from '../state/editor.svelte'
import { CHUNK_CELLS } from '../terrain/chunkPaint'

/** Click a spot on the terrain to pick the paint chunk under it; the Layers panel lists its textures. */
export class ChunkTool implements Tool {
  readonly usesBrush = false

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null) {
    if (!hit) return
    const t = ctx.terrain
    const side = t.paintChunksPerSide
    const size = CHUNK_CELLS * t.cellSize
    const cx = Math.min(side - 1, Math.max(0, Math.floor(hit.x / size)))
    const cz = Math.min(side - 1, Math.max(0, Math.floor(hit.z / size)))
    editor.chunkSel = cz * side + cx
  }
}
