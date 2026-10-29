import * as THREE from 'three'
import type { ToolContext } from './Tool'
import { BrushTool, editor, keeps } from './BrushTool'
import { forEachVertex, type Rect } from './brush'
import { OCEAN_OPACITY, RIVER_OPACITY, autoOpacity, newLiquidBrush, paintLiquid } from '../water/liquids'
import { LiquidStroke } from '../water/liquidStroke'

/** The depth factor the water brush's opacity setting picks for liquid `id`. */
export function waterOpacityFactor(id: number): number {
	const w = editor.water
	switch (w.opacity) {
		case 'river':
			return RIVER_OPACITY
		case 'ocean':
			return OCEAN_OPACITY
		case 'custom':
			return w.customOpacity
		default:
			return autoOpacity(id)
	}
}

/**
 * The Water tool. In Paint mode it is noggit's water brush: LMB adds the chosen liquid under the brush,
 * Ctrl+LMB removes liquid (see paintLiquid). Dig lake and Raise shore shape the ground relative to the
 * sea level instead.
 */
export class WaterTool extends BrushTool {
	protected label = 'Water'
	protected records = { heights: true }
	private liquidStroke: LiquidStroke | null = null
	private removing = false
	/** The brush handed to paintLiquid, filled in each tick rather than built anew. */
	private liquidBrush = newLiquidBrush()

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent) {
		if (editor.waterMode !== 'paint') return super.onDown(ctx, hit)
		if (!hit) return
		this.removing = !!e?.ctrlKey
		this.liquidStroke = new LiquidStroke(ctx.liquids, this.removing ? 'Remove water' : 'Paint water')
	}

	onUp(ctx: ToolContext) {
		if (!this.liquidStroke) return super.onUp(ctx)
		const cmd = this.liquidStroke.finish()
		this.liquidStroke = null
		if (cmd) ctx.history.push(cmd)
	}

	tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
		if (!this.liquidStroke) return super.tick(ctx, dt, hit)
		if (!hit) return
		const w = editor.water
		const deg = THREE.MathUtils.degToRad
		const b = this.liquidBrush
		b.x = hit.x
		b.y = hit.y
		b.z = hit.z
		b.radius = editor.brush.radius
		b.id = w.liquid
		b.add = !this.removing
		b.angle = w.angled ? deg(w.angle) : 0
		b.orientation = w.angled ? deg(w.orientation) : 0
		b.lock = w.lock
		b.origin = w.lockPos
		b.overrideHeight = w.overrideHeight
		b.overrideId = w.overrideId
		b.opacity = waterOpacityFactor(w.liquid)
		paintLiquid(ctx.liquids, ctx.terrain, b, this.liquidStroke.reserve)
	}

	protected apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
		const t = ctx.terrain
		const h = t.heights
		const { radius, strength, falloff } = editor.brush
		const k = Math.min(1, strength * dt * 4)
		const lvl = editor.waterLevel
		const limit = editor.sculptLimit
		const cursorY = hit.y
		let rect: Rect | null
		if (editor.waterMode === 'dig') {
			const floor = lvl - 4
			rect = forEachVertex(
				t,
				hit.x,
				hit.z,
				radius,
				falloff,
				(i, w) => {
					if (h[i] > floor && keeps(h[i], limit, cursorY)) h[i] += (floor - h[i]) * w * k
				},
				this.stroke,
			)
		} else {
			const shore = lvl + 0.6
			rect = forEachVertex(
				t,
				hit.x,
				hit.z,
				radius,
				falloff,
				(i, w) => {
					if (h[i] < shore && keeps(h[i], limit, cursorY)) h[i] += (shore - h[i]) * w * k
				},
				this.stroke,
			)
		}
		this.heightsChanged(ctx, rect)
	}
}
