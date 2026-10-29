import * as THREE from 'three'
import { ui } from '../state/editor.svelte'
import type { Command, History } from '../state/history'
import type { Terrain } from '../terrain/Terrain'
import { editor } from './BrushTool'
import { forEachVertex, type Rect, type TerrainStroke } from './brush'
import type { ToolContext } from './Tool'
import { VertexSelection, flattenVertices, moveVertices, orientVertices, type VertexRect } from './vertexEdit'

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

/**
 * Sculpt's Vertex mode, owned by the Sculpt tool: the selected vertices of the active map, the dots
 * drawn on them, a Shift stroke moving them, and the slope (orient) laid onto them from the options
 * bar. `heightsChanged` is the Sculpt tool's own, so an edit marks the map and its stroke as a brush does.
 */
export class VertexMode {
	// The selected vertices of `vselTerrain`, whether this stroke moves them (Shift) or deselects
	// (Ctrl or Alt), the last cursor point, and the slope last applied.
	private vsel: VertexSelection | null = null
	private vselTerrain: Terrain | null = null
	moving = false
	deselecting = false
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

	constructor(private heightsChanged: (ctx: ToolContext, r: Rect | null) => void) {}

	/** The vertex selection for the active map; a new map starts with none. */
	selection(t: Terrain): VertexSelection {
		if (!this.vsel || this.vselTerrain !== t) {
			this.vsel = new VertexSelection(t.verts)
			this.vselTerrain = t
			this.selectionChanged()
		}
		return this.vsel
	}

	/** Resets the slope to level for a new selection, as noggit3 does, and publishes the count. */
	selectionChanged() {
		this.recordOrient()
		editor.vertexAngle = 0
		editor.vertexDir = 0
		this.applied = { angle: 0, dir: 0, ref: editor.vertexRef }
		this.orientSession = null
		ui.vertexCount = this.vsel?.size ?? 0
	}

	/** The brush selects vertices under it (Ctrl or Alt deselects); a Shift stroke moves them in `move` instead. */
	brush(t: Terrain, hit: THREE.Vector3, radius: number) {
		if (this.moving) return
		const sel = this.selection(t)
		const off = this.deselecting
		forEachVertex(t, hit.x, hit.z, radius, 0, (i) => (off ? sel.remove(i) : sel.add(i)))
	}

	/** A Shift-drag moves the selection up and down with the mouse, faster at higher strength. */
	move(ctx: ToolContext, stroke: TerrainStroke, e: PointerEvent) {
		const sel = this.selection(ctx.terrain)
		const r = sel.rect()
		if (!r || !e.movementY) return
		stroke.reserveHeights(r)
		moveVertices(ctx.terrain.heights, sel, -e.movementY * 0.2 * editor.brush.strength * ctx.pressure())
		this.heightsChanged(ctx, r)
	}

	/** After a stroke that picked vertices: publishes the new count (and levels the slope) when it changed. */
	strokeEnded(t: Terrain) {
		const sel = this.selection(t)
		if (sel.size !== ui.vertexCount) this.selectionChanged()
	}

	/** Each frame: notes the cursor, lays a changed slope (in Vertex mode, `on`) and draws the markers. */
	frame(ctx: ToolContext, hit: THREE.Vector3 | null, on: boolean) {
		if (hit) {
			this.cursor.copy(hit)
			this.hasCursor = true
		}
		const sel = on ? this.selection(ctx.terrain) : null
		const a = this.applied
		if (sel && sel.size && (editor.vertexAngle !== a.angle || editor.vertexDir !== a.dir || editor.vertexRef !== a.ref)) this.orient(ctx, sel)
		else this.recordOrient()
		this.drawMarkers(ctx, sel)
	}

	/** Records any open slope edit and hides the markers (the tool or mode is left). */
	hide(ctx: ToolContext) {
		this.recordOrient()
		this.drawMarkers(ctx, null)
	}

	dispose() {
		this.markers?.geometry.dispose()
		;(this.markers?.material as THREE.Material | undefined)?.dispose()
	}

	/** Space turns the slope to rise from the cursor toward the selection centre. */
	onKey(ctx: ToolContext) {
		const sel = this.selection(ctx.terrain)
		if (!sel.size || !this.hasCursor) return
		const c = sel.center(ctx.terrain.heights, ctx.terrain.cellSize, this.vcenter)
		const deg = (Math.atan2(c.z - this.cursor.z, c.x - this.cursor.x) * 180) / Math.PI
		editor.vertexDir = Math.round((deg + 360) % 360)
	}

	/** Vertex mode actions from the options bar: flatten the selection to its mean height, or clear it. */
	action(ctx: ToolContext, action: 'flatten' | 'clear') {
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
	recordOrient() {
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
		if (key.sel === sel && key.terrain === t && key.version === sel.version && key.size === n && key.heights === t.heightEditVersion) {
			m.visible = true
			return
		}
		key.sel = sel
		key.terrain = t
		key.version = sel.version
		key.size = n
		key.heights = t.heightEditVersion
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
}
