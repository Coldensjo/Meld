import * as THREE from 'three'

/**
 * Frees the GPU side of every mesh, line, point cloud and sprite under `root`: its geometry, its
 * materials and their maps. Only for a tree that owns all of these, never one holding shared model assets.
 */
export function disposeTree(root: THREE.Object3D) {
	const mats = new Set<THREE.Material>()
	root.traverse((o) => {
		const m = o as THREE.Mesh
		// A sprite's geometry is three's one shared quad, left to every other sprite.
		if (m.geometry && !(o as THREE.Sprite).isSprite) m.geometry.dispose()
		if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mat)
	})
	for (const mat of mats) {
		;(mat as THREE.MeshBasicMaterial).map?.dispose()
		mat.dispose()
	}
}
