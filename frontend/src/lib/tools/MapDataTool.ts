import type * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import { editor, setStatus } from '../state/editor.svelte'
import { CHUNK_CELLS } from '../terrain/chunkPaint'
import { squaresUnder, type GridRect } from '../terrain/chunkFlags'
import { ChunkDataStroke } from './chunkDataStroke'
import { areaName } from '../wow/areas'

/**
 * The Map data tool paints what a chunk's header says besides its ground: in Area mode, the zone
 * (AreaTable.dbc ID) of every chunk whose centre is under the brush, or of the chunk under the cursor
 * when the brush is smaller than a chunk. Clear sets it back to none. Alt+click picks the zone under
 * the cursor. A stroke is one undo step.
 */
export class MapDataTool implements Tool {
  readonly usesBrush = true
  private stroke: ChunkDataStroke | null = null
  private rect: GridRect = { x0: 0, z0: 0, x1: 0, z1: 0 }

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
    if (e.altKey) {
      if (hit) this.pickArea(ctx, hit)
      return
    }
    if (editor.mapDataMode === 'area' && !editor.mapDataClear && !editor.mapDataArea) {
      setStatus('Pick a zone in the options bar first, or Alt+click a chunk to take its zone.')
      return
    }
    this.stroke = new ChunkDataStroke(ctx.terrain, editor.mapDataClear ? 'Clear zone' : `Paint zone ${areaName(editor.mapDataArea)}`)
    this.apply(ctx, hit)
  }

  tick(ctx: ToolContext, _dt: number, hit: THREE.Vector3 | null) {
    if (this.stroke) this.apply(ctx, hit)
  }

  onUp(ctx: ToolContext) {
    const cmd = this.stroke?.finish() ?? null
    this.stroke = null
    if (cmd) ctx.history.push(cmd)
  }

  /** Takes the zone of the chunk under the cursor as the one to paint. */
  private pickArea(ctx: ToolContext, hit: THREE.Vector3) {
    const t = ctx.terrain
    const step = CHUNK_CELLS * t.cellSize
    const side = t.paintChunksPerSide
    const cx = Math.floor(hit.x / step)
    const cz = Math.floor(hit.z / step)
    if (cx < 0 || cz < 0 || cx >= side || cz >= side) return
    const id = t.areaIds[cz * side + cx]
    if (!id) {
      setStatus('That chunk has no zone.')
      return
    }
    editor.mapDataArea = id
    editor.mapDataClear = false
    setStatus(`Painting ${areaName(id)} (${id}).`)
  }

  private apply(ctx: ToolContext, hit: THREE.Vector3 | null) {
    if (!hit) return
    const t = ctx.terrain
    const value = editor.mapDataClear ? 0 : editor.mapDataArea
    let changed = false
    squaresUnder(t.paintChunksPerSide, CHUNK_CELLS * t.cellSize, hit.x, hit.z, editor.brush.radius, this.rect, (i) => {
      if (t.areaIds[i] === value) return
      t.areaIds[i] = value
      changed = true
    })
    if (changed) t.touchChunkData()
  }
}
