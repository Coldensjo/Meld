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
