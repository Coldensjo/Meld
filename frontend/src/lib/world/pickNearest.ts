import type * as THREE from 'three'
import type { vmangos } from '../../../wailsjs/go/models'
import type { ObjectLayer } from './ObjectLayer'
import type { SpawnLayer } from './SpawnLayer'

/** What a click is on: a spawn or a placed model, whichever the ray meets first; both null for neither. */
export interface PointerPick {
	spawn: vmangos.WorldSpawn | null
	id: number | null
	/** How far along the ray the picked one was met; Infinity for neither. */
	distance: number
}

/**
 * The spawn or the model under the ray, whichever is nearer the camera, so a creature standing on a
 * building's floor is picked over the building, and a wall in front of a creature over the creature.
 */
export function pickNearest(objects: ObjectLayer, spawns: SpawnLayer, raycaster: THREE.Raycaster): PointerPick {
	const s = spawns.pickHit(raycaster)
	const o = objects.pickHit(raycaster)
	if (s && (!o || s.distance <= o.distance)) return { spawn: s.spawn, id: null, distance: s.distance }
	return { spawn: null, id: o ? o.id : null, distance: o ? o.distance : Infinity }
}
