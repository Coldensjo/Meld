import * as THREE from 'three'

/**
 * What a point light's shadow cube may leave out (#133). three draws every caster whose
 * `intersectsFrustum` says so on each of a cube's six faces, and an InstancedMesh with instances all
 * over the map would be drawn on every face of every light: about 9500 draw calls a cube on a 3x3
 * block. The shadowed lights register their cube's frustum (three updates the one frustum for each
 * face in turn) with their reach; a batch then joins a face only when one of the instances it draws
 * meets both. Any other frustum (the camera's, the sun's cascades) keeps every batch.
 */
const reaches = new Map<THREE.Frustum, THREE.Sphere>()
const spheres: THREE.Sphere[] = []

/** Forgets the lights registered last frame; call before registering this frame's. */
export function clearShadowReach() {
  for (const s of reaches.values()) spheres.push(s)
  reaches.clear()
}

/** Registers a shadowed point light: its cube's frustum, where it is and how far it reaches. */
export function addShadowReach(light: THREE.PointLight) {
  const s = spheres.pop() ?? new THREE.Sphere()
  s.center.copy(light.position)
  s.radius = light.distance
  reaches.set(light.shadow.getFrustum(), s)
}

const centre = new THREE.Vector3()
const test = new THREE.Sphere()

/**
 * Whether `mesh` (an InstancedMesh in world space, its instances packed to the front) has a drawn
 * instance in `frustum`: for a shadowed light's frustum, an instance whose bounding sphere meets the
 * light's reach and the face; for any other frustum, always.
 */
export function instancesMeet(mesh: THREE.InstancedMesh, frustum: THREE.Frustum): boolean {
  const reach = reaches.get(frustum)
  if (!reach) return true
  const g = mesh.geometry
  if (!g.boundingSphere) g.computeBoundingSphere()
  const bs = g.boundingSphere!
  const a = mesh.instanceMatrix.array
  const cx = bs.center.x
  const cy = bs.center.y
  const cz = bs.center.z
  const rc = reach.center
  for (let k = 0, o = 0; k < mesh.count; k++, o += 16) {
    const x = a[o] * cx + a[o + 4] * cy + a[o + 8] * cz + a[o + 12]
    const y = a[o + 1] * cx + a[o + 5] * cy + a[o + 9] * cz + a[o + 13]
    const z = a[o + 2] * cx + a[o + 6] * cy + a[o + 10] * cz + a[o + 14]
    const sx = a[o] * a[o] + a[o + 1] * a[o + 1] + a[o + 2] * a[o + 2]
    const sy = a[o + 4] * a[o + 4] + a[o + 5] * a[o + 5] + a[o + 6] * a[o + 6]
    const sz = a[o + 8] * a[o + 8] + a[o + 9] * a[o + 9] + a[o + 10] * a[o + 10]
    const r = bs.radius * Math.sqrt(Math.max(sx, sy, sz))
    const dx = x - rc.x
    const dy = y - rc.y
    const dz = z - rc.z
    const d = r + reach.radius
    if (dx * dx + dy * dy + dz * dz > d * d) continue
    test.center.copy(centre.set(x, y, z))
    test.radius = r
    if (frustum.intersectsSphere(test)) return true
  }
  return false
}

/** Lets three cull `mesh` per shadow face through `instancesMeet`; it is still drawn wherever else three draws it. */
export function cullForShadows(mesh: THREE.InstancedMesh) {
  mesh.frustumCulled = true
  mesh.intersectsFrustum = (frustum: THREE.Frustum) => instancesMeet(mesh, frustum)
}
