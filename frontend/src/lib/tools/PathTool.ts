// The Path tool (#167, tool `path`, key K): roads, rivers and fences drawn along an editable spline, as Unreal's
// landscape splines. A click drops a control point on the ground (into the picked path, or a new one),
// a drag moves a point over the ground and Shift+drag raises or lowers it; Apply bakes the path into
// the map as one undo step, and applying it again first takes back what its last apply wrote. The
// paths are per-map state (`editor.paths`, saved in the map file's `paths` header), never exported.
import * as THREE from 'three'
import type { Tool, ToolContext } from './Tool'
import type { Command } from '../state/history'
import type { Terrain } from '../terrain/Terrain'
import { editor, setStatus } from '../state/editor.svelte'
import { paletteIndex } from '../terrain/chunkPaint'
import { copyPaths, nearestSegment, newPath, samplePath, type MapPath, type PathPoint } from '../terrain/paths'
import { applyPath, type FencePiece } from './pathApply'
import { displayName, loadAsset } from '../models/assets'

/** How far above the ground the curves and markers are drawn. */
const LIFT = 0.3
/** Yards a pixel of Shift+drag raises or lowers a point. */
const HEIGHT_PER_PX = 0.1
/** Sample spacing of the drawn curves, yards. */
const DRAW_STEP = 2
const PICKED_COLOR = new THREE.Color(0xffd34d)
const POINT_COLOR = new THREE.Color(0xff9a3c)
const OTHER_COLOR = new THREE.Color(0x9a8f80)
/** How far off the pointer's ray a point may be and still be picked, radians (about 8 px in a 1000 px view). */
const PICK_ANGLE = 0.012

/** What a path's last apply wrote, and whether it is in the map now (its undo step not undone). */
interface Applied {
	cmd: Command
	live: boolean
}

/** Draws every path's curve, the picked one's width on the ground, and a marker on each point. */
class PathView {
	readonly group = new THREE.Group()
	private curves: THREE.LineSegments
	private picked: THREE.LineSegments
	private edges: THREE.LineSegments
	/** A dot of a few pixels on each point, whatever the distance. */
	private markers: THREE.Points
	/** Which dot is which path's point, and where it is drawn. */
	private owners: Array<{ id: number; index: number; x: number; y: number; z: number }> = []
	private drawn: { list: unknown; version: number; id: number; point: number; heights: number; terrain: Terrain | null } = { list: null, version: -1, id: -1, point: -1, heights: -1, terrain: null }

	constructor() {
		this.curves = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xd8c8a8, transparent: true, opacity: 0.45 }))
		this.picked = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd34d, depthTest: false, transparent: true }))
		this.picked.renderOrder = 10
		this.edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.7 }))
		this.markers = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }))
		this.markers.renderOrder = 11
		for (const o of [this.curves, this.picked, this.edges, this.markers]) o.frustumCulled = false
		this.group.add(this.curves, this.edges, this.picked, this.markers)
	}

	/** Redraws when the paths, the pick or the ground changed since the last call; cheap otherwise. */
	update(list: readonly MapPath[], version: number, id: number, point: number, t: Terrain) {
		const d = this.drawn
		if (d.list === list && d.version === version && d.id === id && d.point === point && d.heights === t.heightVersion && d.terrain === t) return
		this.drawn = { list, version, id, point, heights: t.heightVersion, terrain: t }
		const other: number[] = []
		const mine: number[] = []
		const edge: number[] = []
		this.owners = []
		for (const p of list) {
			const sm = samplePath(p.points, DRAW_STEP)
			const out = p.id === id ? mine : other
			for (let i = 1; i < sm.n; i++) out.push(sm.x[i - 1], sm.y[i - 1] + LIFT, sm.z[i - 1], sm.x[i], sm.y[i] + LIFT, sm.z[i])
			if (p.id === id && sm.n > 1 && p.kind !== 'fence') {
				// The width, draped over the ground as it is now.
				const half = p.width / 2
				for (const side of [-1, 1]) {
					let px = 0,
						pz = 0
					for (let i = 0; i < sm.n; i++) {
						const a = Math.max(0, i - 1),
							b = Math.min(sm.n - 1, i + 1)
						const tx = sm.x[b] - sm.x[a],
							tz = sm.z[b] - sm.z[a]
						const len = Math.hypot(tx, tz) || 1
						const x = sm.x[i] - (tz / len) * half * side
						const z = sm.z[i] + (tx / len) * half * side
						if (i > 0) edge.push(px, t.heightAt(px, pz) + LIFT, pz, x, t.heightAt(x, z) + LIFT, z)
						px = x
						pz = z
					}
				}
			}
			p.points.forEach((q, index) => this.owners.push({ id: p.id, index, x: q.x, y: q.y + LIFT, z: q.z }))
		}
		setPositions(this.curves.geometry, other)
		setPositions(this.picked.geometry, mine)
		setPositions(this.edges.geometry, edge)
		const pos: number[] = []
		const col: number[] = []
		for (const o of this.owners) {
			pos.push(o.x, o.y, o.z)
			const c = o.id !== id ? OTHER_COLOR : o.index === point ? PICKED_COLOR : POINT_COLOR
			col.push(c.r, c.g, c.b)
		}
		setPositions(this.markers.geometry, pos)
		this.markers.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
	}

	/**
	 * The path point nearest a ray from the pointer, within PICK_ANGLE of it as seen from the ray's
	 * start (the camera), so a dot is as easy to hit near or far; the picked path's points first.
	 */
	pickPoint(ray: THREE.Ray, pickedId: number): { id: number; index: number } | null {
		let best: { id: number; index: number } | null = null
		let bestScore = Infinity
		for (const o of this.owners) {
			const dx = o.x - ray.origin.x,
				dy = o.y - ray.origin.y,
				dz = o.z - ray.origin.z
			const along = dx * ray.direction.x + dy * ray.direction.y + dz * ray.direction.z
			if (along <= 0) continue
			const off = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along)) / along
			if (off > PICK_ANGLE) continue
			const score = off - (o.id === pickedId ? PICK_ANGLE : 0)
			if (score < bestScore) {
				bestScore = score
				best = { id: o.id, index: o.index }
			}
		}
		return best
	}

	dispose() {
		for (const o of [this.curves, this.picked, this.edges]) {
			o.geometry.dispose()
			;(o.material as THREE.Material).dispose()
		}
		this.markers.geometry.dispose()
		;(this.markers.material as THREE.Material).dispose()
	}
}

function setPositions(g: THREE.BufferGeometry, v: number[]) {
	g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
	g.computeBoundingSphere()
}

/** The fields of a path the options bar sets. */
export type PathField = 'kind' | 'name' | 'width' | 'falloff' | 'grade' | 'texture' | 'edge' | 'depth' | 'liquid' | 'model' | 'spacing' | 'turn'

export class PathTool implements Tool {
	readonly usesBrush = false
	private view = new PathView()
	/** Bumped by every change made in place (a dragged point), so the view redraws. */
	private version = 0
	/**
	 * A point being dragged. The drag moves it in `paths`, a plain copy of the map's paths, and puts
	 * that into `editor.paths` on release, so a pointer move writes no reactive state.
	 */
	private drag: { id: number; index: number; before: MapPath[]; paths: MapPath[]; height: boolean; offset: number; moved: boolean; label: string } | null = null
	/** A run of changes to one field of one path, merged into one undo step while it stays on top. */
	private fieldRun: { cmd: Command; id: number; key: PathField; before: MapPath[] } | null = null
	/** Each map's paths' last applies, by path id. */
	private applies = new WeakMap<Terrain, Map<number, Applied>>()

	activate(ctx: ToolContext) {
		ctx.scene.add(this.view.group)
	}

	deactivate(ctx: ToolContext) {
		ctx.scene.remove(this.view.group)
		this.onUp(ctx)
	}

	frame(ctx: ToolContext) {
		this.view.update(this.drag?.paths ?? editor.paths, this.version, editor.pathId, editor.pathPoint, ctx.terrain)
	}

	/** The picked path, if any. */
	private current(): MapPath | undefined {
		return editor.paths.find((p) => p.id === editor.pathId)
	}

	/** Puts a copy of `list` into the map's paths, keeping the pick where it still means something. */
	private restore(list: readonly MapPath[]) {
		editor.paths = copyPaths(list)
		const p = this.current()
		if (!p) {
			editor.pathId = -1
			editor.pathPoint = -1
		} else if (editor.pathPoint >= p.points.length) editor.pathPoint = p.points.length - 1
		this.version++
	}

	/** Records the change from `before` to the paths now as one undo step. */
	private record(ctx: ToolContext, label: string, before: MapPath[]): Command {
		const after = editor.paths
		const cmd: Command = { label, undo: () => this.restore(before), redo: () => this.restore(after) }
		ctx.history.push(cmd)
		return cmd
	}

	onDown(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
		// The engine aimed the raycaster from the pointer before calling.
		const picked = this.view.pickPoint(ctx.raycaster.ray, editor.pathId)
		if (picked) {
			const p = editor.paths.find((q) => q.id === picked.id)
			const q = p?.points[picked.index]
			if (!q) return
			editor.pathId = picked.id
			editor.pathKind = p?.kind ?? editor.pathKind
			editor.pathPoint = picked.index
			this.drag = { ...picked, before: editor.paths, paths: copyPaths(editor.paths), height: e.shiftKey, offset: q.y - ctx.terrain.heightAt(q.x, q.z), moved: false, label: e.shiftKey ? 'Raise path point' : 'Move path point' }
			return
		}
		if (!hit) return
		const before = editor.paths
		const list = copyPaths(editor.paths)
		const point: PathPoint = { x: hit.x, y: hit.y, z: hit.z }
		let path = list.find((p) => p.id === editor.pathId)
		let index = 0
		if (!path) {
			path = newPath(list, editor.pathKind, editor.palette[editor.paintLayer] ?? '')
			path.points.push(point)
			list.push(path)
		} else {
			const pts = path.points
			// A click on the curve's width inserts a point there; else the path grows from its end,
			// or from its start while the first point is picked.
			const seg = nearestSegment(pts, hit.x, hit.z)
			if (seg.index >= 0 && seg.dist <= Math.max(path.width / 2, 3)) index = seg.index + 1
			else index = editor.pathPoint === 0 && pts.length > 1 ? 0 : pts.length
			pts.splice(index, 0, point)
		}
		editor.paths = list
		editor.pathId = path.id
		editor.pathPoint = index
		this.version++
		// The new point follows the pointer until the button is let go.
		this.drag = { id: path.id, index, before, paths: copyPaths(list), height: false, offset: 0, moved: true, label: path.points.length === 1 ? `New ${path.name}` : 'Add path point' }
	}

	onMove(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent) {
		const d = this.drag
		if (!d) return
		const q = d.paths.find((p) => p.id === d.id)?.points[d.index]
		if (!q) return
		if (d.height) {
			if (!e.movementY) return
			q.y -= e.movementY * HEIGHT_PER_PX
		} else {
			if (!hit) return
			q.x = hit.x
			q.z = hit.z
			q.y = ctx.terrain.heightAt(hit.x, hit.z) + d.offset
		}
		d.moved = true
		this.version++
	}

	onUp(ctx: ToolContext) {
		const d = this.drag
		this.drag = null
		if (!d?.moved) return
		editor.paths = d.paths
		this.version++
		this.record(ctx, d.label, d.before)
	}

	onKey(ctx: ToolContext, e: KeyboardEvent): boolean {
		if (e.key === 'Delete' || e.key === 'Backspace') {
			this.deletePoint(ctx)
			return true
		}
		if (e.key === 'Escape' && editor.pathId >= 0) {
			this.pick(-1)
			setStatus('No path picked: the next click starts a new one.', 2500)
			return true
		}
		if (e.key === 'Enter') {
			void this.apply(ctx)
			return true
		}
		return false
	}

	/** Picks path `id` (-1 for none, so the next click starts a new path). */
	pick(id: number) {
		editor.pathId = id
		editor.pathKind = this.current()?.kind ?? editor.pathKind
		editor.pathPoint = -1
		this.fieldRun = null
	}

	/** Deletes the picked point; a path left without points goes too. */
	deletePoint(ctx: ToolContext) {
		const p = this.current()
		if (!p || editor.pathPoint < 0 || editor.pathPoint >= p.points.length) {
			setStatus("Click a path's point to pick it first.", 2500)
			return
		}
		const before = editor.paths
		const list = copyPaths(editor.paths)
		const q = list.find((x) => x.id === p.id)!
		q.points.splice(editor.pathPoint, 1)
		editor.paths = q.points.length ? list : list.filter((x) => x !== q)
		editor.pathPoint = Math.min(editor.pathPoint, q.points.length - 1)
		if (!q.points.length) editor.pathId = -1
		this.version++
		this.record(ctx, 'Delete path point', before)
	}

	/** Deletes the picked path (what it applied stays in the map). */
	deletePath(ctx: ToolContext) {
		const p = this.current()
		if (!p) return
		const before = editor.paths
		editor.paths = editor.paths.filter((x) => x.id !== p.id)
		this.pick(-1)
		this.version++
		this.record(ctx, `Delete ${p.name}`, before)
	}

	/** Sets one setting of the picked path; a run of changes to the same one is one undo step. */
	setField<K extends PathField>(ctx: ToolContext, key: K, value: MapPath[K]) {
		const p = this.current()
		if (!p || p[key] === value) return
		const run = this.fieldRun
		const merge = run && run.id === p.id && run.key === key && ctx.history.peek() === run.cmd
		const before = merge ? run.before : editor.paths
		const list = copyPaths(editor.paths)
		list.find((x) => x.id === p.id)![key] = value
		editor.paths = list
		this.version++
		const after = list
		const cmd: Command = { label: `Set ${p.name} ${key}`, undo: () => this.restore(before), redo: () => this.restore(after) }
		if (merge) ctx.history.replaceTop(cmd)
		else ctx.history.push(cmd)
		this.fieldRun = { cmd, id: p.id, key, before }
	}

	private appliedOf(t: Terrain): Map<number, Applied> {
		let m = this.applies.get(t)
		if (!m) this.applies.set(t, (m = new Map()))
		return m
	}

	/**
	 * Bakes the picked path into the map as one undo step. If its last apply is still in the map, it is
	 * taken back first (the ground and paint it covered return to what they were before it), so moving
	 * a path and applying it again moves the road rather than leaving the old one behind.
	 */
	async apply(ctx: ToolContext) {
		const picked = this.current()
		if (!picked) {
			setStatus('Pick a path first: click one of its points, or the ground to start one.', 3000)
			return
		}
		// A fence's model is measured first: its long side is laid along the curve.
		let piece: FencePiece | undefined
		if (picked.kind === 'fence' && picked.model) {
			const t = ctx.terrain
			try {
				const size = (await loadAsset(picked.model)).bbox.getSize(new THREE.Vector3())
				piece = { length: Math.max(size.x, size.z), alongZ: size.z > size.x }
			} catch {
				setStatus(`Could not read ${displayName(picked.model)} to measure it.`, 5000)
				return
			}
			// The map or the path may have changed while the model was read.
			if (ctx.terrain !== t || !this.current()) return
		}
		const path = this.current()!
		const applied = this.appliedOf(ctx.terrain)
		const prev = applied.get(path.id)
		const again = !!prev?.live
		if (prev && again) {
			prev.cmd.undo()
			prev.live = false
		}
		const tex = path.texture ? paletteIndex(editor.palette, path.texture) : -1
		const res = applyPath({ terrain: ctx.terrain, objects: ctx.objects, liquids: ctx.liquids }, path, tex, piece)
		setStatus(res.message, 5000)
		if (!res.cmd) {
			if (prev && again) {
				prev.cmd.redo()
				prev.live = true
			}
			return
		}
		const fresh: Applied = { cmd: res.cmd, live: true }
		applied.set(path.id, fresh)
		const id = path.id
		ctx.history.push({
			label: again ? `${res.cmd.label} again` : res.cmd.label,
			undo: () => {
				fresh.cmd.undo()
				fresh.live = false
				if (prev && again) {
					prev.cmd.redo()
					prev.live = true
				}
				applied.set(id, prev ?? fresh)
			},
			redo: () => {
				if (prev && again) {
					prev.cmd.undo()
					prev.live = false
				}
				fresh.cmd.redo()
				fresh.live = true
				applied.set(id, fresh)
			},
		})
	}

	dispose() {
		this.view.dispose()
	}
}
