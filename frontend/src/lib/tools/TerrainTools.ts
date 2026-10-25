import * as THREE from 'three'
import { HOLE_CELL, HOLE_NONE, fillHoles, snapToBlocks } from '../terrain/holes'
import { editor as liveEditor, setStatus, ui, type SculptMode, type ToolSettings } from '../state/editor.svelte'

export type { ToolSettings }

/**
 * What every brush tool in this module reads its settings from: the editor, or, while the Stamp tool
 * runs one of its stack's brushes, that brush's own copy (`withSettings`). The swap is a plain module
 * binding, so a stack's brushes never write the reactive editor state each frame.
 */
let editor: ToolSettings = liveEditor

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
import { slopeDegrees, slopeWeights } from '../terrain/roles'
import { copyRect, tentBlur } from '../terrain/blur'
import type { Command, History } from '../state/history'
import { VertexSelection, flattenVertices, moveVertices, orientVertices, type VertexRect } from './vertexEdit'
import { fbm, ridged } from '../engine/noise'
import type { Tool, ToolContext } from './Tool'
import { TerrainStroke, brushCenter, brushDist, brushShape, forEachTexel, forEachVertex, paintPixel, type Rect } from './brush'
import { Eroder, talusSlope } from '../terrain/erosion'
import { angledHeight, creviceDig, creviceRidge, mountainHeight, ridgeScale, terraceHeight, terraceLevel } from './sculptShapes'
import { brushImage, setBrushImageRotation } from './brushImage'
import { wandClick } from './maskWand'
import { CHUNK_CELLS, NO_TEXTURE, SLOTS, chunkOfTexel, dominantTexel, findSlot, paletteIndex, replaceInChunk, swapTexel, textureWeightTexel } from '../terrain/chunkPaint'
import type { Terrain } from '../terrain/Terrain'
import type { SculptLimit } from '../state/editor.svelte'
import { MAX_DABS, sprayAmount, sprayDabRadius, sprayDabs } from './spray'
import { OCEAN_OPACITY, RIVER_OPACITY, autoOpacity, newLiquidBrush, paintLiquid } from '../water/liquids'
import { LiquidStroke } from '../water/liquidStroke'
import { TILE_CHUNKS } from '../wow/format'

/** Shown when a stroke reaches a paint chunk that already has four textures. */
const CHUNK_FULL = 'Not painted: that chunk already has four textures (the 1.12 limit). Replace one in the Layers panel, use Swap mode, or paint with one of its four.'

/** Splat texel under world point (x, z), clamped to the map. */
/** The palette index of the texture with the most weight under world point (x, z), or -1 if none. */
export function layerAt(t: Terrain, x: number, z: number): number {
	return dominantTexel(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, texelAt(t, x, z))
}

/** The weight (0 to 1) of palette texture `tex` at (x, z). */
export function textureWeightAt(t: Terrain, x: number, z: number, tex: number): number {
	return textureWeightTexel(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, texelAt(t, x, z), tex)
}

function texelAt(t: Terrain, x: number, z: number): number {
	const R = t.splatRes
	const ts = t.worldSize / R
	const tx = Math.min(R - 1, Math.max(0, Math.floor(x / ts)))
	const tz = Math.min(R - 1, Math.max(0, Math.floor(z / ts)))
	return tz * R + tx
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

/** A texture's file name without its folders and extension, for messages. */
const texName = (p: string) => (p.startsWith('#') ? p : p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, ''))

const RAISE_RATE = 18 // world units per second at strength 1
/** Mountain builds much faster than Raise, since a peak is a few hundred units tall. */
const MOUNTAIN_RATE = RAISE_RATE * 4
/** Crevice digs at this rate (the ridges rise with what was dug); faster than Raise since a dragged brush passes each spot briefly. */
const CREVICE_RATE = RAISE_RATE * 2
/** Erode's water drops a cell of the brush a second at strength 1. */
const DROPS_RATE = 0.5
/** Erode's thermal mode: passes' worth a second at strength 1. */
const THERMAL_RATE = 8

/** Weighted mean height under the brush: the flatten target when it averages. */
function averageHeight(t: Terrain, x: number, z: number, radius: number, falloff: number): number {
	const h = t.heights
	let sum = 0
	let weight = 0
	forEachVertex(t, x, z, radius, falloff, (i, w) => {
		sum += h[i] * w
		weight += w
	})
	return weight > 0 ? sum / weight : t.heightAt(x, z)
}

/** Whether ground at height `v` may change under the sculpt limit, given the cursor's height. */
function keeps(v: number, limit: SculptLimit, cursorY: number): boolean {
	return limit === 'none' || (limit === 'above' ? v > cursorY : v < cursorY)
}

/** Sets heightmap vertices `ids` to `before` on undo and back to their current heights on redo. */
function vertexCommand(ctx: Pick<ToolContext, 'terrain' | 'objects'>, label: string, ids: number[], before: Float32Array, r: VertexRect): Command {
	const t = ctx.terrain
	const objects = ctx.objects
	const after = Float32Array.from(ids, (i) => t.heights[i])
	const apply = (v: Float32Array) => {
		ids.forEach((i, k) => (t.heights[i] = v[k]))
		t.markDirty(r.x0, r.z0, r.x1, r.z1)
		const cs = t.cellSize
		objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
	}
	return { label, bytes: before.byteLength + after.byteLength, undo: () => apply(before), redo: () => apply(after) }
}

/** The slope slider's undo step is recorded at most this often while it moves (ms). */
const ORIENT_RECORD_MS = 100

/** Most selected vertices drawn as markers. */
const MAX_VERTEX_MARKERS = 65536

/** The sculpt modes that shape the ground under the brush, and so paint it too with Paint texture on. */
const SHAPING_MODES = new Set<SculptMode>(['raise', 'lower', 'smooth', 'blur', 'flatten', 'noise', 'mountain', 'crevice', 'terrace', 'erode'])

export class SculptTool extends BrushTool {
	protected label = 'Sculpt'
	/** With Paint texture on, a shaping stroke records the splat too, so the paint undoes with the heights. */
	protected get records() {
		return { heights: true, splat: editor.sculptPaint !== 'off' && SHAPING_MODES.has(editor.sculptMode) }
	}
	private slopeW = new Float32Array(2)
	/** Blur's scratch space between its two passes. */
	private blurTmp = new Float32Array(0)
	imageShaped() {
		return SHAPING_MODES.has(editor.sculptMode)
	}
	/** Hole mode works on the triangle under the cursor, not a brush footprint. */
	get usesBrush() {
		return editor.sculptMode !== 'hole'
	}
	/** Hole mode: whether this stroke restores ground (else it cuts), and the cell rect it touched. */
	private holeFilling = false
	private holeCell = { x0: 0, z0: 0, x1: 0, z1: 0 }
	/** Whether Hole mode shows the wall handles (`ctx.holeWalls`) now. */
	private wallsShown = false
	private flattenTarget = 0
	/** Terrace with Shift: the level every vertex of the stroke goes to, the step under the first click; null without. */
	private terraceSame: number | null = null
	private terraceShift = false
	private scratch = new Float32Array(0)
	/** Erode: the drops and slides, the brush's patch in cell units, its heights before and its weights, and the drops owed. */
	private eroder = new Eroder()
	private erodeWork = new Float32Array(0)
	private erodeBefore = new Float32Array(0)
	private erodeMask = new Float32Array(0)
	private dropsOwed = 0

	// Vertex mode: the selected vertices of `vselTerrain`, whether this stroke moves them (Shift) or
	// deselects (Ctrl or Alt), the last cursor point, and the slope last applied.
	private vsel: VertexSelection | null = null
	private vselTerrain: Terrain | null = null
	private moving = false
	private deselecting = false
	private cursor = new THREE.Vector3()
	private hasCursor = false
	private applied = { angle: 0, dir: 0, ref: 'center' }
	/**
	 * The open slope edit, merged into one undo step while it stays on top of the history. The slider
	 * lays the heights every frame it moves, but the step is recorded at most every ORIENT_RECORD_MS
	 * and once the slider rests (`pending` holds what to record), so a drag doesn't redraw History a frame.
	 */
	private orientSession: {
		cmd: Command | null
		ids: number[]
		before: Float32Array
		recorded: number
		pending: { at: Pick<ToolContext, 'terrain' | 'objects'>; history: History; r: VertexRect } | null
	} | null = null
	private vcenter = { x: 0, y: 0, z: 0 }
	private markers: THREE.Points | null = null
	/** What the markers' buffer was last filled from, so an unchanged frame skips the rewrite and upload. */
	private markersKey = { sel: null as VertexSelection | null, terrain: null as unknown, version: -1, size: -1, heights: -1 }

	/** The vertex selection for the active map; a new map starts with none. */
	private selection(t: Terrain): VertexSelection {
		if (!this.vsel || this.vselTerrain !== t) {
			this.vsel = new VertexSelection(t.verts)
			this.vselTerrain = t
			this.selectionChanged()
		}
		return this.vsel
	}

	/** Resets the slope to level for a new selection, as noggit3 does, and publishes the count. */
	private selectionChanged() {
		this.recordOrient()
		editor.vertexAngle = 0
		editor.vertexDir = 0
		this.applied = { angle: 0, dir: 0, ref: editor.vertexRef }
		this.orientSession = null
		ui.vertexCount = this.vsel?.size ?? 0
	}

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent) {
		this.recordOrient()
		if (editor.sculptMode === 'hole') {
			if (ctx.holeWalls.onDown(ctx)) return
			if (!hit) return
			this.holeFilling = editor.holeFill !== !!e?.shiftKey
			this.stroke = new TerrainStroke(ctx.terrain, this.holeFilling ? 'Fill hole' : 'Cut hole', { holes: true })
			this.paintHole(ctx, hit)
			return
		}
		if (editor.sculptMode === 'flatten' && e?.altKey) {
			// Alt+click locks the flatten height (and the angled plane's pivot) to the point under the cursor.
			if (!hit) return
			const lock = editor.flattenLock
			lock.x = hit.x
			lock.y = hit.y
			lock.z = hit.z
			lock.on = true
			setStatus(`Flatten locked at height ${hit.y.toFixed(2)}. Every stroke now levels to it.`)
			return
		}
		// Before the stroke is made (in super.onDown), which takes the label as it is then (#190).
		this.label = 'Sculpt: ' + editor.sculptMode
		const vertex = editor.sculptMode === 'vertex'
		this.terraceShift = editor.sculptMode === 'terrace' && !!e?.shiftKey
		this.moving = vertex && !!e?.shiftKey
		this.deselecting = vertex && !!(e?.ctrlKey || e?.altKey)
		super.onDown(ctx, hit)
	}

	tick(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null) {
		if (editor.sculptMode === 'hole') {
			if (ctx.holeWalls.active) ctx.holeWalls.onMove(ctx)
			else if (this.stroke && hit) this.paintHole(ctx, hit)
			return
		}
		super.tick(ctx, dt, hit)
	}

	/** Cuts or restores the triangle of the ground under `hit`, as part of the stroke's hole edit. */
	private paintHole(ctx: ToolContext, hit: THREE.Vector3) {
		const t = ctx.terrain
		const gx = hit.x / t.cellSize
		const gz = hit.z / t.cellSize
		const cx = Math.floor(gx)
		const cz = Math.floor(gz)
		if (cx < 0 || cz < 0 || cx >= t.size || cz >= t.size) return
		// The whole 2x2-cell block under the cursor, as the client keeps holes.
		const r = this.holeCell
		r.x0 = r.x1 = cx
		r.z0 = r.z1 = cz
		snapToBlocks(r, t.size)
		const value = this.holeFilling ? HOLE_NONE : HOLE_CELL
		let changed = false
		for (let z = r.z0; z <= r.z1 && !changed; z++) for (let x = r.x0; x <= r.x1; x++) if (t.holes[z * t.size + x] !== value) changed = true
		if (!changed) return
		this.stroke?.reserveHoles(r)
		fillHoles(t.holes, t.size, r.x0, r.z0, r.x1 + 1, r.z1 + 1, value)
		t.markDirty(r.x0, r.z0, r.x1 + 1, r.z1 + 1)
		this.stroke?.touchHoles(r)
	}

	onMove(ctx: ToolContext, _hit: THREE.Vector3 | null, e: PointerEvent) {
		if (!this.moving || !this.stroke) return
		const sel = this.selection(ctx.terrain)
		const r = sel.rect()
		if (!r || !e.movementY) return
		// Shift-drag moves the selection up and down with the mouse, faster at higher strength.
		this.stroke.reserveHeights(r)
		moveVertices(ctx.terrain.heights, sel, -e.movementY * 0.2 * editor.brush.strength * ctx.pressure())
		this.heightsChanged(ctx, r)
	}

	onUp(ctx: ToolContext) {
		ctx.holeWalls.onUp(ctx)
		super.onUp(ctx)
		if (editor.sculptMode === 'vertex' && !this.moving) {
			const sel = this.selection(ctx.terrain)
			if (sel.size !== ui.vertexCount) this.selectionChanged()
		}
		this.moving = false
	}

	frame(ctx: ToolContext, hit: THREE.Vector3 | null) {
		// The hole walls show in Hole mode only.
		const hole = editor.sculptMode === 'hole'
		if (hole !== this.wallsShown) {
			this.wallsShown = hole
			if (hole) ctx.holeWalls.attach(ctx.scene)
			else ctx.holeWalls.detach(ctx.scene)
		}
		if (hole) ctx.holeWalls.frame(ctx)
		if (hit) {
			this.cursor.copy(hit)
			this.hasCursor = true
		}
		const sel = editor.sculptMode === 'vertex' ? this.selection(ctx.terrain) : null
		const a = this.applied
		if (sel && sel.size && (editor.vertexAngle !== a.angle || editor.vertexDir !== a.dir || editor.vertexRef !== a.ref)) this.orient(ctx, sel)
		else this.recordOrient()
		this.drawMarkers(ctx, sel)
	}

	deactivate(ctx: ToolContext) {
		this.recordOrient()
		this.drawMarkers(ctx, null)
		ctx.holeWalls.detach(ctx.scene)
		this.wallsShown = false
	}

	onKey(ctx: ToolContext, e: KeyboardEvent) {
		if (editor.sculptMode !== 'vertex' || e.key !== ' ') return false
		// Space turns the slope to rise from the cursor toward the selection centre.
		const sel = this.selection(ctx.terrain)
		if (!sel.size || !this.hasCursor) return true
		const c = sel.center(ctx.terrain.heights, ctx.terrain.cellSize, this.vcenter)
		const deg = (Math.atan2(c.z - this.cursor.z, c.x - this.cursor.x) * 180) / Math.PI
		editor.vertexDir = Math.round((deg + 360) % 360)
		return true
	}

	/** Vertex mode actions from the options bar: flatten the selection to its mean height, or clear it. */
	vertexAction(ctx: ToolContext, action: 'flatten' | 'clear') {
		this.recordOrient()
		const sel = this.selection(ctx.terrain)
		if (action === 'clear') {
			sel.clear()
			this.selectionChanged()
			return
		}
		const r = sel.rect()
		if (!r) return
		const h = ctx.terrain.heights
		const ids = sel.ids.slice()
		const before = Float32Array.from(ids, (i) => h[i])
		flattenVertices(h, sel, sel.center(h, ctx.terrain.cellSize, this.vcenter).y)
		this.heightsChanged(ctx, r)
		ctx.history.push(vertexCommand(ctx, 'Vertex flatten', ids, before, r))
		this.selectionChanged()
	}

	/** Lays the selection onto the slope plane, as one undo step per run of slope changes. */
	private orient(ctx: ToolContext, sel: VertexSelection) {
		const t = ctx.terrain
		const r = sel.rect()
		if (!r) return
		let s = this.orientSession
		// A session goes on while its step is still unrecorded or still on top of the history.
		if (!s || (!s.pending && (!s.cmd || ctx.history.peek() !== s.cmd))) {
			const ids = sel.ids.slice()
			s = { cmd: null, ids, before: Float32Array.from(ids, (i) => t.heights[i]), recorded: 0, pending: null }
		}
		const ref = editor.vertexRef === 'cursor' && this.hasCursor ? this.cursor : sel.center(t.heights, t.cellSize, this.vcenter)
		orientVertices(t.heights, sel, t.cellSize, ref, editor.vertexAngle, editor.vertexDir)
		this.heightsChanged(ctx, r)
		// The map, its objects and its history now, in case the tab changes before the step is recorded.
		s.pending = { at: { terrain: t, objects: ctx.objects }, history: ctx.history, r }
		this.orientSession = s
		this.applied = { angle: editor.vertexAngle, dir: editor.vertexDir, ref: editor.vertexRef }
		if (performance.now() - s.recorded >= ORIENT_RECORD_MS) this.recordOrient()
	}

	/** Records the slope laid since the last record as the session's undo step (replacing it while on top). */
	private recordOrient() {
		const s = this.orientSession
		const p = s?.pending
		if (!s || !p) return
		s.pending = null
		const cmd = vertexCommand(p.at, 'Vertex slope', s.ids, s.before, p.r)
		if (s.cmd && p.history.peek() === s.cmd) p.history.replaceTop(cmd)
		else p.history.push(cmd)
		s.cmd = cmd
		s.recorded = performance.now()
	}

	/** Draws a dot on each selected vertex. Hidden when `sel` is null or empty. */
	private drawMarkers(ctx: ToolContext, sel: VertexSelection | null) {
		const n = sel ? Math.min(sel.size, MAX_VERTEX_MARKERS) : 0
		if (!n || !sel) {
			if (this.markers) this.markers.visible = false
			return
		}
		let m = this.markers
		const cap = m ? m.geometry.attributes.position.count : 0
		if (!m || cap < n) {
			if (m) {
				ctx.scene.remove(m)
				m.geometry.dispose()
			}
			let size = Math.max(256, cap)
			while (size < n) size *= 2
			const geo = new THREE.BufferGeometry()
			geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(size * 3), 3).setUsage(THREE.DynamicDrawUsage))
			const mat = m ? (m.material as THREE.PointsMaterial) : new THREE.PointsMaterial({ color: 0xffb020, size: 5, sizeAttenuation: false, depthTest: false })
			m = new THREE.Points(geo, mat)
			m.frustumCulled = false
			m.renderOrder = 10
			this.markers = m
			this.markersKey.version = -1
		}
		if (m.parent !== ctx.scene) ctx.scene.add(m)
		const t = ctx.terrain
		const key = this.markersKey
		if (key.sel === sel && key.terrain === t && key.version === sel.version && key.size === n && key.heights === t.heightVersion) {
			m.visible = true
			return
		}
		key.sel = sel
		key.terrain = t
		key.version = sel.version
		key.size = n
		key.heights = t.heightVersion
		const V = t.verts
		const cs = t.cellSize
		const pos = m.geometry.attributes.position as THREE.BufferAttribute
		const a = pos.array as Float32Array
		for (let k = 0; k < n; k++) {
			const i = sel.ids[k]
			const x = i % V
			a[k * 3] = x * cs
			a[k * 3 + 1] = t.heights[i] + 0.1
			a[k * 3 + 2] = ((i - x) / V) * cs
		}
		pos.needsUpdate = true
		m.geometry.setDrawRange(0, n)
		m.visible = true
	}

	protected begin(ctx: ToolContext, hit: THREE.Vector3) {
		const { radius, falloff } = editor.brush
		this.flattenTarget = editor.flattenLock.on ? editor.flattenLock.y : editor.flattenTarget === 'average' ? averageHeight(ctx.terrain, hit.x, hit.z, radius, falloff) : ctx.terrain.heightAt(hit.x, hit.z)
		// Each stroke starts the drops from the same seed, so the same stroke erodes the same way.
		this.eroder.seed(editor.erode.seed)
		this.dropsOwed = 0
		const tr = editor.terrace
		this.terraceSame = this.terraceShift && tr.step > 0 ? terraceLevel(hit.y, tr.step, tr.offset) : null
	}

	protected apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
		const t = ctx.terrain
		const h = t.heights
		const { radius, falloff } = editor.brush
		const rate = editor.brush.strength * ctx.pressure() * dt
		const mode = editor.sculptMode
		// The edit limit compares each vertex with the height under the cursor.
		const limit = editor.sculptLimit
		const cursorY = hit.y
		let rect: Rect | null = null

		if (mode === 'vertex') {
			// The brush selects vertices (Ctrl or Alt deselects); a Shift stroke moves them in onMove instead.
			if (this.moving) return
			const sel = this.selection(t)
			const off = this.deselecting
			forEachVertex(t, hit.x, hit.z, radius, 0, (i) => (off ? sel.remove(i) : sel.add(i)))
			return
		}

		switch (mode) {
			case 'raise':
			case 'lower': {
				const s = (mode === 'raise' ? 1 : -1) * RAISE_RATE * rate
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					falloff,
					(i, w) => {
						if (keeps(h[i], limit, cursorY)) h[i] += s * w
					},
					this.stroke,
				)
				break
			}
			case 'flatten': {
				const k = Math.min(1, rate * 8)
				const target = this.flattenTarget
				const dir = editor.flattenDir
				// Angled: the target is a plane through the stroke's start (or the locked point), pivoting there like noggit's.
				const ang = editor.flattenAngled
				const angled = ang.on && ang.angle !== 0
				const lock = editor.flattenLock
				const ox = lock.on ? lock.x : this.strokeStart.x
				const oz = lock.on ? lock.z : this.strokeStart.z
				const cs = t.cellSize
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					falloff,
					(i, w, x, z) => {
						const d = (angled ? angledHeight(x * cs, z * cs, ox, target, oz, ang.angle, ang.orientation) : target) - h[i]
						// Raise-only and lower-only leave ground on the far side of the target alone.
						if ((dir === 'raise' && d <= 0) || (dir === 'lower' && d >= 0)) return
						if (keeps(h[i], limit, cursorY)) h[i] += d * w * k
					},
					this.stroke,
				)
				break
			}
			case 'terrace': {
				// Toward the step each vertex stands on (or, with Shift, the first click's), blended as Flatten blends.
				const k = Math.min(1, rate * 8)
				const { step, offset, sharpness } = editor.terrace
				const same = this.terraceSame
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					falloff,
					(i, w) => {
						if (!keeps(h[i], limit, cursorY)) return
						const target = same ?? terraceHeight(h[i], step, offset, sharpness)
						h[i] += (target - h[i]) * w * k
					},
					this.stroke,
				)
				break
			}
			case 'smooth': {
				// Box-blur from a snapshot so the result is order independent.
				const V = t.verts
				const cs = t.cellSize
				if (this.scratch.length !== h.length) this.scratch = new Float32Array(h.length)
				// Only the brush rect and the ring the filter reads around it, not the whole map.
				copyRect(
					h,
					V,
					{
						x0: Math.max(0, Math.floor((hit.x - radius) / cs)),
						z0: Math.max(0, Math.floor((hit.z - radius) / cs)),
						x1: Math.min(V - 1, Math.ceil((hit.x + radius) / cs)),
						z1: Math.min(V - 1, Math.ceil((hit.z + radius) / cs)),
					},
					1,
					this.scratch,
				)
				const src = this.scratch
				const k = Math.min(1, rate * 10)
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					falloff,
					(i, w, x, z) => {
						if (!keeps(h[i], limit, cursorY)) return
						let sum = 0,
							n = 0
						for (let dz = -1; dz <= 1; dz++) {
							const zz = z + dz
							if (zz < 0 || zz >= V) continue
							for (let dx = -1; dx <= 1; dx++) {
								const xx = x + dx
								if (xx < 0 || xx >= V) continue
								sum += src[zz * V + xx]
								n++
							}
						}
						h[i] += (sum / n - h[i]) * w * k
					},
					this.stroke,
				)
				break
			}
			case 'blur': {
				// Toward the tent average over the brush's width (terrain/blur.ts), from a snapshot of before.
				const V = t.verts
				const cs = t.cellSize
				if (this.scratch.length !== h.length) this.scratch = new Float32Array(h.length)
				const r = {
					x0: Math.max(0, Math.floor((hit.x - radius) / cs)),
					z0: Math.max(0, Math.floor((hit.z - radius) / cs)),
					x1: Math.min(V - 1, Math.ceil((hit.x + radius) / cs)),
					z1: Math.min(V - 1, Math.ceil((hit.z + radius) / cs)),
				}
				this.blurTmp = tentBlur(h, V, r, radius / cs, this.scratch, this.blurTmp)
				const blurred = this.scratch
				const k = Math.min(1, rate * 8)
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					falloff,
					(i, w) => {
						if (keeps(h[i], limit, cursorY)) h[i] += (blurred[i] - h[i]) * w * k
					},
					this.stroke,
				)
				break
			}
			case 'noise': {
				const s = RAISE_RATE * rate * 0.6
				const cs = t.cellSize
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					falloff,
					(i, w, x, z) => {
						if (keeps(h[i], limit, cursorY)) h[i] += (fbm(x * cs * 0.08, z * cs * 0.08, 4, 5) - 0.5) * 2 * s * w
					},
					this.stroke,
				)
				break
			}
			case 'mountain': {
				// A peak the size of the brush: the ridge noise is sampled in world space, so holding the
				// brush in place keeps piling the same ridges higher, and its features scale with the brush.
				const s = MOUNTAIN_RATE * rate
				const cs = t.cellSize
				const f = 1.2 / radius
				const ridges = editor.mountain.ridges
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					1,
					(i, _w, x, z) => {
						if (!keeps(h[i], limit, cursorY)) return
						const wx = x * cs
						const wz = z * cs
						const n = ridged(wx * f, wz * f, 5, 13)
						h[i] += mountainHeight(brushDist(wx - hit.x, wz - hit.z, radius), n * n, ridges) * s
					},
					this.stroke,
				)
				break
			}
			case 'crevice': {
				// Dig the solid centre and pile the dug ground onto the falloff band, so dragging the brush
				// ploughs a path with ridges along both sides. Pass one sums the two profiles over the brush
				// so the ridge can hold exactly what the trench loses.
				const s = CREVICE_RATE * rate
				const cs = t.cellSize
				let dig = 0
				let ridge = 0
				forEachVertex(t, hit.x, hit.z, radius, 0, (i, _w, x, z) => {
					if (!keeps(h[i], limit, cursorY)) return
					const d = brushDist(x * cs - hit.x, z * cs - hit.z, radius)
					dig += creviceDig(d, falloff)
					ridge += creviceRidge(d, falloff)
				})
				const k = ridgeScale(dig, ridge) * editor.crevice.ridge
				rect = forEachVertex(
					t,
					hit.x,
					hit.z,
					radius,
					0,
					(i, _w, x, z) => {
						if (!keeps(h[i], limit, cursorY)) return
						const d = brushDist(x * cs - hit.x, z * cs - hit.z, radius)
						h[i] += (creviceRidge(d, falloff) * k - creviceDig(d, falloff)) * s
					},
					this.stroke,
				)
				break
			}
			case 'erode':
				rect = this.erode(ctx, hit, radius, falloff, rate, limit, cursorY)
				break
		}
		this.heightsChanged(ctx, rect)

		// Painting while shaping, over as much of the brush as the mode shapes: one texture, or the rock
		// and dirt roles by the slope the ground now has (rock on the steep, dirt rimming its foot).
		if (rect && editor.sculptPaint !== 'off' && SHAPING_MODES.has(mode)) {
			const pf = mode === 'mountain' ? 1 : mode === 'crevice' ? 0 : falloff
			const amt = Math.min(1, editor.brush.strength * ctx.pressure() * dt * 5)
			let refused = 0
			let sr: Rect | null = null
			if (editor.sculptPaint === 'texture') {
				sr = forEachTexel(
					t,
					hit.x,
					hit.z,
					radius,
					pf,
					(p, w) => {
						if (!paintPixel(t, p, editor.sculptPaintLayer, amt * w)) refused++
					},
					this.stroke,
				)
			} else {
				const { rock, dirt } = editor.roles
				if (rock < 0 && dirt < 0) {
					setStatus("By-slope painting needs the map's rock and dirt textures: set them in File › Map Properties.", 4000)
				} else {
					const { rockDeg, dirtDeg, restoreBase } = editor.slopePaint
					const R = t.splatRes
					const side = t.paintChunksPerSide
					const ts = t.worldSize / R
					const e = ts
					const sw = this.slopeW
					sr = forEachTexel(
						t,
						hit.x,
						hit.z,
						radius,
						pf,
						(p, w) => {
							const x = ((p % R) + 0.5) * ts
							const z = (Math.floor(p / R) + 0.5) * ts
							const deg = slopeDegrees((t.heightAt(x + e, z) - t.heightAt(x - e, z)) / (2 * e), (t.heightAt(x, z + e) - t.heightAt(x, z - e)) / (2 * e))
							slopeWeights(deg, rockDeg, dirtDeg, sw)
							if (rock >= 0 && sw[0] > 0.001 && !paintPixel(t, p, rock, amt * w * sw[0])) refused++
							if (dirt >= 0 && sw[1] > 0.001 && !paintPixel(t, p, dirt, amt * w * sw[1])) refused++
							// Ground gentler than the dirt gets its chunk's base (first) texture back, so a hill
							// lowered again loses its rock; never where the base is the rock or the dirt itself.
							const flat = 1 - sw[0] - sw[1]
							if (restoreBase && flat > 0.001) {
								const base = t.chunkSlots[chunkOfTexel(side, R, p) * SLOTS]
								if (base !== NO_TEXTURE && base !== rock && base !== dirt) paintPixel(t, p, base, amt * w * flat)
							}
						},
						this.stroke,
					)
				}
			}
			if (refused) this.chunkFull()
			this.splatChanged(ctx, sr)
		}
	}

	/**
	 * Sculpt › Erode (#165): copies the heights under the brush into a patch, runs water drops started
	 * under the brush (or one thermal slide) over it (terrain/erosion.ts), and blends the change back by
	 * the brush's weight, so the falloff, the brush image and the edit limit apply as in the other modes
	 * and nothing outside the brush (which undo saved) changes. A drop that runs off the patch is gone.
	 */
	private erode(ctx: ToolContext, hit: THREE.Vector3, radius: number, falloff: number, rate: number, limit: SculptLimit, cursorY: number): Rect | null {
		const t = ctx.terrain
		const h = t.heights
		const cs = t.cellSize
		const V = t.verts
		const x0 = Math.max(0, Math.floor((hit.x - radius) / cs))
		const z0 = Math.max(0, Math.floor((hit.z - radius) / cs))
		const x1 = Math.min(t.size, Math.ceil((hit.x + radius) / cs))
		const z1 = Math.min(t.size, Math.ceil((hit.z + radius) / cs))
		const w = x1 - x0 + 1
		const ph = z1 - z0 + 1
		if (w < 3 || ph < 3) return null
		const n = w * ph
		if (this.erodeMask.length < n) {
			this.erodeMask = new Float32Array(n)
			this.erodeWork = new Float32Array(n)
			this.erodeBefore = new Float32Array(n)
		}
		const mask = this.erodeMask
		const work = this.erodeWork
		const before = this.erodeBefore
		const thermal = editor.erode.kind === 'thermal'
		let drops = 0
		if (!thermal) {
			this.dropsOwed += rate * DROPS_RATE * Math.PI * (radius / cs) ** 2
			drops = Math.floor(this.dropsOwed)
			this.dropsOwed -= drops
			if (!drops) return null
		}
		mask.fill(0, 0, n)
		const r = forEachVertex(
			t,
			hit.x,
			hit.z,
			radius,
			falloff,
			(i, wt, x, z) => {
				if (keeps(h[i], limit, cursorY)) mask[(z - z0) * w + x - x0] = wt
			},
			this.stroke,
		)
		if (!r) return null
		for (let z = 0; z < ph; z++) {
			for (let x = 0; x < w; x++) {
				const v = h[(z0 + z) * V + x0 + x]
				before[z * w + x] = v
				work[z * w + x] = v / cs
			}
		}
		if (thermal) this.eroder.thermal(work, w, ph, talusSlope(editor.erode.talus), Math.min(1, rate * THERMAL_RATE))
		else this.eroder.droplets(work, w, ph, drops, mask)
		for (let z = 0; z < ph; z++) {
			for (let x = 0; x < w; x++) {
				const k = z * w + x
				if (mask[k] > 0) h[(z0 + z) * V + x0 + x] = before[k] + (work[k] * cs - before[k]) * mask[k]
			}
		}
		return r
	}
}

export class PaintTool extends BrushTool {
	protected label = 'Paint'
	private erasing = false
	/** Swap mode: the palette texture under the stroke's start, which the stroke replaces. */
	private swapFrom = -1

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
		const t = ctx.terrain
		this.swapFrom = -1
		this.swapDone.clear()
		if (hit && editor.paintMode === 'swap') {
			const sw = editor.swap
			if (sw.keep && sw.from) {
				this.swapFrom = paletteIndex(editor.palette, sw.from)
				if (this.swapFrom < 0) setStatus(`This map has no ${texName(sw.from)} to swap. Untick Keep to swap what is under the brush.`, 4000)
			} else {
				this.swapFrom = dominantTexel(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, texelAt(t, hit.x, hit.z))
				if (sw.keep && this.swapFrom >= 0) sw.from = editor.palette[this.swapFrom] ?? ''
			}
			if (this.swapFrom >= 0 && this.swapFrom === editor.paintLayer) setStatus('That texture is the active one already: pick the texture to swap to.', 3000)
		}
		super.onDown(ctx, hit)
	}

	protected apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
		if (editor.paintMode === 'swap') {
			this.swap(ctx, dt, hit)
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
		const n = sprayDabs(hit.x, hit.z, radius, dab, pressure, dt, Math.random, this.dabs)
		let refused = false
		for (let i = 0; i < n; i++) refused = this.paintAt(ctx, this.dabs[i * 2], this.dabs[i * 2 + 1], dab, falloff, amt) || refused
		if (inner && falloff < 1) refused = this.paintAt(ctx, hit.x, hit.z, radius * (1 - falloff), falloff, Math.min(1, strength * dt * 5)) || refused
		if (refused) this.chunkFull()
	}

	/** Spray dab centres for one frame, as x, z pairs. */
	private dabs = new Float32Array(MAX_DABS * 2)

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
		if (e.key !== 't' && e.key !== 'T') return false
		editor.paintSpray = !editor.paintSpray
		if (editor.paintSpray) editor.paintMode = 'texture'
		setStatus(editor.paintSpray ? 'Spray on' : 'Spray off', 1500)
		return true
	}

	/** Chunks a whole-layer swap has done in this stroke. */
	private swapDone = new Set<number>()
	private swapRect: Rect = { x0: 0, z0: 0, x1: 0, z1: 0 }

	/**
	 * Swaps the whole layer of the stroke's texture for the active one in each chunk the brush touches
	 * (Entire chunk) or in every chunk of the tile under the cursor (Entire tile), once a chunk a stroke,
	 * as Noggit Red's swapper's brush does. A chunk without the texture is left alone.
	 */
	private swapChunks(ctx: ToolContext, hit: THREE.Vector3, from: number, to: number) {
		const t = ctx.terrain
		const side = t.paintChunksPerSide
		const step = CHUNK_CELLS * t.cellSize
		const per = t.splatRes / side
		let x0: number, z0: number, x1: number, z1: number
		if (editor.swap.scope === 'tile') {
			const tile = TILE_CHUNKS * step
			x0 = Math.floor(hit.x / tile) * TILE_CHUNKS
			z0 = Math.floor(hit.z / tile) * TILE_CHUNKS
			x1 = x0 + TILE_CHUNKS - 1
			z1 = z0 + TILE_CHUNKS - 1
		} else {
			const r = editor.brush.radius
			x0 = Math.floor((hit.x - r) / step)
			z0 = Math.floor((hit.z - r) / step)
			x1 = Math.floor((hit.x + r) / step)
			z1 = Math.floor((hit.z + r) / step)
		}
		x0 = Math.max(0, x0)
		z0 = Math.max(0, z0)
		x1 = Math.min(side - 1, x1)
		z1 = Math.min(side - 1, z1)
		const r = this.swapRect
		for (let cz = z0; cz <= z1; cz++) {
			for (let cx = x0; cx <= x1; cx++) {
				const c = cz * side + cx
				if (this.swapDone.has(c)) continue
				// Entire chunk takes the chunks the brush circle reaches, not only those its square covers.
				if (editor.swap.scope === 'chunk') {
					const nx = Math.max(cx * step, Math.min(hit.x, (cx + 1) * step))
					const nz = Math.max(cz * step, Math.min(hit.z, (cz + 1) * step))
					if ((nx - hit.x) ** 2 + (nz - hit.z) ** 2 > editor.brush.radius ** 2) continue
				}
				this.swapDone.add(c)
				const slot = findSlot(t.chunkSlots, c, from)
				if (slot < 0) continue
				r.x0 = cx * per
				r.z0 = cz * per
				r.x1 = r.x0 + per - 1
				r.z1 = r.z0 + per - 1
				this.stroke?.reserveSplat(r)
				replaceInChunk(side, t.splatRes, t.chunkSlots, t.weights, c, slot, to)
				this.splatChanged(ctx, r)
			}
		}
	}

	/** Moves the stroke's starting texture onto the active layer under the brush. */
	private swap(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
		const from = this.swapFrom
		const to = editor.paintLayer
		if (from < 0 || from === to) return
		if (editor.swap.scope !== 'brush') {
			this.swapChunks(ctx, hit, from, to)
			return
		}
		const { radius, falloff } = editor.brush
		const strength = editor.brush.strength * ctx.pressure()
		const amt = Math.min(1, strength * dt * 5)
		let refused = 0
		const t = ctx.terrain
		const rect = forEachTexel(
			t,
			hit.x,
			hit.z,
			radius,
			falloff,
			(p, w) => {
				if (!swapTexel(t.paintChunksPerSide, t.splatRes, t.chunkSlots, t.weights, p, from, to, amt * w)) refused++
			},
			this.stroke,
		)
		if (refused) this.chunkFull()
		this.splatChanged(ctx, rect)
	}
}

/** Paints the selected texture with a hard edge and levels the ground across it. */
export class RoadTool extends BrushTool {
	protected label = 'Road'
	protected records = { heights: true, splat: true }

	radius() {
		return Math.max(1.5, editor.brush.radius * 0.5)
	}

	protected apply(ctx: ToolContext, dt: number, hit: THREE.Vector3) {
		const t = ctx.terrain
		const { radius, strength } = editor.brush
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
