import { pressed } from '../ui/commands'
import type * as THREE from 'three'
import { setStatus } from '../state/editor.svelte'
import type { ToolContext } from './Tool'
import { BrushTool, editor } from './BrushTool'
import { forEachTexel, paintPixel } from './brush'
import { wandClick } from './maskWand'
import { MAX_DABS, sprayAmount, sprayDabRadius, sprayDabs } from './spray'
import { SwapPaint } from './swapPaint'
import { mirrorOffset } from './symmetry'

export class PaintTool extends BrushTool {
	protected label = 'Paint'
	private erasing = false
	/** Swap mode (swapPaint.ts). */
	private swapper = new SwapPaint({
		stroke: () => this.stroke,
		splatChanged: (ctx, r) => this.splatChanged(ctx, r),
		chunkFull: () => this.chunkFull(),
	})

	protected get records() {
		return editor.paintMode === 'mask' ? { mask: true } : { splat: true }
	}

	/** The brush image shapes painting (not the spray's dabs, the swap or the mask). */
	imageShaped() {
		return editor.paintMode === 'texture' && !editor.paintSpray
	}

	/** Mask mode's wand (Select by other than Brush) clicks a spot instead of brushing, so no ring. */
	private get wand() {
		return editor.paintMode === 'mask' && editor.maskSelect.by !== 'brush'
	}

	get usesBrush() {
		return !this.wand
	}

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent) {
		if (this.wand) {
			// Shift adds to the mask, Alt (or Erase) takes away, a plain click replaces it.
			if (hit) wandClick(ctx.terrain, ctx.liquids, ctx.history, hit, e?.shiftKey ? 'add' : e?.altKey || editor.maskErase ? 'subtract' : 'replace')
			return
		}
		this.label = editor.paintMode === 'mask' ? 'Mask' : editor.paintMode === 'swap' ? 'Swap' : 'Paint'
		this.erasing = editor.maskErase || !!e?.altKey
		this.swapper.start(ctx.terrain, hit)
		super.onDown(ctx, hit)
	}

	protected apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
		if (editor.paintMode === 'swap') {
			this.swapper.apply(ctx, dt, hit)
			return
		}
		if (editor.paintMode === 'mask') {
			// Mask brush: hard-edged by falloff, full strength; Alt (or Erase) removes.
			const { radius, falloff } = editor.brush
			const m = ctx.terrain.mask
			const erase = this.erasing
			const rect = forEachTexel(
				ctx.terrain,
				hit.x,
				hit.z,
				radius,
				falloff,
				(p, w) => {
					const v = Math.round(w * 255)
					m[p] = erase ? Math.min(m[p], 255 - v) : Math.max(m[p], v)
				},
				this.stroke,
			)
			if (rect) {
				ctx.terrain.markMaskDirty(rect)
				this.stroke?.touchMask(rect)
			}
			return
		}
		const { radius, falloff } = editor.brush
		const strength = editor.brush.strength * ctx.pressure()
		if (!editor.paintSpray) {
			if (this.paintAt(ctx, hit.x, hit.z, radius, falloff, Math.min(1, strength * dt * 5))) this.chunkFull()
			return
		}
		// Spray: random dabs over the brush, plus the brush's solid centre when Inner radius is on.
		const t = ctx.terrain
		const { size, pressure, inner } = editor.spray
		const dab = sprayDabRadius(size, t.worldSize / t.splatRes)
		const amt = sprayAmount(strength)
		const n = this.sprayCopy(hit, radius, dab, pressure, dt)
		let refused = false
		for (let i = 0; i < n; i++) refused = this.paintAt(ctx, this.dabs[i * 2], this.dabs[i * 2 + 1], dab, falloff, amt) || refused
		if (inner && falloff < 1) refused = this.paintAt(ctx, hit.x, hit.z, radius * (1 - falloff), falloff, Math.min(1, strength * dt * 5)) || refused
		if (refused) this.chunkFull()
	}

	/** Spray dab centres for one frame, as x, z pairs. */
	private dabs = new Float32Array(MAX_DABS * 2)
	/** The stroke's own copy's dabs this tick, as offsets from its centre, and how many: a symmetric stroke's other copies (#182) spray them mirrored. */
	private dabOffsets = new Float32Array(MAX_DABS * 2)
	private dabCount = 0
	private off = new Float64Array(2)

	/** Fills `dabs` with this tick's spray dabs about `hit`: new random ones for the stroke's own copy, the same ones mirrored for the others. */
	private sprayCopy(hit: THREE.Vector3, radius: number, dab: number, pressure: number, dt: number): number {
		const d = this.dabs
		const o = this.dabOffsets
		if (this.mirrorIndex === 0) {
			const n = sprayDabs(hit.x, hit.z, radius, dab, pressure, dt, Math.random, d)
			for (let i = 0; i < n; i++) {
				o[i * 2] = d[i * 2] - hit.x
				o[i * 2 + 1] = d[i * 2 + 1] - hit.z
			}
			this.dabCount = n
			return n
		}
		const n = this.dabCount
		for (let i = 0; i < n; i++) {
			mirrorOffset(this.mirror, o[i * 2], o[i * 2 + 1], this.off)
			d[i * 2] = hit.x + this.off[0]
			d[i * 2 + 1] = hit.z + this.off[1]
		}
		return n
	}

	/** Paints the active layer in a circle. Returns true when a chunk refused it for having four textures. */
	private paintAt(ctx: ToolContext, x: number, z: number, radius: number, falloff: number, amt: number): boolean {
		const tex = editor.paintLayer
		let refused = false
		const rect = forEachTexel(
			ctx.terrain,
			x,
			z,
			radius,
			falloff,
			(p, w) => {
				if (!paintPixel(ctx.terrain, p, tex, amt * w)) refused = true
			},
			this.stroke,
		)
		this.splatChanged(ctx, rect)
		return refused
	}

	onKey(_ctx: ToolContext, e: KeyboardEvent) {
		if (!pressed('spray', e)) return false
		editor.paintSpray = !editor.paintSpray
		if (editor.paintSpray) editor.paintMode = 'texture'
		setStatus(editor.paintSpray ? 'Spray on' : 'Spray off', 1500)
		return true
	}
}
