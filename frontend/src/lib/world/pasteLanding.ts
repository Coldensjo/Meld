// A model paste on a building (#191): when the paste's anchor is on a model, each pasted root stands on
// the highest model under it, attached to it as the Place tool attaches, at the height above that
// surface it had above the ground; a root past the model's edge stays on the ground.
import * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import type { ObjectLayer } from './ObjectLayer'
import { getAsset } from '../models/assets'

/** Where the downward rays start: above anything on a map. */
const RAY_TOP = 10000

/** Where a root of a model paste stands: on model `parent` (null: the ground), whose surface is at height `y`. */
export interface Landing {
	parent: number | null
	y: number
}

/** A pasted root: its clip id and its place relative to the anchor. */
interface Root {
	cid: number
	cparent?: number
	x: number
	z: number
}

const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0))
const tmp = new THREE.Vector3()

/** The landing of every root of `list` (by clip id) for a paste anchored at world (ax, az). */
export function pasteLandings(objects: ObjectLayer, terrain: Terrain, list: readonly Root[], ax: number, az: number): Map<number, Landing> {
	const out = new Map<number, Landing>()
	let reach = 0
	for (const o of list) if (o.cparent === undefined) reach = Math.max(reach, Math.hypot(o.x, o.z))
	reach += 1
	// The models whose footprint can reach under a root: a few, so each ray tests only those.
	const ids: number[] = []
	for (const o of objects.objects.values()) {
		const box = getAsset(o.type).bbox
		const half = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5 * objects.worldScale(o)
		const p = objects.worldPosition(o, tmp)
		const dx = p.x - ax
		const dz = p.z - az
		const r = reach + half
		if (dx * dx + dz * dz <= r * r) ids.push(o.id)
	}
	for (const o of list) {
		if (o.cparent !== undefined) continue
		const x = ax + o.x
		const z = az + o.z
		const ground = terrain.heightAt(x, z)
		ray.origin.set(x, RAY_TOP, z)
		const hit = ids.length ? objects.raycastAmong(ray, ids, ids.length) : null
		// A model buried under the ground there doesn't count: the root stands on the ground.
		out.set(o.cid, hit && hit.point.y >= ground ? { parent: hit.id, y: hit.point.y } : { parent: null, y: ground })
	}
	return out
}
