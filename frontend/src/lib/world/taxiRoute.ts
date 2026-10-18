// Flight path routes (#180): the curve a flight flies through a route's points, as the server moves a
// player along it, and the pieces the Flight Paths window builds routes from. Points here are in
// whatever space they are given in (the window keeps the server's, the layer draws the editor's).

export interface Vec3 {
	x: number
	y: number
	z: number
}

/** How fast a flight flies, yards a second: VMaNGOS's PLAYER_FLIGHT_SPEED. */
export const FLIGHT_SPEED = 32

/** The steps a segment's length is measured in, as the server's spline does (STEPS_PER_SEGMENT). */
const LENGTH_STEPS = 3

/**
 * The point at `t` (0 to 1) along segment `seg` (from point seg to seg+1) of the uniform Catmull-Rom
 * spline through `pts`, into `out`. The ends are doubled, as the server's spline (Movement::Spline's
 * InitCatmullRom) does for a path that doesn't loop, so the curve starts and ends on the first and
 * last points and passes through every one.
 */
export function splinePoint(pts: readonly Vec3[], seg: number, t: number, out: Vec3): Vec3 {
	const n = pts.length
	const p0 = pts[Math.max(0, seg - 1)]
	const p1 = pts[seg]
	const p2 = pts[Math.min(n - 1, seg + 1)]
	const p3 = pts[Math.min(n - 1, seg + 2)]
	const t2 = t * t
	const t3 = t2 * t
	const a = -0.5 * t3 + t2 - 0.5 * t
	const b = 1.5 * t3 - 2.5 * t2 + 1
	const c = -1.5 * t3 + 2 * t2 + 0.5 * t
	const d = 0.5 * t3 - 0.5 * t2
	out.x = a * p0.x + b * p1.x + c * p2.x + d * p3.x
	out.y = a * p0.y + b * p1.y + c * p2.y + d * p3.y
	out.z = a * p0.z + b * p1.z + c * p2.z + d * p3.z
	return out
}

/** Each segment's length along the curve, measured as the server measures it. */
export function segmentLengths(pts: readonly Vec3[]): number[] {
	const out: number[] = []
	const a = { x: 0, y: 0, z: 0 }
	const b = { x: 0, y: 0, z: 0 }
	for (let s = 0; s + 1 < pts.length; s++) {
		let len = 0
		splinePoint(pts, s, 0, a)
		for (let i = 1; i <= LENGTH_STEPS; i++) {
			splinePoint(pts, s, i / LENGTH_STEPS, b)
			len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
			a.x = b.x
			a.y = b.y
			a.z = b.z
		}
		out.push(len)
	}
	return out
}

/** How long a flight along `pts` takes, in seconds, at FLIGHT_SPEED (the waits at its points left out). */
export function flightSeconds(pts: readonly Vec3[]): number {
	return segmentLengths(pts).reduce((s, l) => s + l, 0) / FLIGHT_SPEED
}

/**
 * Where a flight along `pts` is `seconds` after it took off, into `out`, as the server times it: each
 * segment takes its length's share of the time, and within one the curve's parameter runs evenly.
 * `lengths` is segmentLengths(pts). Returns false once the flight has landed (`out` is the last point).
 */
export function flightAt(pts: readonly Vec3[], lengths: readonly number[], seconds: number, out: Vec3): boolean {
	let left = Math.max(0, seconds) * FLIGHT_SPEED
	for (let s = 0; s < lengths.length; s++) {
		const len = lengths[s]
		if (left <= len) {
			splinePoint(pts, s, len > 0 ? left / len : 1, out)
			return true
		}
		left -= len
	}
	const last = pts[pts.length - 1]
	out.x = last.x
	out.y = last.y
	out.z = last.z
	return false
}

/**
 * Samples the curve through `pts` into `out` as line segments (pairs of points, three numbers each),
 * `perSegment` pieces between two points.
 */
export function routeLines(pts: readonly Vec3[], perSegment: number, out: number[] = []): number[] {
	if (pts.length < 2) return out
	const a = { x: 0, y: 0, z: 0 }
	const b = { x: 0, y: 0, z: 0 }
	for (let s = 0; s + 1 < pts.length; s++) {
		splinePoint(pts, s, 0, a)
		for (let i = 1; i <= perSegment; i++) {
			splinePoint(pts, s, i / perSegment, b)
			out.push(a.x, a.y, a.z, b.x, b.y, b.z)
			a.x = b.x
			a.y = b.y
			a.z = b.z
		}
	}
	return out
}

/** A new route's height over its stops, yards: about where the client's own routes cruise. */
export const CRUISE_HEIGHT = 40

/**
 * A new route's points from stop `from` to stop `to`, in the server's coordinates (Z up): off the
 * first stop's ground, up to CRUISE_HEIGHT a little way out, along to above the last stop and down
 * onto it, as the client's own routes take off and land. The author adds points between.
 */
export function defaultRoute(from: Vec3, to: Vec3): Vec3[] {
	const dx = to.x - from.x
	const dy = to.y - from.y
	const len = Math.hypot(dx, dy)
	if (len < 1) return [{ ...from }, { x: to.x, y: to.y, z: to.z + 1 }]
	const ux = dx / len
	const uy = dy / len
	const out = Math.min(40, len / 4)
	return [
		{ x: from.x, y: from.y, z: from.z },
		{ x: from.x + ux * out, y: from.y + uy * out, z: from.z + CRUISE_HEIGHT },
		{ x: to.x - ux * out, y: to.y - uy * out, z: to.z + CRUISE_HEIGHT },
		{ x: to.x, y: to.y, z: to.z },
	]
}

/**
 * Where a click puts a new route point in the editor's space (Y up): on the level plane at `height`
 * where the click's ray (from `origin` along the unit `dir`) meets it, so a route is drawn in the air
 * at the height of the point before. When the ray meets the ground first (`ground`, its hit, or null)
 * or never comes down to that height, the point goes above the ground where the ray hits it, at
 * `height` or `clearance` over it, whichever is higher. Null when the ray meets neither.
 */
export function airPoint(origin: Vec3, dir: Vec3, height: number, ground: Vec3 | null, clearance = 10): Vec3 | null {
	const t = Math.abs(dir.y) > 1e-9 ? (height - origin.y) / dir.y : -1
	const groundDist = ground ? Math.hypot(ground.x - origin.x, ground.y - origin.y, ground.z - origin.z) : Infinity
	if (t > 0 && t < groundDist) return { x: origin.x + dir.x * t, y: height, z: origin.z + dir.z * t }
	if (!ground) return null
	return { x: ground.x, y: Math.max(height, ground.y + clearance), z: ground.z }
}
