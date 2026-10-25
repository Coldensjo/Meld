import * as THREE from 'three'
import { downRayPick, toModel, type WmoNav } from './wmoRoom'

// What stands in a room the portal flood reached is drawn, whether or not a doorway holds it (#156):
// the client draws the camera's room and the rooms seen through its portals with all they contain,
// and only the open world is limited to the doorways. A model's or spawn's room is found with the
// camera's own down-ray (`downRayPick`) from its bounding sphere's centre.

/** Room lookups kept before the cache starts over. */
const CACHE_MAX = 4096
/** Positions closer than 1/QUANT yd share a cache entry. */
const QUANT = 16

/** The gate's second test: whether a sphere stands in a room of the camera's WMO that the flood reached. */
export class RoomAdmit {
	private nav: WmoNav | null = null
	private visible: Uint8Array | null = null
	private inv = new THREE.Matrix4()
	private matrix = new THREE.Matrix4()
	private local = new THREE.Vector3()
	private model: [number, number, number] = [0, 0, 0]
	private ground: [number, number, number] = [0, 0, 0]
	/** The room (group, or -1 outside) of each looked-up position, for the WMO placement set last. */
	private rooms = new Map<number, number>()
	private groundAt: (x: number, z: number) => number | null = () => null

	/**
	 * Sets the camera's WMO (its room data and placement) and the groups the flood reached this frame.
	 * `groundAt` gives the terrain's height under an editor-space point, or null where there is none.
	 */
	set(nav: WmoNav, matrix: THREE.Matrix4, visible: Uint8Array, groundAt: (x: number, z: number) => number | null) {
		if (nav !== this.nav || !matrix.equals(this.matrix)) {
			this.nav = nav
			this.matrix.copy(matrix)
			this.inv.copy(matrix).invert()
			this.rooms.clear()
		}
		this.visible = visible
		this.groundAt = groundAt
	}

	/** Whether the sphere's centre is in a room the flood reached. */
	admits(s: THREE.Sphere): boolean {
		const nav = this.nav,
			visible = this.visible
		if (!nav || !visible) return false
		const c = s.center
		const key = (Math.round(c.x * QUANT) * 73856093) ^ (Math.round(c.y * QUANT) * 19349663) ^ (Math.round(c.z * QUANT) * 83492791)
		let room = this.rooms.get(key)
		if (room === undefined) {
			room = this.roomOf(nav, c)
			if (this.rooms.size >= CACHE_MAX) this.rooms.clear()
			this.rooms.set(key, room)
		}
		return room >= 0 && visible[room] === 1
	}

	private roomOf(nav: WmoNav, c: THREE.Vector3): number {
		this.local.copy(c).applyMatrix4(this.inv)
		const [x, y, z] = toModel(this.local, this.model)
		// Quick out: nowhere near any group's box.
		let near = false
		for (const g of nav.groups) {
			if (x >= g.min[0] && x <= g.max[0] && y >= g.min[1] && y <= g.max[1] && z >= g.min[2] && z <= g.max[2]) {
				near = true
				break
			}
		}
		if (!near) return -1
		const ground = this.groundAt(c.x, c.z)
		let groundZ: number | null = null
		if (ground !== null) {
			this.local.set(c.x, ground, c.z).applyMatrix4(this.inv)
			groundZ = toModel(this.local, this.ground)[2]
		}
		return downRayPick(nav, x, y, z, groundZ).inGroup ?? -1
	}
}
