import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'

// three-mesh-bvh (MIT) gives each model geometry a bounding volume tree, so a ray tests a handful
// of triangles instead of all of them. InstancedMesh raycasts each instance through
// Mesh.prototype.raycast, so props pick through the tree too; geometry without one falls back to
// three's own raycast.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

/**
 * Builds the tree a geometry is raycast through. It reorders the index within each group, so call
 * it before the geometry is first drawn. Skinned models pick against their bind pose, as before.
 */
export function buildBoundsTree(geometry: THREE.BufferGeometry) {
	if (!geometry.boundsTree) geometry.computeBoundsTree()
}
