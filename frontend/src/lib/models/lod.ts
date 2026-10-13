import * as THREE from 'three'
import { MeshoptSimplifier } from 'meshoptimizer'

/** The share of a model's triangles its LOD aims for. */
const LOD_RATIO = 0.25
/** The largest error the LOD may make, as a share of the model's bounding radius. */
const LOD_ERROR = 0.02
/** A LOD is only kept when it drops at least this share of the triangles. */
const MIN_SAVING = 0.3

/**
 * A simplified version of a model for drawing it far away (meshoptimizer, MIT), or undefined when
 * simplifying would not save enough. Each material group is simplified on its own, so the groups
 * and materials stay as they are. The LOD only has a new index: it shares the model's vertex buffers
 * (and so its skinning) and its bounds tree, so picking still hits the full model.
 */
export async function buildLod(geometry: THREE.BufferGeometry): Promise<THREE.BufferGeometry | undefined> {
  const index = geometry.index
  const pos = geometry.getAttribute('position')
  if (!index || !(pos instanceof THREE.BufferAttribute) || !(pos.array instanceof Float32Array) || pos.itemSize !== 3) return
  await MeshoptSimplifier.ready
  if (!geometry.boundingSphere) geometry.computeBoundingSphere()
  const maxError = geometry.boundingSphere!.radius * LOD_ERROR
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: index.count, materialIndex: 0 }]
  const parts: Uint32Array[] = []
  let total = 0
  for (const g of groups) {
    const ids = new Uint32Array(index.array.subarray(g.start, g.start + g.count))
    const target = Math.floor((ids.length * LOD_RATIO) / 3) * 3
    // Sparse: a group uses only some of the vertices. The error is in model units, the same for every group.
    const [out] = MeshoptSimplifier.simplify(ids, pos.array, 3, target, maxError, ['Sparse', 'ErrorAbsolute'])
    parts.push(out)
    total += out.length
  }
  if (total > index.count * (1 - MIN_SAVING)) return

  const lod = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(geometry.attributes)) lod.setAttribute(name, attr)
  const merged = pos.count < 65535 ? new Uint16Array(total) : new Uint32Array(total)
  let at = 0
  parts.forEach((p, i) => {
    merged.set(p, at)
    lod.addGroup(at, p.length, groups[i].materialIndex ?? 0)
    at += p.length
  })
  lod.setIndex(new THREE.BufferAttribute(merged, 1))
  lod.boundingSphere = geometry.boundingSphere!.clone()
  if (geometry.boundingBox) lod.boundingBox = geometry.boundingBox.clone()
  lod.boundsTree = geometry.boundsTree
  return lod
}
