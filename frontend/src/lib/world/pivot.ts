// Turning a group of models about a pivot, after noggit3's "Rotate around pivot point"
// (World::rotate_selected_models with use_pivot): each model's position turns about the mean position
// of the selection by the same angle its yaw turns, so the group keeps its shape. Kept free of three.js
// so it can be tested on its own.

export interface Point2 {
	x: number
	z: number
}

/** The pivot of a selection: the mean of the models' world positions (noggit3's "median" is the mean too). */
export function meanPivot(points: ReadonlyArray<Point2>, out: Point2 = { x: 0, z: 0 }): Point2 {
	let x = 0
	let z = 0
	for (const p of points) {
		x += p.x
		z += p.z
	}
	const n = Math.max(1, points.length)
	out.x = x / n
	out.z = z / n
	return out
}

/**
 * (x, z) turned by `angle` radians about (px, pz), the way a model's yaw turns it about its own origin
 * (a rotation about the up axis, as three.js applies rotY), written into `out`.
 */
export function turnAbout(x: number, z: number, px: number, pz: number, angle: number, out: Point2 = { x: 0, z: 0 }): Point2 {
	const c = Math.cos(angle)
	const s = Math.sin(angle)
	const dx = x - px
	const dz = z - pz
	out.x = px + dx * c + dz * s
	out.z = pz - dx * s + dz * c
	return out
}
