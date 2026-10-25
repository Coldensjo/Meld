// Follow-ground rotation, after noggit3's World::rotate_selected_models_to_ground_normal: a model dragged
// along the terrain tilts so its up axis matches the ground's normal. Kept free of three.js and the
// terrain class so it can be tested on its own.

/**
 * Ground normal at (x, z), normalised, written into `out`. Smooth takes the slope across a cell each way,
 * which blends the neighbouring cells as noggit3's interpolated normals do; otherwise it is the slope of
 * the surface right under the point.
 */
export function groundNormal(heightAt: (x: number, z: number) => number, x: number, z: number, cellSize: number, smooth: boolean, out: { x: number; y: number; z: number }) {
	const e = smooth ? cellSize : cellSize * 0.05
	const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e)
	const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)
	const len = Math.hypot(dx, 1, dz)
	out.x = -dx / len
	out.y = 1 / len
	out.z = -dz / len
	return out
}

/**
 * The tilts (WorldObject.tiltX and tiltZ) that turn a model with turn `rotY` so its up axis points along
 * the unit normal (nx, ny, nz). The model's rotation is the client's, Ry(rotY) Rz(-tiltX) Rx(tiltZ)
 * (`placementEuler`), so the normal is first taken into the turned model's frame. Writes into `out` when given, so a
 * per-frame caller doesn't allocate.
 */
export function tiltToNormal(nx: number, ny: number, nz: number, rotY: number, out: { tiltX: number; tiltZ: number } = { tiltX: 0, tiltZ: 0 }): { tiltX: number; tiltZ: number } {
	const c = Math.cos(rotY)
	const s = Math.sin(rotY)
	const mx = nx * c - nz * s
	const mz = nx * s + nz * c
	out.tiltX = Math.atan2(mx, ny)
	out.tiltZ = Math.asin(Math.max(-1, Math.min(1, mz)))
	return out
}

/** The ground's steepness at (x, z) in degrees: 0 on the flat, 90 on a wall. The slope right under the point, as the unsmoothed normal. */
export function groundSlopeDeg(heightAt: (x: number, z: number) => number, x: number, z: number, cellSize: number): number {
	const e = cellSize * 0.05
	const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e)
	const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)
	return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI
}
