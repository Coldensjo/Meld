import * as THREE from 'three'
import { editor, setStatus } from '../state/editor.svelte'
import { rasterPolygon } from '../terrain/areaShape'
import type { MaskOp } from '../terrain/maskSelect'
import type { ToolContext } from './Tool'

/** How an area drawn from press `e` meets the area there is: Shift adds, Ctrl subtracts, a plain press replaces (#183, #712). */
export const pressOp = (e: PointerEvent): MaskOp => (e.shiftKey ? 'add' : e.ctrlKey ? 'subtract' : 'replace')

/**
 * The Select tool's lasso and polygon (#183): the outline being dragged or clicked over the ground,
 * drawn closed back to its start, and turned into cells once closed. `commit` is the Select tool's,
 * which makes those cells the selected area (added or taken away by `op`) with the models in it.
 */
export class AreaOutline {
	/** Its points (world x, z pairs), whether it adds to the area or takes from it, and whether it is a polygon. */
	private shape: { pts: number[]; op: MaskOp; polygon: boolean } | null = null
	/** The outline drawn over the ground while it is made, closed back to its start. */
	private line = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffe36b, depthTest: false, transparent: true }))
	private pos = new Float32Array(0)

	constructor(private commit: (ctx: ToolContext, drawn: Uint8Array, op: MaskOp) => void) {
		this.line.renderOrder = 30
		this.line.frustumCulled = false
		this.line.visible = false
	}

	/** A polygon is open: every click is its next corner. */
	get polygon() {
		return !!this.shape?.polygon
	}

	/** A lasso is being dragged. */
	get lasso() {
		return !!this.shape && !this.shape.polygon
	}

	attach(scene: THREE.Scene) {
		scene.add(this.line)
	}

	detach(scene: THREE.Scene) {
		this.shape = null
		this.line.visible = false
		scene.remove(this.line)
	}

	dispose() {
		this.line.geometry.dispose()
		this.line.material.dispose()
	}

	/**
	 * A press on the ground with the lasso or polygon: starts the outline, or for a polygon adds a point
	 * and closes it on a double-click or a click near its first point.
	 */
	press(ctx: ToolContext, at: THREE.Vector3, e: PointerEvent) {
		const o = this.shape
		if (o?.polygon) {
			const p = o.pts
			const near = ctx.terrain.cellSize * 1.5
			const dx = at.x - p[0]
			const dz = at.z - p[1]
			if (e.detail >= 2 || (p.length >= 6 && dx * dx + dz * dz <= near * near)) this.close(ctx)
			else p.push(at.x, at.z)
			return
		}
		this.shape = { pts: [at.x, at.z], op: pressOp(e), polygon: editor.selectShape === 'polygon' }
		if (this.shape.polygon) setStatus('Click the corners. Enter or a click on the first corner closes the polygon; Backspace drops the last corner, Esc cancels.', 6000)
	}

	/** The lasso reaches `at`: a point is added once it is half a cell from the last. */
	extend(ctx: ToolContext, at: THREE.Vector3) {
		const o = this.shape
		if (!o) return
		const p = o.pts
		const dx = at.x - p[p.length - 2]
		const dz = at.z - p[p.length - 1]
		const step = ctx.terrain.cellSize * 0.5
		if (dx * dx + dz * dz >= step * step) p.push(at.x, at.z)
	}

	/** Turns the outline into the selected area (added or taken away by its op), with the models in it. */
	close(ctx: ToolContext) {
		const o = this.shape
		this.shape = null
		if (!o) return
		const t = ctx.terrain
		const drawn = new Uint8Array(t.size * t.size)
		rasterPolygon(o.pts, t.cellSize, t.size, drawn)
		this.commit(ctx, drawn, o.op)
	}

	/** Drops the outline (Esc). */
	cancel() {
		this.shape = null
	}

	/** Drops the polygon's last corner (Backspace), and the polygon with its first. */
	dropLast() {
		if (!this.shape) return
		this.shape.pts.length -= 2
		if (!this.shape.pts.length) this.shape = null
	}

	/**
	 * Draws the outline being made, a polygon's last side following the cursor; or, with none, `rect`
	 * (an add or subtract rect drag's sides as world x, z pairs) when given.
	 */
	draw(ctx: ToolContext, hit: THREE.Vector3 | null, rect: number[] | null) {
		const o = this.shape
		const t = ctx.terrain
		const pts = o ? o.pts : rect
		this.line.visible = !!pts
		if (!pts) return
		const n = pts.length / 2
		const count = n + (o?.polygon && hit ? 1 : 0)
		if (this.pos.length < count * 3) {
			this.pos = new Float32Array(Math.max(64, count * 6))
			this.line.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
		}
		const pos = this.pos
		for (let i = 0; i < count; i++) {
			const x = i < n ? pts[i * 2] : hit!.x
			const z = i < n ? pts[i * 2 + 1] : hit!.z
			pos[i * 3] = x
			pos[i * 3 + 1] = t.heightAt(x, z) + 0.3
			pos[i * 3 + 2] = z
		}
		this.line.geometry.getAttribute('position').needsUpdate = true
		this.line.geometry.setDrawRange(0, count)
	}
}
