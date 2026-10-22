import type * as THREE from 'three'

/**
 * The object id of a ray hit on one of ObjectLayer's instanced meshes, or undefined when the hit
 * is not on an instance or its instance has no id (the mesh's `ids` were repacked shorter, or the
 * mesh was swapped by a model load, between the pack and the pick).
 */
export function hitId(h: THREE.Intersection): number | undefined {
	if (h.instanceId === undefined) return undefined
	return (h.object.userData.ids as number[] | undefined)?.[h.instanceId]
}

/** The first hit (hits come nearest first) that names an object, skipping those that don't. */
export function firstPick(hits: THREE.Intersection[]): { id: number; distance: number } | null {
	for (const h of hits) {
		const id = hitId(h)
		if (id !== undefined) return { id, distance: h.distance }
	}
	return null
}
