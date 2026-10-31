import * as THREE from 'three'
import { ROOM_ATTRIBUTE } from './roomGate'
import { addShadowGroups, shadowRunOf, type ShadowRun } from './shadowRun'

// Culling a placed WMO by group (#198), for the scene pass. A WMO's mesh is all its groups merged into
// one geometry (a group per material), so once any part of it meets the view all of it was drawn: from
// Northshire, Stormwind's 1.3M triangles, though its groups in view hold 77k. The batch mesh of a WMO
// with groups draws a twin of the model's geometry instead: the same vertex buffers, and an index whose
// first half is the model's (each material's triangles sorted by WMO group, so a group is one run) and
// whose second half holds, per material, the runs of the groups whose boxes meet the camera's frustum
// or the near shadow cascade's. The scene pass and the near cascade draw the second half
// (onBeforeRender and onBeforeShadow point each material's draw at it); the far cascade and the point
// lights' cubes draw the first. The near cascade is redrawn every frame, and from Northshire its box
// holds 2k of Stormwind's 1.33M triangles, while the far one holds 1.2M and is redrawn only when its
// fit changes (#215). The cascade sits mostly in the view, so sharing the view half costs the scene
// pass little and needs no third half (16 MB for Stormwind). Only a batch with a single drawn
// instance is culled, as one index can't suit two placements; the model's own geometry, its bounds
// tree and the picking it serves are left alone. The materials whose shadow draws merge into one
// (world/shadowRun.ts, #926) lead the model's index, and the view half keeps their runs one after
// another too, so both halves draw them as one call in a shadow pass (`shadowBefore`).

/** Smaller models aren't worth a second index: their groups are few or they draw little. */
export const MIN_TRIANGLES = 20000
export const MIN_GROUPS = 4

/** A run of a material's triangles that belong to one WMO group (or two, for a doodad shared by rooms). */
export interface Run {
	/** The WMO groups plus one (0 for none, always drawn), as the room attribute holds them. */
	a: number
	b: number
	/** Into the twin's index, in indices. */
	start: number
	count: number
}

/** A material group of the model: its range in the model's index. */
export interface IndexGroup {
	start: number
	count: number
	materialIndex?: number
}

/**
 * What the cull is made of, built off the main thread for a loaded model (models/modelWorker.ts, #507)
 * and plain enough to post between threads.
 */
export interface CullData {
	/** The twin's index: the model's, each material's triangles sorted by WMO group, then as much again for the view half. */
	index: Uint32Array
	/** Each material group's runs, in the order of the model's groups. */
	runs: Run[][]
	/** Each WMO group's box in model space (min xyz, max xyz), empty (min > max) for a group with no vertices. */
	boxes: Float32Array
}

/**
 * Builds the twin's index and the WMO groups' boxes from the model's `index` (after its bounds tree
 * reordered it), its material `groups`, `positions` (xyz) and `rooms` (the room attribute's two values
 * a vertex), or null for a model without enough triangles or WMO groups to be worth one. Pure, so the
 * model worker runs it too.
 */
export function cullData(index: ArrayLike<number>, groups: readonly IndexGroup[], positions: ArrayLike<number>, rooms: ArrayLike<number>, minTriangles = MIN_TRIANGLES, minGroups = MIN_GROUPS): CullData | null {
	const half = index.length
	if (half / 3 < minTriangles) return null
	const vertices = rooms.length / 2
	let groupCount = 0
	for (let i = 0; i < rooms.length; i++) if (rooms[i] > groupCount) groupCount = rooms[i]
	if (groupCount < minGroups) return null
	const twin = new Uint32Array(half * 2)
	const runs: Run[][] = []
	const list = groups.length ? groups : [{ start: 0, count: half }]
	for (const grp of list) {
		const start = grp.start
		const end = Math.min(half, grp.start + grp.count)
		// A stable sort of the material's triangles by their WMO groups.
		const byKey = new Map<number, number[]>()
		for (let t = start; t + 2 < end; t += 3) {
			const v = index[t]
			const key = rooms[2 * v] * 65536 + rooms[2 * v + 1]
			let tris = byKey.get(key)
			if (!tris) byKey.set(key, (tris = []))
			tris.push(t)
		}
		const material: Run[] = []
		let o = start
		for (const [key, tris] of byKey) {
			const run = { a: Math.floor(key / 65536), b: key % 65536, start: o, count: tris.length * 3 }
			for (const t of tris) {
				twin[o++] = index[t]
				twin[o++] = index[t + 1]
				twin[o++] = index[t + 2]
			}
			material.push(run)
		}
		runs.push(material)
	}
	const boxes = new Float32Array(groupCount * 6)
	for (let g = 0; g < groupCount; g++) boxes.fill(Infinity, g * 6, g * 6 + 3).fill(-Infinity, g * 6 + 3, g * 6 + 6)
	const grow = (g: number, v: number) => {
		const o = g * 6
		for (let k = 0; k < 3; k++) {
			const x = positions[3 * v + k]
			if (x < boxes[o + k]) boxes[o + k] = x
			if (x > boxes[o + 3 + k]) boxes[o + 3 + k] = x
		}
	}
	for (let v = 0; v < vertices; v++) {
		const a = rooms[2 * v]
		const b = rooms[2 * v + 1]
		if (a) grow(a - 1, v)
		if (b) grow(b - 1, v)
	}
	return { index: twin, runs, boxes }
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
	/**
	 * Each material group of the twin geometry, and its index by identity: the render hooks hand the
	 * group they draw as three's typings declare it (an Object3D `Group`, though it is the geometry's
	 * group), so it is only looked up here and the typed twin is what gets moved (#521).
	 */
	private readonly twins: THREE.GeometryGroup[] = []
	private readonly groupIndex = new Map<object, number>()
	private readonly visible: Uint8Array
	private readonly half: number
	/** The camera the view half was culled for, and the near cascade's; any other draws the full half. */
	private camera: THREE.Camera | null = null
	private shadowCamera: THREE.Camera | null = null
	private saved = { start: 0, count: 0 }
	/** The materials whose shadow draws merge (world/shadowRun.ts), or null; and their run in the view half. */
	private readonly merge: ShadowRun | null
	private readonly merged: Uint8Array
	private readonly mergedView = { start: 0, count: 0 }
	/** The twin's shadow-list group for the merged run (`addShadowGroups`), or null. */
	private readonly shadowLead: THREE.GeometryGroup | null
	private readonly frustum = new THREE.Frustum()
	private readonly shadowFrustum = new THREE.Frustum()
	private readonly inverse = new THREE.Matrix4()
	private readonly matrix = new THREE.Matrix4()

	private constructor(source: THREE.BufferGeometry, data: CullData) {
		if (!source.boundingBox) source.computeBoundingBox()
		if (!source.boundingSphere) source.computeBoundingSphere()
		const half = data.index.length / 2
		this.half = half
		const g = new THREE.BufferGeometry()
		for (const [name, attr] of Object.entries(source.attributes)) g.setAttribute(name, attr)
		g.setIndex(new THREE.BufferAttribute(data.index, 1))
		g.boundingBox = source.boundingBox?.clone() ?? null
		g.boundingSphere = source.boundingSphere?.clone() ?? null
		// The batch mesh is raycast through the geometry it draws, this twin: without the model's bounds
		// tree every pick and sight line walked all of its triangles, over a second a ray in Blackrock
		// Depths (#286). The tree tests the model's own index, which holds the same triangles.
		g.boundsTree = source.boundsTree
		this.runs = data.runs
		this.full = []
		this.view = []
		const groups = source.groups.length ? source.groups : [{ start: 0, count: half, materialIndex: 0 }]
		for (const grp of groups) {
			const start = grp.start
			const end = Math.min(half, grp.start + grp.count)
			this.full.push({ start, count: end - start })
			this.view.push({ start: half + start, count: 0 })
			const twin = { start, count: end - start, materialIndex: grp.materialIndex ?? 0 }
			g.groups.push(twin)
			this.twins.push(twin)
			this.groupIndex.set(twin, this.full.length - 1)
		}
		this.geometry = g
		g.userData.drawnIndexCount = half
		const b = data.boxes
		this.boxes = []
		for (let o = 0; o < b.length; o += 6) {
			const box = new THREE.Box3()
			// An empty group keeps three's empty box.
			if (b[o] <= b[o + 3]) {
				box.min.set(b[o], b[o + 1], b[o + 2])
				box.max.set(b[o + 3], b[o + 4], b[o + 5])
			}
			this.boxes.push(box)
		}
		this.visible = new Uint8Array(this.boxes.length)
		const run = shadowRunOf(source)
		this.merge = run && run.groups.every((k) => k < this.twins.length) ? run : null
		this.merged = new Uint8Array(this.twins.length)
		if (this.merge) for (const k of this.merge.groups) this.merged[k] = 1
		this.mergedView.start = half + (this.merge?.start ?? 0)
		this.shadowLead = this.merge ? addShadowGroups(g, this.merge) : null
	}

	/**
	 * The cull for a model's geometry, made once and kept with it, or null for a model without WMO
	 * groups or too small to be worth one. A model loaded through assets.ts has it from the model
	 * worker already (`adopt`); built here, it costs the main thread tens of ms for a city.
	 */
	static of(source: THREE.BufferGeometry, minTriangles = MIN_TRIANGLES, minGroups = MIN_GROUPS): WmoGroupCull | null {
		const cached = culls.get(source)
		if (cached !== undefined) return cached
		const room = source.getAttribute(ROOM_ATTRIBUTE) as THREE.BufferAttribute | undefined
		const pos = source.getAttribute('position') as THREE.BufferAttribute | undefined
		let data: CullData | null = null
		if (room && room.itemSize === 2 && pos && source.index) data = cullData(source.index.array, source.groups, pos.array, room.array, minTriangles, minGroups)
		return WmoGroupCull.adopt(source, data)
	}

	/** The cull already made for `source`, or null: never builds one (the outline's mask pass, #642). */
	static existing(source: THREE.BufferGeometry): WmoGroupCull | null {
		return culls.get(source) ?? null
	}

	/** Keeps the cull built from `data` (or none, for null) as the one of `source`. */
	static adopt(source: THREE.BufferGeometry, data: CullData | null): WmoGroupCull | null {
		const cull = data ? new WmoGroupCull(source, data) : null
		culls.set(source, cull)
		// The twin's index goes with the model it was made of (assets.ts releaseAssets, #505).
		const twin = cull?.geometry
		if (twin) source.addEventListener('dispose', () => twin.dispose())
		return cull
	}

	/**
	 * Culls the groups for one instance placed by `matrix` (world from model) against `frustum`, the
	 * view of `camera`, and `shadowFrustum`, the near shadow cascade's of `shadowCamera` (null without
	 * shadows), and rewrites the view half when the groups in either changed. A null `camera` stops it:
	 * every pass draws the full half again.
	 */
	update(camera: THREE.Camera | null, frustum: THREE.Frustum, matrix: ArrayLike<number>, shadowCamera: THREE.Camera | null = null, shadowFrustum: THREE.Frustum | null = null) {
		this.camera = camera
		this.shadowCamera = camera && shadowFrustum ? shadowCamera : null
		if (!camera) {
			this.geometry.userData.drawnIndexCount = this.half
			return
		}
		this.matrix.fromArray(matrix as number[])
		this.inverse.copy(this.matrix).invert()
		const f = this.frustum.copy(frustum)
		for (const plane of f.planes) plane.applyMatrix4(this.inverse)
		const s = this.shadowCamera ? this.shadowFrustum.copy(shadowFrustum!) : null
		if (s) for (const plane of s.planes) plane.applyMatrix4(this.inverse)
		let changed = false
		for (let i = 0; i < this.boxes.length; i++) {
			const box = this.boxes[i]
			const v = !box.isEmpty() && (f.intersectsBox(box) || (s !== null && s.intersectsBox(box))) ? 1 : 0
			if (v !== this.visible[i]) {
				this.visible[i] = v
				changed = true
			}
		}
		if (changed || this.drawn < 0) this.compact()
		else this.geometry.userData.drawnIndexCount = this.drawn
	}

	/**
	 * Whether the view half was culled for the instance placed by `m` (world from model): another
	 * instance of the model, such as a selected one too small on screen to be drawn while this one is,
	 * would draw this one's groups. The instance matrix is stored as floats, hence the tolerance.
	 */
	culledFor(m: THREE.Matrix4) {
		const a = this.matrix.elements
		const b = m.elements
		for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > 1e-3 * Math.max(1, Math.abs(b[i]))) return false
		return true
	}

	/** Indices the scene pass (and the near cascade) draws, for the performance overlay; -1 before the first cull. */
	drawn = -1

	private compact() {
		const index = this.geometry.index!
		const arr = index.array as Uint32Array
		const vis = this.visible
		index.clearUpdateRanges()
		let total = 0
		// The merged materials' view runs follow one another from the start of their run (their groups
		// come in index order, `orderForShadows`), so they stay within the view half's mirror of that run
		// and a shadow pass draws them as one range.
		let next = this.mergedView.start
		for (let k = 0; k < this.runs.length; k++) {
			const view = this.view[k]
			if (this.merged[k]) view.start = next
			let o = view.start
			for (const r of this.runs[k]) {
				const seen = (!r.a && !r.b) || (r.a > 0 && vis[r.a - 1]) || (r.b > 0 && vis[r.b - 1])
				if (!seen) continue
				arr.copyWithin(o, r.start, r.start + r.count)
				o += r.count
			}
			view.count = o - view.start
			if (this.merged[k]) next = o
			total += view.count
			if (view.count) index.addUpdateRange(view.start, view.count)
		}
		this.mergedView.count = next - this.mergedView.start
		index.needsUpdate = true
		this.drawn = total
		this.geometry.userData.drawnIndexCount = total
	}

	/** Whether `camera` (the scene pass's, or a shadow pass's own) draws the view half. */
	private draws(camera: THREE.Camera) {
		return this.drawn >= 0 && this.camera !== null && (camera === this.camera || camera === this.shadowCamera)
	}

	/**
	 * Points a material's draw at the view half, for the culled camera's scene pass and the near
	 * cascade's shadow pass only (pass the shadow camera from `onBeforeShadow`, not the view camera).
	 */
	before(camera: THREE.Camera, drawn: object | null) {
		if (!drawn || !this.draws(camera)) return
		const k = this.groupIndex.get(drawn)
		if (k === undefined) return
		const group = this.twins[k]
		this.saved.start = group.start
		this.saved.count = group.count
		group.start = this.view[k].start
		group.count = this.view[k].count
	}

	/**
	 * `before` for a shadow pass: the shadow list's group for the merged materials draws their run in
	 * the view half for the near cascade, and in the full half (as it stands) for the far one and the
	 * point lights; any other material as `before` points it.
	 */
	shadowBefore(camera: THREE.Camera, drawn: object | null) {
		const lead = this.shadowLead
		if (!lead || drawn !== lead) return this.before(camera, drawn)
		if (!this.draws(camera)) return
		lead.start = this.mergedView.start
		// A negative count makes three's `renderBufferDirect` return before its draw call, which a count of 0 would still issue.
		lead.count = this.mergedView.count || -1
	}

	shadowAfter(camera: THREE.Camera, drawn: object | null) {
		const lead = this.shadowLead
		if (!lead || drawn !== lead) return this.after(camera, drawn)
		lead.start = this.merge!.start
		lead.count = this.merge!.count
	}

	after(camera: THREE.Camera, drawn: object | null) {
		if (!drawn || !this.draws(camera)) return
		const k = this.groupIndex.get(drawn)
		if (k === undefined) return
		const group = this.twins[k]
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
