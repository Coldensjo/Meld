import * as THREE from 'three'
import { copyToolSettings, editor, prefs, setStatus } from '../state/editor.svelte'
import type { Tool, ToolContext } from './Tool'
import { TerrainStroke } from './brush'
import { PaintTool, SculptTool, withSettings, type ToolSettings } from './TerrainTools'
import { applyItem, type BrushStack, type StackItem } from './brushStack'
import { paletteIndex } from '../terrain/chunkPaint'

/** The brush stack the Stamp tool applies: the one `prefs.brushStack` names, else the first. */
export function activeBrushStack(): BrushStack | undefined {
	return prefs.brushStacks.find((s) => s.name === prefs.brushStack) ?? prefs.brushStacks[0]
}

/**
 * The Stamp tool (Noggit Red's stamp with its brush stack): while the button is held, every brush of the
 * active stack that is on applies under the cursor in order, sculpting or painting with its own settings
 * or the stack's (the tool's own brush size, strength and the image brush's turn), all in one stroke and
 * one undo step. Each brush runs the Sculpt or Paint tool's own code, reading a copy of the editor's
 * settings made when the stroke starts (`withSettings`), so nothing is written to the editor per frame.
 */
export class StampTool implements Tool {
	readonly usesBrush = true
	/** A Sculpt and a Paint tool per stack brush of that kind (each keeps its own stroke state, as Flatten's target), reused stroke to stroke. */
	private sculpts: SculptTool[] = []
	private paints: PaintTool[] = []
	private stroke: TerrainStroke | null = null
	/** The stack's brushes for this stroke: the tool each runs on, and its settings. */
	private run: Array<{ tool: SculptTool | PaintTool; settings: ToolSettings }> = []

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null) {
		if (!hit) return
		const stack = activeBrushStack()
		const items = stack?.items.filter((i) => i.on) ?? []
		if (!items.length) {
			setStatus(stack ? `The stack "${stack.name}" has no brush switched on.` : 'Make a brush stack first (New stack in the options bar).', 4000)
			return
		}
		const cs = ctx.terrain.cellSize
		this.stroke = new TerrainStroke(ctx.terrain, `Stamp ${stack!.name}`, { heights: true, splat: true }, (r) => ctx.objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs))
		const base = copyToolSettings()
		const brush = { radius: editor.brush.radius, strength: editor.brush.strength, rotation: editor.brushImage.rotation }
		this.run = []
		let missing = 0
		let ns = 0
		let np = 0
		for (const item of items) {
			const tex = item.tool === 'paint' ? paletteIndex(editor.palette, item.texture) : 0
			if (item.tool === 'paint' && tex < 0) {
				missing++
				continue
			}
			const settings = applyItem(structuredClone(base), item, brush, tex)
			let tool: SculptTool | PaintTool
			if (item.tool === 'sculpt') tool = this.sculpts[ns++] ??= new SculptTool()
			else tool = this.paints[np++] ??= new PaintTool()
			this.run.push({ tool, settings })
		}
		if (missing) setStatus(`${missing} paint brush${missing === 1 ? '' : 'es'} of the stack use a texture this map hasn't got yet: pick it in the asset browser first.`, 5000)
		this.forEach(ctx, (tool) => {
			tool.onDown(ctx, hit)
			tool.useStroke(this.stroke!)
		})
	}

	tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
		if (!this.stroke || !hit) return
		this.forEach(ctx, (tool) => tool.tick(ctx, dt, hit))
	}

	onUp(ctx: ToolContext) {
		if (!this.stroke) return
		this.forEach(ctx, (tool) => tool.releaseStroke())
		const cmd = this.stroke.finish()
		this.stroke = null
		this.run = []
		if (cmd) ctx.history.push(cmd)
	}

	/** Runs `fn` for each brush of the stroke, with the brush tools reading that brush's settings. */
	private forEach(_ctx: ToolContext, fn: (tool: SculptTool | PaintTool) => void) {
		for (const r of this.run) withSettings(r.settings, () => fn(r.tool))
	}
}

export type { StackItem }
