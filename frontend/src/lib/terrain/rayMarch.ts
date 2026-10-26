import * as THREE from 'three'

/** What the ray-march reads of a terrain. */
export interface GroundSampler {
	readonly cellSize: number
	readonly worldSize: number
	contains(x: number, z: number): boolean
	heightAt(x: number, z: number): number
	isHole(x: number, z: number): boolean
	/** Whether (x, z) is on a tile left out of the map (Terrain.tileMask), passed through even when `solid`. */
	isOff?(x: number, z: number): boolean
}

/**
 * Where `ray` meets the ground, in `out`. `box` (its y range wide enough for any height) and `hit` are
 * scratch, since this runs several times a frame. Holes are passed through unless `solid`, and tiles left
 * out of the map (`isOff`) always; a ray that
 * went below the surface through a hole stays under until it comes back above the ground, so it does
 * not hit the ground's underside where it leaves the hole's cells.
 */
export function rayMarchGround(g: GroundSampler, box: THREE.Box3, hit: THREE.Vector3, ray: THREE.Ray, out: THREE.Vector3, maxDist: number, solid: boolean): boolean {
	const step = g.cellSize * 0.5
	const o = ray.origin
	const dir = ray.direction
	// Skip ahead to the terrain's bounding box.
	let t = 0
	box.max.x = g.worldSize
	box.max.z = g.worldSize
	if (!box.containsPoint(o)) {
		if (!ray.intersectBox(box, hit)) return false
		t = hit.distanceTo(o)
	}
	let prevT = t
	let prevAbove = true
	let under = false
	for (; t < maxDist; t += step) {
		const x = o.x + dir.x * t
		const y = o.y + dir.y * t
		const z = o.z + dir.z * t
		if (!g.contains(x, z)) {
			if (t > 0 && !prevAbove) break
			prevT = t
			continue
		}
		const overGround = y > g.heightAt(x, z)
		const inHole = solid ? !!g.isOff?.(x, z) : g.isHole(x, z)
		const above = overGround || inHole
		// Below the surface inside a hole, the ray is under; it is over the ground again only above it.
		if (inHole && !overGround) under = true
		else if (overGround) under = false
		if (!above && !under) {
			// Binary refine between prevT and t.
			let lo = prevT,
				hi = t
			for (let i = 0; i < 12; i++) {
				const mid = (lo + hi) * 0.5
				const mx = o.x + dir.x * mid
				const mz = o.z + dir.z * mid
				if (o.y + dir.y * mid > g.heightAt(mx, mz) || (solid ? !!g.isOff?.(mx, mz) : g.isHole(mx, mz))) lo = mid
				else hi = mid
			}
			out.copy(dir).multiplyScalar(hi).add(o)
			return true
		}
		prevAbove = above || under
		prevT = t
	}
	return false
}
