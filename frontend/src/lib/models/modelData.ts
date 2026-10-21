import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { lodIndex, lodReady, type LodIndex } from './lod'
import { cullData, type CullData } from '../world/wmoGroupCull'

// What a loaded model needs besides its geometry, built from its buffers alone (#507): the bounds tree
// (three-mesh-bvh, which reorders the index within each group), the LOD's index and the WMO group
// cull's twin index, both from the reordered index. For Stormwind's 1.3M triangles that took over a
// second of one frame on the main thread (bounds tree 340 ms, LOD 840 ms, twin 50 ms), so the model
// worker (modelWorker.ts) runs it, and the main thread only wraps the results (modelBuild.ts).

/** A model's buffers for the worker: its own copies, which the post hands over (transfers). */
export interface ModelJob {
	positions: Float32Array
	index: Uint16Array | Uint32Array
	groups: { start: number; count: number; materialIndex: number }[]
	/** The WMO room attribute (two values a vertex), only for a model big enough for a group cull. */
	rooms?: Uint16Array
}

export interface ModelData {
	/** The model's index as the bounds tree reordered it: the geometry draws this one. */
	index: Uint16Array | Uint32Array
	/** The bounds tree's node buffers (`MeshBVH.serialize`). */
	roots: ArrayBuffer[]
	lod?: LodIndex
	/** The group cull's data; absent for a model sent without rooms, null when it gets no cull. */
	cull?: CullData | null
}

/** Builds a model's bounds tree, LOD and group cull from `job` (it reorders `job.index` in place). */
export async function buildModelData(job: ModelJob): Promise<ModelData> {
	const g = new THREE.BufferGeometry()
	g.setAttribute('position', new THREE.BufferAttribute(job.positions, 3))
	g.setIndex(new THREE.BufferAttribute(job.index, 1))
	for (const grp of job.groups) g.addGroup(grp.start, grp.count, grp.materialIndex)
	// The same options as `computeBoundsTree` (world/bvh.ts) uses on the main thread.
	const tree = new MeshBVH(g)
	const { roots } = MeshBVH.serialize(tree, { cloneBuffers: false })
	g.computeBoundingSphere()
	const out: ModelData = { index: job.index, roots }
	try {
		await lodReady
		out.lod = lodIndex(job.index, job.groups, job.positions, g.boundingSphere!.radius)
	} catch (err) {
		// The model is drawn whole at any distance.
		console.warn('model LOD failed', err)
	}
	if (job.rooms) out.cull = cullData(job.index, job.groups, job.positions, job.rooms)
	return out
}

/** The buffers of `data` a post can hand over instead of copying. */
export function transfers(data: ModelData): ArrayBuffer[] {
	const list = [data.index.buffer as ArrayBuffer, ...data.roots]
	if (data.lod) list.push(data.lod.index.buffer as ArrayBuffer)
	if (data.cull) list.push(data.cull.index.buffer as ArrayBuffer, data.cull.boxes.buffer as ArrayBuffer)
	return list
}
