import * as THREE from 'three'

// Culling of instanced models: only the instances that are in view (the camera's frustum, or the
// shadow camera's, so a model just off screen still throws its shadow into view) are packed into the
// instance buffer and drawn, and a model too small on screen to see is left out. Kept apart from the
// layers so it can be tested on its own.

/** What is in view this frame, for culling. */
export interface CullView {
  /** An instance is drawn when any of these holds it: the camera's frustum and, with shadows, the shadow camera's. */
  frustums: THREE.Frustum[]
  /** The camera's position. */
  eye: THREE.Vector3
  /** Pixels one world unit covers at a distance of one, for the small-model cutoff. */
  pxPerUnit: number
  /** Instances whose bounds would cover fewer pixels than this are left out; 0 keeps them all. */
  cutoffPx: number
}

const sphere = new THREE.Sphere()

/**
 * Writes the bounding sphere of `geometry` placed by `matrix` into `out` at `o`, as centre x, y, z and
 * radius.
 */
export function instanceSphere(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, out: Float32Array, o: number) {
  if (!geometry.boundingSphere) geometry.computeBoundingSphere()
  const s = geometry.boundingSphere!
  sphere.center.copy(s.center).applyMatrix4(matrix)
  out[o] = sphere.center.x
  out[o + 1] = sphere.center.y
  out[o + 2] = sphere.center.z
  out[o + 3] = s.radius * matrix.getMaxScaleOnAxis()
}

/**
 * The indices of the `n` instances whose spheres (four values each, as instanceSphere writes them)
 * are in view, in order, written into `out`. Returns false when `out` already held exactly them, so
 * the caller can skip re-packing the instance buffer.
 */
export function cullSpheres(view: CullView, spheres: Float32Array, n: number, out: number[], scratch: number[]): boolean {
  scratch.length = 0
  const { frustums, eye, pxPerUnit, cutoffPx } = view
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const r = spheres[o + 3]
    sphere.center.set(spheres[o], spheres[o + 1], spheres[o + 2])
    sphere.radius = r
    if (cutoffPx > 0) {
      const d = eye.distanceTo(sphere.center)
      // Seen from outside, the model covers about its diameter over its distance.
      if (d > r && (2 * r * pxPerUnit) / d < cutoffPx) continue
    }
    for (let k = 0; k < frustums.length; k++) {
      if (frustums[k].intersectsSphere(sphere)) {
        scratch.push(i)
        break
      }
    }
  }
  let same = scratch.length === out.length
  for (let k = 0; same && k < scratch.length; k++) if (scratch[k] !== out[k]) same = false
  if (same) return false
  out.length = scratch.length
  for (let k = 0; k < scratch.length; k++) out[k] = scratch[k]
  return true
}

/** Copies the matrices of the instances `packed` names (16 values each in `matrices`) to the front of `into`. */
export function packMatrices(matrices: Float32Array, packed: number[], into: Float32Array) {
  for (let k = 0; k < packed.length; k++) {
    const s = packed[k] * 16
    into.set(matrices.subarray(s, s + 16), k * 16)
  }
}
