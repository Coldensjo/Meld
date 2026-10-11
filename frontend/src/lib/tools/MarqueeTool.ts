import type * as THREE from 'three'
import { editor, ui } from '../state/editor.svelte'
import type { Tool, ToolContext } from './Tool'

/**
 * Rectangular map selection (Photoshop's marquee). Drag to select a cell
 * rect; while pasting, a floating rect follows the cursor and a click drops it.
 */
export class MarqueeTool implements Tool {
  readonly usesBrush = false
  private start: { x: number; z: number } | null = null
  /** Where the floating paste would land (corner cell), updated every frame. */
  pasteAt: { x: number; z: number } | null = null

  constructor(
    private hooks: {
      clipSize: () => { w: number; h: number } | null
      commitPaste: () => void
      cancelPaste: () => void
    },
  ) {}

  private cell(ctx: ToolContext, hit: THREE.Vector3) {
    const cs = ctx.terrain.cellSize
    const n = ctx.terrain.size
    return {
      x: Math.min(n, Math.max(0, Math.round(hit.x / cs))),
      z: Math.min(n, Math.max(0, Math.round(hit.z / cs))),
    }
  }

  deactivate() {
    this.start = null
    if (ui.pasting) this.hooks.cancelPaste()
  }

  onDown(ctx: ToolContext, hit: THREE.Vector3 | null) {
    if (!hit) return
    if (ui.pasting) {
      this.hooks.commitPaste()
      return
    }
    this.start = this.cell(ctx, hit)
    editor.selection = { x0: this.start.x, z0: this.start.z, x1: this.start.x, z1: this.start.z }
  }

  onMove(ctx: ToolContext, hit: THREE.Vector3 | null) {
    if (!this.start || !hit) return
    const c = this.cell(ctx, hit)
    editor.selection = {
      x0: Math.min(this.start.x, c.x),
      z0: Math.min(this.start.z, c.z),
      x1: Math.max(this.start.x, c.x),
      z1: Math.max(this.start.z, c.z),
    }
  }

  onUp() {
    const s = editor.selection
    // A plain click (no area) clears the selection.
    if (this.start && s && (s.x1 === s.x0 || s.z1 === s.z0)) editor.selection = null
    this.start = null
  }

  frame(ctx: ToolContext, hit: THREE.Vector3 | null) {
    const size = ui.pasting ? this.hooks.clipSize() : null
    if (!size || !hit) return
    const cs = ctx.terrain.cellSize
    this.pasteAt = { x: Math.round(hit.x / cs - size.w / 2), z: Math.round(hit.z / cs - size.h / 2) }
  }

  onKey(_ctx: ToolContext, e: KeyboardEvent) {
    if (ui.pasting) {
      if (e.key === 'Escape') this.hooks.cancelPaste()
      else if (e.key === 'Enter') this.hooks.commitPaste()
      else if (e.key === 'PageUp') editor.paste.heightOffset += e.shiftKey ? 5 : 1
      else if (e.key === 'PageDown') editor.paste.heightOffset -= e.shiftKey ? 5 : 1
      else return false
      return true
    }
    if (e.key === 'Escape' && editor.selection) {
      editor.selection = null
      return true
    }
    return false
  }
}
