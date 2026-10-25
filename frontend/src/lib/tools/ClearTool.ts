import type * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import { editor } from '../state/editor.svelte'
import { removedCommand } from '../world/objectCommands'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import { TerrainStroke, forEachTexel, forEachVertex, type Rect } from './brush'
import { CHUNK_CELLS, SLOTS, dropFaintLayers, resetTexel } from '../terrain/chunkPaint'
import { LiquidStroke } from '../water/liquidStroke'
import { newLiquidBrush, paintLiquid } from '../water/liquids'
import { HOLE_BLOCK, countHoles, fillHoles } from '../terrain/holes'

/**
 * Clear erases what the brush covers, after noggit's clear tools. "models" removes the placed models
 * whose ground point is in the brush, with anything attached to them; "textures" resets the paint to
 * each chunk's base texture (weight to slot 0); "heights" brings the ground to zero (noggit's
 * clearHeight), weighted by the brush; "liquids" removes every painted liquid under the brush; and
 * "holes" fills the hole blocks under it. A stroke is one undo step.
 */
export class ClearTool implements Tool {
	readonly usesBrush = true
	private held = false
	private stroke: TerrainStroke | null = null
	private liquidStroke: LiquidStroke | null = null
	/** The remove-all brush handed to paintLiquid, moved to the cursor each tick. */
	private liquidBrush = newLiquidBrush()
	private removed: WorldObject[] = []
	/** Scratch for `modelsIn`. */
	private near: WorldObject[] = []
	/** The object layer the stroke started on: undo must restore that map, not whichever tab is active then. */
	private objects: ObjectLayer | null = null
	private cellRect: Rect = { x0: 0, z0: 0, x1: 0, z1: 0 }
	/**
	 * In Models mode, the models a stroke at the cursor would remove, which the Engine marks red
	 * (#131). Found again only when the brush, its size or the models change.
	 */
	readonly doomed: WorldObject[] = []
	private doomedIds = new Set<number>()
	private doomedAt = { x: NaN, z: NaN, r: 0, version: -1, layer: null as ObjectLayer | null }

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null) {
		this.held = true
		this.removed = []
		this.objects = ctx.objects
		const mode = editor.clearMode
		if (mode === 'textures') this.stroke = new TerrainStroke(ctx.terrain, 'Clear textures', { splat: true })
		else if (mode === 'faint') this.stroke = new TerrainStroke(ctx.terrain, 'Clear faint layers', { splat: true })
		else if (mode === 'heights') this.stroke = new TerrainStroke(ctx.terrain, 'Clear height', { heights: true }, (r) => this.resnap(ctx, r))
		else if (mode === 'holes') this.stroke = new TerrainStroke(ctx.terrain, 'Fill holes', { holes: true })
		else if (mode === 'liquids') this.liquidStroke = new LiquidStroke(ctx.liquids, 'Clear liquids')
		this.clear(ctx, hit)
	}

	tick(ctx: ToolContext, _dt: number, hit: THREE.Vector3 | null) {
		if (this.held) this.clear(ctx, hit)
	}

	frame(ctx: ToolContext, hit: THREE.Vector3 | null) {
		const at = this.doomedAt
		if (editor.clearMode !== 'models' || !hit) {
			this.doomed.length = 0
			at.layer = null
			return
		}
		const r = editor.brush.radius
		const objects = ctx.objects
		if (at.x === hit.x && at.z === hit.z && at.r === r && at.version === objects.version && at.layer === objects) return
		at.x = hit.x
		at.z = hit.z
		at.r = r
		at.version = objects.version
		at.layer = objects
		this.modelsIn(objects, hit, this.doomedIds)
		this.doomed.length = 0
		for (const id of this.doomedIds) {
			const o = objects.objects.get(id)
			if (o) this.doomed.push(o)
		}
	}

	deactivate() {
		this.doomed.length = 0
		this.doomedAt.layer = null
	}

	onUp(ctx: ToolContext) {
		this.held = false
		const cmd = this.stroke?.finish() ?? null
		this.stroke = null
		if (cmd) ctx.history.push(cmd)
		const lcmd = this.liquidStroke?.finish() ?? null
		this.liquidStroke = null
		if (lcmd) ctx.history.push(lcmd)
		const objects = this.objects
		const saved = this.removed
		this.removed = []
		this.objects = null
		if (objects && saved.length) ctx.history.push(removedCommand(objects, saved, 'Clear models'))
	}

	private clear(ctx: ToolContext, hit: THREE.Vector3 | null) {
		if (!hit) return
		switch (editor.clearMode) {
			case 'models':
				return this.clearModels(ctx, hit)
			case 'textures':
				return this.clearTextures(ctx, hit)
			case 'faint':
				return this.clearFaint(ctx, hit)
			case 'heights':
				return this.clearHeights(ctx, hit)
			case 'liquids':
				return this.clearLiquids(ctx, hit)
			case 'holes':
				return this.fillHoles(ctx, hit)
		}
	}

	/**
	 * Each paint chunk the brush touches loses its painted layers whose strongest texel is under the
	 * threshold (the owner's reading of noggit3's texture-alpha threshold, #41): their weight goes to
	 * the strongest other texture, and the slot is free for another.
	 */
	private clearFaint(ctx: ToolContext, hit: THREE.Vector3) {
		const t = ctx.terrain
		const side = t.paintChunksPerSide
		const per = t.splatRes / side
		const size = CHUNK_CELLS * t.cellSize
		const r = editor.brush.radius
		const below = Math.round((editor.clearThreshold / 100) * 255)
		const cx0 = Math.max(0, Math.floor((hit.x - r) / size)),
			cx1 = Math.min(side - 1, Math.floor((hit.x + r) / size))
		const cz0 = Math.max(0, Math.floor((hit.z - r) / size)),
			cz1 = Math.min(side - 1, Math.floor((hit.z + r) / size))
		for (let cz = cz0; cz <= cz1; cz++) {
			for (let cx = cx0; cx <= cx1; cx++) {
				// The chunk's nearest point to the brush centre must be inside the brush.
				const dx = Math.max(cx * size - hit.x, 0, hit.x - (cx + 1) * size)
				const dz = Math.max(cz * size - hit.z, 0, hit.z - (cz + 1) * size)
				if (dx * dx + dz * dz > r * r) continue
				const c = cz * side + cx
				const rect = { x0: cx * per, z0: cz * per, x1: cx * per + per - 1, z1: cz * per + per - 1 }
				this.stroke?.reserveSplat(rect)
				if (!dropFaintLayers(side, t.splatRes, t.chunkSlots, t.weights, c, below)) continue
				this.stroke?.touchSplat(rect)
				t.markSplatDirty(rect)
			}
		}
	}

	/** The ground under the brush goes to height zero, by the brush weight, so a soft edge blends into what stands around. */
	private clearHeights(ctx: ToolContext, hit: THREE.Vector3) {
		const t = ctx.terrain
		const h = t.heights
		const { radius, falloff } = editor.brush
		const rect = forEachVertex(t, hit.x, hit.z, radius, falloff, (i, w) => (h[i] *= 1 - w), this.stroke)
		if (rect) {
			t.markDirty(rect.x0, rect.z0, rect.x1, rect.z1)
			this.stroke?.touchHeights(rect)
			this.resnap(ctx, rect)
		}
	}

	private resnap(ctx: ToolContext, r: Rect) {
		const cs = ctx.terrain.cellSize
		ctx.objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
	}

	/** Every painted liquid layer loses the cells under the brush (noggit's liquid brush with "remove"). */
	private clearLiquids(ctx: ToolContext, hit: THREE.Vector3) {
		if (!this.liquidStroke) return
		const b = this.liquidBrush
		b.x = hit.x
		b.y = hit.y
		b.z = hit.z
		b.radius = editor.brush.radius
		paintLiquid(ctx.liquids, ctx.terrain, b, this.liquidStroke.reserve)
	}

	/** The holes of the 2x2-cell blocks (the client's hole blocks) whose centre is under the brush are filled. */
	private fillHoles(ctx: ToolContext, hit: THREE.Vector3) {
		const t = ctx.terrain
		const cs = t.cellSize
		const bs = HOLE_BLOCK * cs
		const r = editor.brush.radius
		const blocks = Math.ceil(t.size / HOLE_BLOCK)
		const bx0 = Math.max(0, Math.floor((hit.x - r) / bs))
		const bz0 = Math.max(0, Math.floor((hit.z - r) / bs))
		const bx1 = Math.min(blocks - 1, Math.floor((hit.x + r) / bs))
		const bz1 = Math.min(blocks - 1, Math.floor((hit.z + r) / bs))
		const rect = this.cellRect
		for (let bz = bz0; bz <= bz1; bz++) {
			for (let bx = bx0; bx <= bx1; bx++) {
				const dx = (bx + 0.5) * bs - hit.x
				const dz = (bz + 0.5) * bs - hit.z
				if (dx * dx + dz * dz > r * r) continue
				rect.x0 = bx * HOLE_BLOCK
				rect.z0 = bz * HOLE_BLOCK
				rect.x1 = Math.min(t.size - 1, rect.x0 + HOLE_BLOCK - 1)
				rect.z1 = Math.min(t.size - 1, rect.z0 + HOLE_BLOCK - 1)
				if (!countHoles(t.holes, t.size, rect.x0, rect.z0, rect.x1 + 1, rect.z1 + 1)) continue
				this.stroke?.reserveHoles(rect)
				fillHoles(t.holes, t.size, rect.x0, rect.z0, rect.x1 + 1, rect.z1 + 1, 0)
				t.markDirty(rect.x0, rect.z0, rect.x1 + 1, rect.z1 + 1)
				this.stroke?.touchHoles(rect)
			}
		}
	}

	/** Fills `out` with the root models whose ground point is in the brush at `hit`, and what hangs on them. */
	private modelsIn(objects: ObjectLayer, hit: THREE.Vector3, out: Set<number>) {
		out.clear()
		// A root model's x and z are its world ground point: the layer's cells find those in the brush.
		for (const o of objects.rootsNear(hit.x, hit.z, editor.brush.radius, this.near)) if (objects.pickable(o.id)) out.add(o.id)
		this.near.length = 0
		// What hangs on them, in one walk.
		objects.descendantsOf(out, out)
	}

	private gone = new Set<number>()

	private clearModels(ctx: ToolContext, hit: THREE.Vector3) {
		const gone = this.gone
		this.modelsIn(ctx.objects, hit, gone)
		for (const id of gone) {
			const o = ctx.objects.objects.get(id)
			if (!o) continue
			this.removed.push({ ...o })
			ctx.objects.remove(id)
			if (editor.selected?.id === id) editor.selected = null
		}
	}

	private clearTextures(ctx: ToolContext, hit: THREE.Vector3) {
		const t = ctx.terrain
		const { radius, falloff } = editor.brush
		const w = t.weights
		const rect = forEachTexel(t, hit.x, hit.z, radius, falloff, (p, weight) => resetTexel(w, p * SLOTS, weight), this.stroke)
		if (rect) {
			t.markSplatDirty(rect)
			this.stroke?.touchSplat(rect)
		}
	}
}
