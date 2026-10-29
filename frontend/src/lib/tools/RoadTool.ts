import type * as THREE from 'three'
import type { ToolContext } from './Tool'
import { BrushTool, editor, keeps } from './BrushTool'
import { forEachTexel, forEachVertex, paintPixel } from './brush'

/** Paints the selected texture with a hard edge and levels the ground across it. */
export class RoadTool extends BrushTool {
	protected label = 'Road'
	protected records = { heights: true, splat: true }

	radius() {
		return Math.max(1.5, editor.brush.radius * 0.5)
	}

	protected apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
		const t = ctx.terrain
		const { strength } = editor.brush
		const width = this.radius()
		const amt = Math.min(1, strength * dt * 8)
		let refused = 0
		const sr = forEachTexel(
			t,
			hit.x,
			hit.z,
			width,
			0.25,
			(p, w) => {
				if (!paintPixel(t, p, editor.paintLayer, amt * w)) refused++
			},
			this.stroke,
		)
		if (refused) this.chunkFull()
		this.splatChanged(ctx, sr)

		if (editor.roadFlatten) {
			const target = t.heightAt(hit.x, hit.z)
			const k = Math.min(1, strength * dt * 6)
			const h = t.heights
			const limit = editor.sculptLimit
			const cursorY = hit.y
			const hr = forEachVertex(
				t,
				hit.x,
				hit.z,
				width * 1.4,
				0.5,
				(i, w) => {
					if (keeps(h[i], limit, cursorY)) h[i] += (target - h[i]) * w * k
				},
				this.stroke,
			)
			this.heightsChanged(ctx, hr)
		}
	}
}
