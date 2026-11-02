import * as THREE from 'three'
import { editor as liveEditor, setStatus, type SculptLimit, type ToolSettings } from '../state/editor.svelte'
import type { Tool, ToolContext } from './Tool'
import { TerrainStroke, brushCenter, brushShape, type Rect } from './brush'
import { brushImage, setBrushImageTransform } from './brushImage'
import { IDENTITY, eachMirror, mirrorPoint, symmetryCenter, unmirrorPoint, type Mirror, type MirrorDab } from './symmetry'
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
	/** Where the stroke started, for each copy of a symmetric stroke (#182): `strokeStart` reads the one being applied. */
	private starts: THREE.Vector3[] = [new THREE.Vector3()]
	protected get strokeStart(): THREE.Vector3 {
		return this.starts[this.mirrorIndex] ?? this.starts[0]
	}
	/**
	 * The copy of a symmetric stroke being applied now (#182): its index (0 the stroke itself) and its
	 * transform, so a tool keeps its per-stroke state (Flatten's height, Terrace's level) per copy.
	 * `begin` and `apply` run once per copy, with these set.
	 */
	protected mirrorIndex = 0
	protected mirror: Mirror = IDENTITY
	private mirrorCenter = { x: 0, z: 0 }
	private unmirrored = new Float64Array(2)

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null) {
		if (!hit) return
		this.stroke = new TerrainStroke(ctx.terrain, this.label, this.records, (r) => this.resnap(ctx, r))
		// Every copy begins at its own point (no merging: each keeps its own start), with the ground's height there.
		eachMirror(liveEditor.symmetry, ctx.terrain, hit, 0, false, (d) => {
			const start = (this.starts[d.index] ??= new THREE.Vector3()).set(d.x, d.y, d.z)
			this.setMirror(ctx, d)
			this.begin(ctx, start)
		})
		this.setMirror(ctx, null)
	}

	/** Makes `d` the copy being applied (null: the stroke itself). */
	private setMirror(ctx: ToolContext, d: MirrorDab | null) {
		this.mirrorIndex = d?.index ?? 0
		this.mirror = d?.mirror ?? IDENTITY
		if (d) {
			const c = symmetryCenter(liveEditor.symmetry, ctx.terrain.worldSize)
			this.mirrorCenter.x = c.x
			this.mirrorCenter.z = c.z
		}
	}

	/**
	 * The point of the stroke's own copy that the copy being applied now draws at (x, z), into `out`:
	 * a world-space pattern (Noise's, Mountain's ridges) read there comes out mirrored on every copy.
	 */
	protected unmirror(x: number, z: number): Float64Array {
		const out = this.unmirrored
		if (this.mirror === IDENTITY) {
			out[0] = x
			out[1] = z
		} else unmirrorPoint(this.mirror, this.mirrorCenter.x, this.mirrorCenter.z, x, z, out)
		return out
	}

	/** A point given for the stroke's own copy (the locked Flatten pivot) as the copy being applied now, into `out`. */
	protected mirrored(x: number, z: number, out: Float64Array | number[]) {
		mirrorPoint(this.mirror, this.mirrorCenter.x, this.mirrorCenter.z, x, z, out)
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
	/** The tick's ctx and dt for `applyDab`, so the per-copy callback is made once, not every tick. */
	private tickCtx: ToolContext | null = null
	private tickDt = 0
	private readonly applyDab = (d: MirrorDab) => {
		const ctx = this.tickCtx!
		const [x, z] = brushCenter(d.x, d.z, this.radius(), ctx.terrain.cellSize, brushShape.square && editor.brush.snap)
		this.setMirror(ctx, d)
		if (brushImage.active) setBrushImageTransform(editor.brushImage.rotation, d.mirror)
		this.apply(ctx, this.tickDt, this.center.set(x, d.y, z))
	}

	/** One tick's dabs: the stroke's own, and with symmetry on (#182) one for each copy, merged where they overlap. */
	private applyCopies(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
		this.tickCtx = ctx
		this.tickDt = dt
		eachMirror(liveEditor.symmetry, ctx.terrain, hit, this.radius(), true, this.applyDab)
	}

	/** Radius of the brush footprint (roads use a narrower one). */
	radius(): number {
		return editor.brush.radius
	}

	tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
		if (!this.stroke || !hit) return
		brushShape.square = editor.brush.shape === 'square'
		brushShape.curve = editor.brush.curve
		// The brush image shapes this stroke only, and only in the tools that take one.
		brushImage.active = this.imageShaped() && !!brushImage.data
		try {
			const p = ctx.radiusPressure()
			if (p < 1) withSettings(pressured(editor, p), () => this.applyCopies(ctx, dt, hit))
			else this.applyCopies(ctx, dt, hit)
		} finally {
			brushImage.active = false
			this.setMirror(ctx, null)
			this.tickCtx = null
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
