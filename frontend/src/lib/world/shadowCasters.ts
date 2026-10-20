import * as THREE from 'three'
import type { MeshBVH } from 'three-mesh-bvh'
import type { ObjectLayer } from './ObjectLayer'
import { getAsset } from '../models/assets'
import { isHelper } from '../models/helpers'
import { SHADOW_BLOCK, type ShadowCasters } from '../terrain/bakedShadows'

/** A placed model a bake casts from: its bounds tree, its local box and its world-to-local matrix. */
interface Caster {
	inv: THREE.Matrix4
	box: THREE.Box3
	tree: MeshBVH
	/** The last ray tested against it. */
	seen: number
}

/**
 * The placed models as shadow casters for a bake (#163): each loaded model (helpers left out, as the
 * export leaves them out) listed in the bake's blocks its world box covers, tested through its own
 * bounds tree. `loading` counts the models whose mesh hasn't loaded yet, which cast nothing.
 */
export function modelCasters(objects: ObjectLayer, size: number, cellSize: number): { casters: ShadowCasters; count: number; loading: number } {
	const nb = Math.ceil(size / SHADOW_BLOCK)
	const blockWorld = SHADOW_BLOCK * cellSize
	const lists: Caster[][] = Array.from({ length: nb * nb }, () => [])
	const tops = new Float32Array(nb * nb).fill(-Infinity)
	const m = new THREE.Matrix4()
	const box = new THREE.Box3()
	let count = 0
	let loading = 0
	for (const o of objects.list()) {
		if (isHelper(o.type)) continue
		const asset = getAsset(o.type)
		// A model the game draws nothing of (a collision blocker, #333) casts nothing.
		if (asset.marker) continue
		const tree = asset.ready ? (asset.geometry.boundsTree as MeshBVH | undefined) : undefined
		if (!tree) {
			loading++
			continue
		}
		objects.matrixOf(o, m)
		box.copy(asset.bbox).applyMatrix4(m)
		const bx0 = Math.max(0, Math.floor(box.min.x / blockWorld))
		const bz0 = Math.max(0, Math.floor(box.min.z / blockWorld))
		const bx1 = Math.min(nb - 1, Math.floor(box.max.x / blockWorld))
		const bz1 = Math.min(nb - 1, Math.floor(box.max.z / blockWorld))
		if (bx1 < bx0 || bz1 < bz0) continue
		const c: Caster = { inv: m.clone().invert(), box: asset.bbox, tree, seen: 0 }
		for (let bz = bz0; bz <= bz1; bz++) {
			for (let bx = bx0; bx <= bx1; bx++) {
				const k = bz * nb + bx
				lists[k].push(c)
				if (box.max.y > tops[k]) tops[k] = box.max.y
			}
		}
		count++
	}
	const ray = new THREE.Ray()
	const casters: ShadowCasters = {
		raise(blockMax) {
			for (let k = 0; k < blockMax.length && k < tops.length; k++) if (tops[k] > blockMax[k]) blockMax[k] = tops[k]
		},
		hits(k, n, x, y, z, dir) {
			const list = lists[k]
			for (let i = 0; i < list.length; i++) {
				const c = list[i]
				if (c.seen === n) continue
				c.seen = n
				ray.origin.set(x, y, z)
				ray.direction.set(dir[0], dir[1], dir[2])
				ray.applyMatrix4(c.inv)
				if (!ray.intersectsBox(c.box)) continue
				if (c.tree.raycastFirst(ray, THREE.DoubleSide)) return true
			}
			return false
		},
	}
	return { casters, count, loading }
}
