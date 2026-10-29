import * as THREE from 'three'
import { editor as liveEditor, setStatus, type SculptLimit, type ToolSettings } from '../state/editor.svelte'
import type { Tool, ToolContext } from './Tool'
import { TerrainStroke, brushCenter, brushShape, type Rect } from './brush'
import { brushImage, setBrushImageRotation } from './brushImage'
import { dominantTexel, textureWeightTexel } from '../terrain/chunkPaint'
import type { Terrain } from '../terrain/Terrain'

export type { ToolSettings }

/**
 * What every brush tool (BrushTool and the tools built on it) reads its settings from: the editor, or,
 * while the Stamp tool runs one of its stack's brushes, that brush's own copy (`withSettings`). The
 * swap is a plain module binding, exported live (an importer always sees the current one), so a
 * stack's brushes never write the reactive editor state each frame. `withSettings` is the only
 * thing that changes it.
 */
export let editor: ToolSettings = liveEditor

/**
 * `settings` with the brush radius scaled by `p` (the pen's pressure, #42): a view that reads every
 * other setting through to `settings`. Its own properties are defined, never assigned, so nothing
 * is written into the reactive editor behind it.
 */
function pressured(settings: ToolSettings, p: number): ToolSettings {
	const brush = Object.create(settings.brush) as ToolSettings['brush']
	Object.defineProperty(brush, 'radius', { value: settings.brush.radius * p })
	const view = Object.create(settings) as ToolSettings
	Object.defineProperty(view, 'brush', { value: brush })
	return view
}

/** Runs `fn` with the brush tools reading `settings` instead of the editor's (the Stamp tool's brushes). */
export function withSettings<T>(settings: ToolSettings, fn: () => T): T {
	const prev = editor
	editor = settings
	try {
		return fn()
	} finally {
		editor = prev
	}
}

/** Shown when a stroke reaches a paint chunk that already has four textures. */
const CHUNK_FULL = 'Not painted: that chunk already has four textures (the 1.12 limit). Replace one in the Layers panel, use Swap mode, or paint with one of its four.'

/** The palette index of the texture with the most weight under world point (x, z), or -1 if none. */
export function layerAt(t: Terrain, x: number, z: number): number {
	return dominantTexel(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, texelAt(t, x, z))
}

/** The weight (0 to 1) of palette texture `tex` at (x, z). */
export function textureWeightAt(t: Terrain, x: number, z: number, tex: number): number {
	return textureWeightTexel(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, texelAt(t, x, z), tex)
}

/** Splat texel under world point (x, z), clamped to the map. */
export function texelAt(t: Terrain, x: number, z: number): number {
	const R = t.splatRes
	const ts = t.worldSize / R
	const tx = Math.min(R - 1, Math.max(0, Math.floor(x / ts)))
	const tz = Math.min(R - 1, Math.max(0, Math.floor(z / ts)))
	return tz * R + tx
}

/** Whether ground at height `v` may change under the sculpt limit, given the cursor's height. */
export function keeps(v: number, limit: SculptLimit, cursorY: number): boolean {
	return limit === 'none' || (limit === 'above' ? v > cursorY : v < cursorY)
}

/** Shared stroke lifecycle for brush tools that modify the terrain. */
export abstract class BrushTool implements Tool {
	get usesBrush() {
		return true
	}
	protected stroke: TerrainStroke | null = null
	protected abstract label: string
	protected abstract records: { heights?: boolean; splat?: boolean; mask?: boolean }
	protected strokeStart = new THREE.Vector3()

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null) {
		if (!hit) return
		this.strokeStart.copy(hit)
		this.stroke = new TerrainStroke(ctx.terrain, this.label, this.records, (r) => this.resnap(ctx, r))
		this.begin(ctx, hit)
	}

	/** Puts this tool's stroke on `stroke`, shared with the Stamp tool's other brushes (after its onDown). */
	useStroke(stroke: TerrainStroke) {
		this.stroke = stroke
	}

	/** Leaves the shared stroke without finishing it: the Stamp tool finishes it once for all its brushes. */
	releaseStroke() {
		this.stroke = null
		this.chunkFullShown = null
	}

	onUp(ctx: ToolContext) {
		if (!this.stroke) return
		if (this.imageShaped() && editor.brushImage.name && editor.brushImage.random) editor.brushImage.rotation = Math.floor(Math.random() * 360)
		const cmd = this.stroke.finish()
		this.stroke = null
		this.chunkFullShown = null
		if (cmd) ctx.history.push(cmd)
	}

	private center = new THREE.Vector3()

	/** Radius of the brush footprint (roads use a narrower one). */
	radius(): number {
		return editor.brush.radius
	}

	tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
		if (!this.stroke || !hit) return
		brushShape.square = editor.brush.shape === 'square'
		brushShape.curve = editor.brush.curve
		const [x, z] = brushCenter(hit.x, hit.z, this.radius(), ctx.terrain.cellSize, brushShape.square && editor.brush.snap)
		// The brush image shapes this stroke only, and only in the tools that take one.
		brushImage.active = this.imageShaped() && !!brushImage.data
		if (brushImage.active) setBrushImageRotation(editor.brushImage.rotation)
		try {
			const p = ctx.radiusPressure()
			if (p < 1) withSettings(pressured(editor, p), () => this.apply(ctx, dt, this.center.set(x, hit.y, z)))
			else this.apply(ctx, dt, this.center.set(x, hit.y, z))
		} finally {
			brushImage.active = false
		}
	}

	/** Whether the brush image shapes this tool's strokes (Sculpt's shaping modes and Paint's textures). */
	imageShaped() {
		return false
	}

	protected begin(_ctx: ToolContext, _hit: THREE.Vector3) {}
	protected abstract apply(ctx: ToolContext, dt: number, hit: THREE.Vector3): void

	protected heightsChanged(ctx: ToolContext, r: Rect | null) {
		if (!r) return
		ctx.terrain.markDirty(r.x0, r.z0, r.x1, r.z1)
		this.stroke?.touchHeights(r)
		this.resnap(ctx, r)
	}

	/** The stroke the "chunk full" message was last shown for: a stroke shows it once, not every frame. */
	private chunkFullShown: TerrainStroke | null = null

	/** Says a full chunk refused the paint, once per stroke. */
	protected chunkFull() {
		if (this.stroke && this.stroke === this.chunkFullShown) return
		this.chunkFullShown = this.stroke
		setStatus(CHUNK_FULL, 3000)
	}

	protected splatChanged(ctx: ToolContext, r: Rect | null) {
		if (!r) return
		ctx.terrain.markSplatDirty(r)
		this.stroke?.touchSplat(r)
	}

	private resnap(ctx: ToolContext, r: Rect) {
		const cs = ctx.terrain.cellSize
		ctx.objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
	}
}
