import * as THREE from 'three'
import { ROOM_ATTRIBUTE } from './roomGate'

// Culling a placed WMO by group (#198), for the scene pass. A WMO's mesh is all its groups merged into
// one geometry (a group per material), so once any part of it meets the view all of it was drawn: from
// Northshire, Stormwind's 1.3M triangles, though its groups in view hold 77k. The batch mesh of a WMO
// with groups draws a twin of the model's geometry instead: the same vertex buffers, and an index whose
// first half is the model's (each material's triangles sorted by WMO group, so a group is one run) and
// whose second half holds, per material, the runs of the groups whose boxes meet the camera's frustum.
// The scene pass draws the second half (onBeforeRender points each material's draw at it); the shadow
// passes draw the first, as their casters reach well past the view. Only a batch with a single drawn
// instance is culled, as one index can't suit two placements; the model's own geometry, its bounds
// tree and the picking it serves are left alone.

/** Smaller models aren't worth a second index: their groups are few or they draw little. */
export const MIN_TRIANGLES = 20000
export const MIN_GROUPS = 4

/** A run of a material's triangles that belong to one WMO group (or two, for a doodad shared by rooms). */
interface Run {
	/** The WMO groups plus one (0 for none, always drawn), as the room attribute holds them. */
	a: number
	b: number
	/** Into the twin's index, in indices. */
	start: number
	count: number
}

export class WmoGroupCull {
	/** Off draws every WMO whole, for comparing in a probe (`__engine` has no switch for it). */
	static enabled = true
	/** The geometry the batch mesh draws. */
	readonly geometry: THREE.BufferGeometry
	/** Each WMO group's box in model space, by group (the room attribute's value minus one). */
	readonly boxes: THREE.Box3[]
	private readonly runs: Run[][]
	/** Each material group's range in the full half and in the view half. */
	private readonly full: { start: number; count: number }[]
	private readonly view: { start: number; count: number }[]
	private readonly groupIndex = new Map<object, number>()
	private readonly visible: Uint8Array
	private readonly half: number
	/** The camera the view half was culled for; any other draws the full half. */
	private camera: THREE.Camera | null = null
	private saved = { start: 0, count: 0 }
	private readonly frustum = new THREE.Frustum()
	private readonly inverse = new THREE.Matrix4()
	private readonly matrix = new THREE.Matrix4()

	private constructor(source: THREE.BufferGeometry, room: THREE.BufferAttribute, groupCount: number) {
		// From the model's own index, before the twin's view half (zeros at first) could count.
		if (!source.boundingBox) source.computeBoundingBox()
		if (!source.boundingSphere) source.computeBoundingSphere()
		const src = source.index!.array
		const half = src.length
		this.half = half
		const index = new Uint32Array(half * 2)
		const g = new THREE.BufferGeometry()
		for (const [name, attr] of Object.entries(source.attributes)) g.setAttribute(name, attr)
		g.setIndex(new THREE.BufferAttribute(index, 1))
		g.boundingBox = source.boundingBox?.clone() ?? null
		g.boundingSphere = source.boundingSphere?.clone() ?? null
		this.runs = []
		this.full = []
		this.view = []
		const groups = source.groups.length ? source.groups : [{ start: 0, count: half, materialIndex: 0 }]
		for (const grp of groups) {
			const start = grp.start
			const end = Math.min(half, grp.start + grp.count)
			// A stable sort of the material's triangles by their WMO groups.
			const byKey = new Map<number, number[]>()
			for (let t = start; t + 2 < end; t += 3) {
				const v = src[t]
				const key = room.getX(v) * 65536 + room.getY(v)
				let list = byKey.get(key)
				if (!list) byKey.set(key, (list = []))
				list.push(t)
			}
			const runs: Run[] = []
			let o = start
			for (const [key, list] of byKey) {
				const run = { a: Math.floor(key / 65536), b: key % 65536, start: o, count: list.length * 3 }
				for (const t of list) {
					index[o++] = src[t]
					index[o++] = src[t + 1]
					index[o++] = src[t + 2]
				}
				runs.push(run)
			}
			this.runs.push(runs)
			this.full.push({ start, count: end - start })
			this.view.push({ start: half + start, count: 0 })
			const twin = { start, count: end - start, materialIndex: grp.materialIndex ?? 0 }
			g.groups.push(twin)
			this.groupIndex.set(twin, this.full.length - 1)
		}
		this.geometry = g
		g.userData.drawnIndexCount = half
		this.boxes = Array.from({ length: groupCount }, () => new THREE.Box3())
		const pos = source.attributes.position
		const p = new THREE.Vector3()
		for (let v = 0; v < pos.count; v++) {
			const a = room.getX(v)
			const b = room.getY(v)
			if (!a && !b) continue
			p.fromBufferAttribute(pos, v)
			if (a) this.boxes[a - 1].expandByPoint(p)
			if (b) this.boxes[b - 1].expandByPoint(p)
		}
		this.visible = new Uint8Array(groupCount)
	}

	/**
	 * The cull for a model's geometry, made once and kept with it, or null for a model without WMO
	 * groups or too small to be worth one.
	 */
	static of(source: THREE.BufferGeometry, minTriangles = MIN_TRIANGLES, minGroups = MIN_GROUPS): WmoGroupCull | null {
		const cached = culls.get(source)
		if (cached !== undefined) return cached
		const room = source.getAttribute(ROOM_ATTRIBUTE) as THREE.BufferAttribute | undefined
		let cull: WmoGroupCull | null = null
		if (room && room.itemSize === 2 && source.index && source.index.count / 3 >= minTriangles) {
			let groups = 0
			for (let v = 0; v < room.count; v++) groups = Math.max(groups, room.getX(v), room.getY(v))
			if (groups >= minGroups) cull = new WmoGroupCull(source, room, groups)
		}
		culls.set(source, cull)
		return cull
	}

	/**
	 * Culls the groups for one instance placed by `matrix` (world from model) against `frustum`, the
	 * view of `camera`, and rewrites the view half when the groups in view changed. `null` stops it:
	 * every pass draws the full half again.
	 */
	update(camera: THREE.Camera | null, frustum: THREE.Frustum, matrix: ArrayLike<number>) {
		this.camera = camera
		if (!camera) {
			this.geometry.userData.drawnIndexCount = this.half
			return
		}
		this.matrix.fromArray(matrix as number[])
		this.inverse.copy(this.matrix).invert()
		const f = this.frustum.copy(frustum)
		for (const plane of f.planes) plane.applyMatrix4(this.inverse)
		let changed = false
		for (let i = 0; i < this.boxes.length; i++) {
			const box = this.boxes[i]
			const v = !box.isEmpty() && f.intersectsBox(box) ? 1 : 0
			if (v !== this.visible[i]) {
				this.visible[i] = v
				changed = true
			}
		}
		if (changed || this.drawn < 0) this.compact()
		else this.geometry.userData.drawnIndexCount = this.drawn
	}

	/** Indices the scene pass draws, for the performance overlay; -1 before the first cull. */
	drawn = -1

	private compact() {
		const index = this.geometry.index!
		const arr = index.array as Uint32Array
		const vis = this.visible
		index.clearUpdateRanges()
		let total = 0
		for (let k = 0; k < this.runs.length; k++) {
			const view = this.view[k]
			let o = view.start
			for (const r of this.runs[k]) {
				const seen = (!r.a && !r.b) || (r.a > 0 && vis[r.a - 1]) || (r.b > 0 && vis[r.b - 1])
				if (!seen) continue
				arr.copyWithin(o, r.start, r.start + r.count)
				o += r.count
			}
			view.count = o - view.start
			total += view.count
			if (view.count) index.addUpdateRange(view.start, view.count)
		}
		index.needsUpdate = true
		this.drawn = total
		this.geometry.userData.drawnIndexCount = total
	}

	/** Points a material's draw at the view half, for the culled camera's scene pass only. */
	before(camera: THREE.Camera, group: { start: number; count: number } | null) {
		if (!group || camera !== this.camera || this.drawn < 0) return
		const k = this.groupIndex.get(group)
		if (k === undefined) return
		this.saved.start = group.start
		this.saved.count = group.count
		group.start = this.view[k].start
		group.count = this.view[k].count
	}

	after(camera: THREE.Camera, group: { start: number; count: number } | null) {
		if (!group || camera !== this.camera || this.drawn < 0) return
		if (this.groupIndex.get(group) === undefined) return
		group.start = this.saved.start
		group.count = this.saved.count
	}

	/** The twin's index for the full model, as the first half holds it (for tests). */
	fullRange(k: number) {
		return this.full[k]
	}

	viewRange(k: number) {
		return this.view[k]
	}

	get halfLength() {
		return this.half
	}
}

const culls = new WeakMap<THREE.BufferGeometry, WmoGroupCull | null>()
