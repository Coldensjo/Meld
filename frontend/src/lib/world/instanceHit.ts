import type * as THREE from 'three'

/**
 * The item (an object id, a spawn) a ray hit on an instanced mesh of `InstanceBatch` names, from the
 * mesh's `userData.ids`, or undefined when the hit is not on an instance or its instance has no item
 * (the mesh's `ids` were repacked shorter, or the mesh was swapped by a model load, between the pack
 * and the pick).
 */
export function hitId<T = number>(h: THREE.Intersection): T | undefined {
	if (h.instanceId === undefined) return undefined
	return (h.object.userData.ids as T[] | undefined)?.[h.instanceId]
}

/** The first hit (hits come nearest first) that names an item, skipping those that don't. */
export function firstPick<T = number>(hits: THREE.Intersection[]): { id: T; distance: number } | null {
	for (const h of hits) {
		const id = hitId<T>(h)
		if (id !== undefined) return { id, distance: h.distance }
	}
	return null
}
