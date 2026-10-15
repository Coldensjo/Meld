import type * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import { editor, setStatus } from '../state/editor.svelte'
import { CHUNK_CELLS } from '../terrain/chunkPaint'
import { CHUNK_IMPASSABLE, squaresUnder, type GridRect } from '../terrain/chunkFlags'
import { ChunkDataStroke } from './chunkDataStroke'
import { areaName } from '../wow/areas'

/**
 * The Map data tool paints what a chunk's header says besides its ground, into every chunk whose
 * centre is under the brush (or the chunk under the cursor when the brush is smaller than a chunk):
 * in Area mode the zone (AreaTable.dbc ID), which Clear sets back to none, and in Impassable mode the
 * impassable flag, which Clear takes off. No tufts works on cells instead: it marks the cells under
 * the brush as growing no ground effect doodads (as the client's roads are), and Clear lets them grow
 * again. Alt+click picks the zone under the cursor. A stroke is one undo step.
 */
export class MapDataTool implements Tool {
  readonly usesBrush = true
  private stroke: ChunkDataStroke | null = null
  private rect: GridRect = { x0: 0, z0: 0, x1: 0, z1: 0 }

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
    if (e.altKey) {
      if (hit && editor.mapDataMode === 'area') this.pickArea(ctx, hit)
      return
    }
    if (editor.mapDataMode === 'area' && !editor.mapDataClear && !editor.mapDataArea) {
      setStatus('Pick a zone in the options bar first, or Alt+click a chunk to take its zone.')
      return
    }
    this.stroke = new ChunkDataStroke(ctx.terrain, this.label())
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

  private label() {
    if (editor.mapDataMode === 'impassable') return editor.mapDataClear ? 'Make passable' : 'Mark impassable'
    if (editor.mapDataMode === 'noTufts') return editor.mapDataClear ? 'Grow tufts' : 'No tufts'
    return editor.mapDataClear ? 'Clear zone' : `Paint zone ${areaName(editor.mapDataArea)}`
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
    let changed = false
    const side = t.paintChunksPerSide
    const step = CHUNK_CELLS * t.cellSize
    const radius = editor.brush.radius
    if (editor.mapDataMode === 'noTufts') {
      const cs = t.cellSize
      const n = t.size
      // Saved before the write: the cells the brush's square covers.
      const b = this.rect
      b.x0 = Math.max(0, Math.floor((hit.x - radius) / cs))
      b.z0 = Math.max(0, Math.floor((hit.z - radius) / cs))
      b.x1 = Math.min(n - 1, Math.floor((hit.x + radius) / cs))
      b.z1 = Math.min(n - 1, Math.floor((hit.z + radius) / cs))
      if (b.x1 < b.x0 || b.z1 < b.z0) return
      this.stroke?.reserveCells(b)
      const v = editor.mapDataClear ? 0 : 1
      squaresUnder(n, cs, hit.x, hit.z, radius, this.rect, (i) => {
        if (t.noEffect[i] === v) return
        t.noEffect[i] = v
        changed = true
      })
      if (changed) this.stroke?.touchCells(this.rect)
    } else if (editor.mapDataMode === 'impassable') {
      const set = !editor.mapDataClear
      squaresUnder(side, step, hit.x, hit.z, radius, this.rect, (i) => {
        const f = set ? t.chunkFlags[i] | CHUNK_IMPASSABLE : t.chunkFlags[i] & ~CHUNK_IMPASSABLE
        if (f === t.chunkFlags[i]) return
        t.chunkFlags[i] = f
        changed = true
      })
    } else {
      const value = editor.mapDataClear ? 0 : editor.mapDataArea
      squaresUnder(side, step, hit.x, hit.z, radius, this.rect, (i) => {
        if (t.areaIds[i] === value) return
        t.areaIds[i] = value
        changed = true
      })
    }
    if (changed) t.touchChunkData()
  }
}
