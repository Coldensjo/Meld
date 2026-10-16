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
