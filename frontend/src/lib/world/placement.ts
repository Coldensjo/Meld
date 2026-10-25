import type * as THREE from 'three'

/**
 * A placed model's rotation as the client builds it from an MDDF/MODF record (wowdev.wiki ADT
 * `createPlacementMatrix`; Noggit Red's `SceneObject::updateTransformMatrix`): the heading about the
 * world up, then the tilt about the model's own Z (forward or back, the record's first angle, negated),
 * then the roll about its own X, the way it faces (the record's third angle). `rotY` is the heading as
 * the editor keeps it (the record's middle angle less 90 degrees); `tiltX` and `tiltZ` are the record's
 * first and third angles in radians. Writes into `out` and returns it.
 */
export function placementEuler(out: THREE.Euler, rotY: number, tiltX = 0, tiltZ = 0): THREE.Euler {
	return out.set(tiltZ, rotY, -tiltX, 'YZX')
}

/**
 * A tilt or roll (radians) stepped by `degrees` by hand (hold Z and scroll, #344), wrapped to
 * -180..180 so a model can be flipped all the way round, and rounded to a tenth of a degree so
 * steps back land exactly on 0.
 */
export function stepTilt(angle: number, degrees: number): number {
	let d = Math.round(((angle * 180) / Math.PI + degrees) * 10) / 10
	d = ((((d + 180) % 360) + 360) % 360) - 180
	if (d === -180) d = 180
	return (d * Math.PI) / 180
}

/** The smallest and largest scale a placed model takes. */
export const MIN_SCALE = 0.05
export const MAX_SCALE = 20

/** A model's scale as it is kept: rounded to a hundredth and held to MIN_SCALE..MAX_SCALE. */
export function clampScale(scale: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(scale * 100) / 100))
}
