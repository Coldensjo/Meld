import * as THREE from 'three'
import { MeshoptSimplifier } from 'meshoptimizer'

/** The share of a model's triangles its LOD aims for. */
const LOD_RATIO = 0.25
/** The largest error the LOD may make, as a share of the model's bounding radius. */
const LOD_ERROR = 0.02
/** A LOD is only kept when it drops at least this share of the triangles. */
const MIN_SAVING = 0.3

/** A LOD's index and its material groups, as the model worker posts it back (models/modelWorker.ts). */
export interface LodIndex {
	index: Uint16Array | Uint32Array
	groups: { start: number; count: number; materialIndex: number }[]
}

/** Resolves once `lodIndex` can run (meshoptimizer's WebAssembly is ready). */
export const lodReady: Promise<void> = MeshoptSimplifier.ready

/**
 * The index of a simplified version of a model (meshoptimizer, MIT), or undefined when simplifying
 * would not save enough: `index` and `groups` are the model's, `positions` its vertices (xyz) and
 * `radius` its bounding radius. Each material group is simplified on its own, so the groups and
 * materials stay as they are. Await `lodReady` first. Pure, so the model worker runs it too.
 */
export function lodIndex(index: Uint16Array | Uint32Array, groups: readonly { start: number; count: number; materialIndex?: number }[], positions: Float32Array, radius: number): LodIndex | undefined {
	const maxError = radius * LOD_ERROR
	const list = groups.length ? groups : [{ start: 0, count: index.length, materialIndex: 0 }]
	const parts: Uint32Array[] = []
	let total = 0
	for (const g of list) {
		const ids = new Uint32Array(index.subarray(g.start, g.start + g.count))
		const target = Math.floor((ids.length * LOD_RATIO) / 3) * 3
		// Sparse: a group uses only some of the vertices. The error is in model units, the same for every group.
		const [out] = MeshoptSimplifier.simplify(ids, positions, 3, target, maxError, ['Sparse', 'ErrorAbsolute'])
		parts.push(out)
		total += out.length
	}
	if (total > index.length * (1 - MIN_SAVING)) return

	const merged = positions.length / 3 < 65535 ? new Uint16Array(total) : new Uint32Array(total)
	const out: LodIndex = { index: merged, groups: [] }
	let at = 0
	parts.forEach((p, i) => {
		merged.set(p, at)
		out.groups.push({ start: at, count: p.length, materialIndex: list[i].materialIndex ?? 0 })
		at += p.length
	})
	return out
}

/**
 * A far WMO's LOD with its groups merged by class (#691), as the model worker posts it back: the
 * vertices are the model's, picked out again (`src`), so that each one belongs to one group and can
 * carry that group's texture layer (models/farLayers.ts).
 */
export interface FarMerge {
	/** The model's vertex each of the merged LOD's vertices copies. */
	src: Uint32Array
	index: Uint16Array | Uint32Array
	/**
	 * The draw groups: one a class, whose `materialIndex` is the model's material count plus the class,
	 * then each group kept apart, with its own material's index.
	 */
	groups: { start: number; count: number; materialIndex: number }[]
	/** For each of the model's groups in the LOD, its run of vertices: start, count and material index, three values a run. */
	runs: Uint32Array
}

/**
 * Merges the groups of `lod` by class (#691): `classes[m]` is the class of material `m`, or -1 to keep
 * its groups apart (a moving texture or colour). The triangles of a class's groups are drawn together,
 * in their order; each group's vertices are copied, so a vertex two groups share gets a copy for each.
 * `materials` is the model's material count, `vertices` its vertex count. Undefined when merging would
 * not draw fewer groups. Pure, so the model worker runs it.
 */
export function farMerge(lod: LodIndex, classes: Int32Array, materials: number, vertices: number): FarMerge | undefined {
	// A bucket a class, then one a group kept apart, in the order they come.
	const buckets = new Map<number, number[]>()
	for (let i = 0; i < lod.groups.length; i++) {
		const m = lod.groups[i].materialIndex
		const c = classes[m] ?? -1
		const key = c >= 0 ? c : -1 - m
		let list = buckets.get(key)
		if (!list) buckets.set(key, (list = []))
		list.push(i)
	}
	if (buckets.size >= lod.groups.length) return
	const order = [...buckets.keys()].sort((a, b) => (a >= 0 === b >= 0 ? 0 : a >= 0 ? -1 : 1))
	const stamp = new Int32Array(vertices).fill(-1)
	const remap = new Uint32Array(vertices)
	const src = new Uint32Array(lod.index.length)
	const index = new Uint32Array(lod.index.length)
	const runs = new Uint32Array(lod.groups.length * 3)
	const groups: FarMerge['groups'] = []
	let nv = 0
	let at = 0
	let r = 0
	for (const key of order) {
		const start = at
		for (const gi of buckets.get(key)!) {
			const g = lod.groups[gi]
			const first = nv
			for (let k = g.start; k < g.start + g.count; k++) {
				const v = lod.index[k]
				if (stamp[v] !== gi) {
					stamp[v] = gi
					remap[v] = nv
					src[nv++] = v
				}
				index[at++] = remap[v]
			}
			runs[r++] = first
			runs[r++] = nv - first
			runs[r++] = g.materialIndex
		}
		groups.push({ start, count: at - start, materialIndex: key >= 0 ? materials + key : -1 - key })
	}
	return { src: src.slice(0, nv), index: nv < 65535 ? Uint16Array.from(index) : index, groups, runs }
}

/**
 * The LOD geometry of `geometry` from its `lod` index: it shares the model's vertex buffers (and so
 * its skinning) and its bounds tree, so picking still hits the full model.
 */
export function lodGeometry(geometry: THREE.BufferGeometry, lod: LodIndex): THREE.BufferGeometry {
	const out = new THREE.BufferGeometry()
	for (const [name, attr] of Object.entries(geometry.attributes)) out.setAttribute(name, attr)
	for (const g of lod.groups) out.addGroup(g.start, g.count, g.materialIndex)
	out.setIndex(new THREE.BufferAttribute(lod.index, 1))
	if (!geometry.boundingSphere) geometry.computeBoundingSphere()
	out.boundingSphere = geometry.boundingSphere!.clone()
	if (geometry.boundingBox) out.boundingBox = geometry.boundingBox.clone()
	out.boundsTree = geometry.boundsTree
	return out
}

/**
 * A simplified version of a model for drawing it far away, or undefined when simplifying would not
 * save enough (`lodIndex`), built on the calling thread. Loaded models get theirs from the model
 * worker instead (models/modelWorker.ts, #507).
 */
export async function buildLod(geometry: THREE.BufferGeometry): Promise<THREE.BufferGeometry | undefined> {
	const index = geometry.index
	const pos = geometry.getAttribute('position')
	if (!index || !(pos instanceof THREE.BufferAttribute) || !(pos.array instanceof Float32Array) || pos.itemSize !== 3) return
	if (!(index.array instanceof Uint16Array || index.array instanceof Uint32Array)) return
	await lodReady
	if (!geometry.boundingSphere) geometry.computeBoundingSphere()
	const lod = lodIndex(index.array, geometry.groups, pos.array, geometry.boundingSphere!.radius)
	return lod && lodGeometry(geometry, lod)
}
