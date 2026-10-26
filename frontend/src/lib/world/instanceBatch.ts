import * as THREE from 'three'
import { SkinnedInstancedMesh } from './Animator'
import { cullSpheres, instanceSphere, packMatrices, type CullView } from './instanceCull'
import { cullForShadows, setPacked } from './shadowReach'

// The instance batch ObjectLayer and SpawnLayer share (#517): the rows of one model's instances (a
// world matrix and a bounding sphere each), the cull that picks the ones in view, and the packing of
// those into an instanced mesh's buffer, with the item each instance draws for picking. What the
// layers keep apart is what they batch: the object tree, its LOD split and WMO extras in ObjectLayer;
// spawns grouped by kind and marker in SpawnLayer.

/** With more moved rows than this, a mesh uploads its whole instance buffer rather than a range a row. */
export const RANGES_MAX = 32

/** The instance buffers `pack` rewrote that three has not uploaded yet: a range upload would cut that short. */
const wholePending = new WeakSet<THREE.InstancedBufferAttribute>()

/** Sets up an instance buffer for rewrites every frame, and clears its pending whole upload once three has made it. */
export function watchUploads(attr: THREE.InstancedBufferAttribute) {
	attr.setUsage(THREE.DynamicDrawUsage)
	attr.onUpload(() => wholePending.delete(attr))
}

/**
 * An instanced mesh for up to `capacity` instances of a model, skinned when it has a `skeleton`,
 * drawing nothing until the first `pack`. Our own cull packs what is in view; three only culls it per
 * point-light shadow face (`cullForShadows`). `ids` names the item each instance draws, as `pack`
 * writes it; the mesh keeps it in `userData.ids` for `hitId`, by reference.
 */
export function instancedMesh<T>(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], capacity: number, skeleton: THREE.Skeleton | null | undefined, ids: T[]): THREE.InstancedMesh {
	const m = skeleton ? new SkinnedInstancedMesh(geometry, material, capacity, skeleton) : new THREE.InstancedMesh(geometry, material, capacity)
	watchUploads(m.instanceMatrix)
	m.count = 0
	m.visible = false
	m.userData.ids = ids
	cullForShadows(m)
	return m
}

/** The position of `v` in `sorted[from..to)`, ascending, or -1. */
function indexIn(sorted: number[], v: number, from = 0, to = sorted.length): number {
	let lo = from
	let hi = to - 1
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		const x = sorted[mid]
		if (x === v) return mid
		if (x < v) lo = mid + 1
		else hi = mid - 1
	}
	return -1
}

// Scratch for `patch`.
const patchM = new THREE.Matrix4()
const patchS = new Float32Array(4)
const patchSphere = new THREE.Sphere()

/**
 * The rows of one batch of instances: `items[i]` is drawn with the matrix at `matrices[i * 16]` and
 * has the bounding sphere at `spheres[i * 4]`. `cull` finds the rows in view (`packed`), and `pack`
 * and `patch` write them into the meshes that draw them.
 */
export class InstanceBatch<T> {
	/** What each row draws: an object id, a spawn. */
	items: T[] = []
	matrices = new Float32Array(0)
	spheres = new Float32Array(0)
	/**
	 * Indices into `items` of the rows in view as of the last `cull`: first the ones in the camera's view
	 * (`split.view` of them), then the ones only a shadow needs, each part ascending.
	 */
	readonly packed: number[] = []
	/** How many of `packed` lead as the rows in the camera's view. */
	readonly split = { view: 0 }
	private readonly scratch: number[] = []
	/** Makes the next `cull` report a change even with the same rows in view: rows were rewritten. */
	repack = true

	/** Makes room for `n` rows. The rows are not kept when it grows: write them all again. */
	reserve(n: number) {
		if (this.matrices.length >= n * 16) return
		this.matrices = new Float32Array(n * 16)
		this.spheres = new Float32Array(n * 4)
	}

	/** Writes row `i`: its matrix `m`, and the sphere of `geometry` placed by it. */
	setRow(i: number, m: THREE.Matrix4, geometry: THREE.BufferGeometry) {
		m.toArray(this.matrices, i * 16)
		instanceSphere(geometry, m, this.spheres, i * 4)
	}

	/**
	 * Finds the rows in `view` (`cullSpheres`; `exempt` is a row the room gate lets through, `doodads`
	 * cuts by the doodad draw distance) into `packed`. Returns whether they changed, or `repack` was set,
	 * so the meshes need packing again.
	 */
	cull(view: CullView, exempt = -1, doodads = false): boolean {
		const changed = cullSpheres(view, this.spheres, this.items.length, this.packed, this.scratch, exempt, doodads, this.split)
		const again = this.repack
		this.repack = false
		return changed || again
	}

	/**
	 * Packs the rows `which` names (indices into `items`, `packed` by default, the first `view` of them
	 * in the camera's view) to the front of `mesh`, and the items they draw into `ids` (the mesh's
	 * `userData.ids`). The mesh's `count` is the ones in view; its shadow passes draw them all
	 * (`setPacked`). An empty mesh is hidden: three would still set up each of its groups in every pass (#323).
	 */
	pack(mesh: THREE.InstancedMesh, ids: T[], which: number[] = this.packed, view = this.split.view) {
		packMatrices(this.matrices, which, mesh.instanceMatrix.array as Float32Array)
		ids.length = which.length
		for (let k = 0; k < which.length; k++) ids[k] = this.items[which[k]]
		setPacked(mesh, which.length, view)
		mesh.visible = which.length > 0
		// The whole buffer: a range left from a `patch` not yet uploaded would cut the upload short.
		mesh.instanceMatrix.clearUpdateRanges()
		mesh.instanceMatrix.needsUpdate = true
		wholePending.add(mesh.instanceMatrix)
		// Picking tests the mesh's sphere first, so it must cover the instances drawn (in view).
		mesh.computeBoundingSphere()
	}

	/**
	 * Writes the rows `moved` (indices into `items`, rewritten by `setRow` since the last pack) into
	 * `mesh`, where `which` (as packed into it, the first `view` of them in view) draws them, and
	 * uploads only those rows (#510). The mesh's sphere grows to cover the ones in view; the next
	 * `pack` fits it again.
	 */
	patch(mesh: THREE.InstancedMesh, moved: readonly number[], which: number[] = this.packed, view = this.split.view) {
		const attr = mesh.instanceMatrix
		const arr = attr.array as Float32Array
		const ranged = !wholePending.has(attr) && moved.length <= RANGES_MAX
		let any = false
		for (const i of moved) {
			let k = indexIn(which, i, 0, view)
			if (k < 0) k = indexIn(which, i, view)
			if (k < 0) continue
			const s = i * 16
			const d = k * 16
			for (let j = 0; j < 16; j++) arr[d + j] = this.matrices[s + j]
			if (ranged) attr.addUpdateRange(d, 16)
			patchM.fromArray(this.matrices, s)
			instanceSphere(mesh.geometry, patchM, patchS, 0)
			patchSphere.center.set(patchS[0], patchS[1], patchS[2])
			patchSphere.radius = patchS[3]
			if (mesh.boundingSphere && k < view) mesh.boundingSphere.union(patchSphere)
			any = true
		}
		if (!any) return
		if (!ranged) attr.clearUpdateRanges()
		attr.needsUpdate = true
		if (!mesh.boundingSphere) mesh.computeBoundingSphere()
	}
}
