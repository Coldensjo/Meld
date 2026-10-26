import * as THREE from 'three'

/**
 * What a shadow pass may leave out (#133, #325). three draws every caster whose `intersectsFrustum`
 * says so, and an InstancedMesh with instances all over the map would be drawn into every pass.
 * - A point light's cube: about 9500 draw calls a cube on a 3x3 block. The shadowed lights register
 *   their cube's frustum (three updates the one frustum for each face in turn) with their reach; a
 *   batch then joins a face only when one of the instances it draws meets both.
 * - The sun's near cascade, whose box is at most 500 yd across: the Engine registers its frustum each
 *   frame, and a batch joins it only when one of its drawn instances meets it. The batches that join
 *   it and move (a skeleton, or a material whose shadow moves: `markShadowMoving`) are noted, so the
 *   Engine redraws them into that map (only on a change, #326) when one is posed or its material
 *   moves. While the near map's still casters are drawn apart from those (#346, `setNearStill`), the
 *   moving batches keep out of it but are still noted.
 * - The sun's far cascade keeps every batch with an instance packed.
 * Any other frustum is the scene pass's (#15): a batch joins it only with an instance in the camera's
 * view. The cull packs those first (`cullSpheres`' split) and the instances only a shadow needs after
 * them. The mesh's `count` is the ones in view, which the scene pass, picking and the mesh's bounds
 * use, and a shadow pass draws all of them (`setPacked`), so a model behind the camera that throws
 * its shadow into view no longer costs the scene pass a draw call a group.
 */
const reaches = new Map<THREE.Frustum, THREE.Sphere>()
const spheres: THREE.Sphere[] = []
let nearCascade: THREE.Frustum | null = null
let farCascade: THREE.Frustum | null = null
/** Per mesh: the instances packed for every pass, and how many of them lead as the ones in view. */
const packedCounts = new WeakMap<THREE.InstancedMesh, { all: number; view: number }>()
/** The skeletons of the batches drawn into the near cascade's map when it was last drawn. */
const nearSkeletons = new Set<THREE.Skeleton>()
/** A batch with a moving material was drawn into the near cascade's map when it was last drawn. */
let nearMaterials = false
/** The near map is being drawn with its still casters only (`PosedShadows`). */
let nearStill = false
/** The materials whose shadow changes as they animate (`markShadowMoving`). */
const movingMaterials = new WeakSet<THREE.Material>()
/** How a batch's shadow moves: MOVES_POSE with a skeleton, MOVES_MATERIAL with a moving material. */
const movers = new WeakMap<THREE.InstancedMesh, number>()
const MOVES_POSE = 1
const MOVES_MATERIAL = 2

/**
 * The layer the moving batches are on as well as the default one: a shadow pass through a camera
 * that sees only this layer draws only them (`PosedShadows`, #346).
 */
export const POSED_LAYER = 31

/**
 * Notes that `material`'s shadow changes as it animates: a moving texture on a cut-out, or a colour
 * that can fade out (a hidden material casts nothing). Call before a batch is made with it.
 */
export function markShadowMoving(material: THREE.Material) {
	movingMaterials.add(material)
}

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

/** Registers the sun's near cascade frustum (three updates that one object in place), or null without shadows. */
export function setNearCascade(frustum: THREE.Frustum | null) {
	nearCascade = frustum
}

/** Registers the sun's far cascade frustum, or null without shadows: its pass draws every batch with an instance packed. */
export function setFarCascade(frustum: THREE.Frustum | null) {
	farCascade = frustum
}

/**
 * Notes what `mesh` holds after a pack: `all` instances, the first `view` of them in the camera's view.
 * Its `count` (what the scene pass draws) becomes `view`; a shadow pass draws `all`.
 */
export function setPacked(mesh: THREE.InstancedMesh, all: number, view: number) {
	let c = packedCounts.get(mesh)
	if (!c) packedCounts.set(mesh, (c = { all, view }))
	c.all = all
	c.view = view
	mesh.count = view
}

/** How many instances `mesh` has packed for the shadow passes, the ones in view among them. */
export function packedCount(mesh: THREE.InstancedMesh): number {
	return packedCounts.get(mesh)?.all ?? mesh.count
}

/** While on, the near cascade's pass leaves out the moving batches, still noting those in its box. */
export function setNearStill(on: boolean) {
	nearStill = on
}

/** Forgets the near cascade's animated casters; call when its map is about to be redrawn, which notes them again. */
export function clearNearCasters() {
	nearSkeletons.clear()
	nearMaterials = false
}

/** Whether the near cascade's map, as last drawn, holds a model skinned with `skeleton`. */
export function castsNear(skeleton: THREE.Skeleton): boolean {
	return nearSkeletons.has(skeleton)
}

/** Whether the near cascade's map, as last drawn, holds a batch with a moving material. */
export function materialsNear(): boolean {
	return nearMaterials
}

const test = new THREE.Sphere()

/**
 * Whether `mesh` (an InstancedMesh in world space, its instances packed to the front) has a drawn
 * instance in `frustum`: for a shadowed light's frustum, an instance whose bounding sphere meets the
 * light's reach and the face; for the near cascade's, one whose sphere meets it; for the far
 * cascade's, any; for any other (the scene pass's), one in the camera's view.
 */
export function instancesMeet(mesh: THREE.InstancedMesh, frustum: THREE.Frustum): boolean {
	const reach = reaches.get(frustum)
	const all = packedCount(mesh)
	if (!reach && frustum !== nearCascade) return frustum === farCascade ? all > 0 : mesh.count > 0
	const g = mesh.geometry
	if (!g.boundingSphere) g.computeBoundingSphere()
	const bs = g.boundingSphere!
	const a = mesh.instanceMatrix.array
	const cx = bs.center.x
	const cy = bs.center.y
	const cz = bs.center.z
	for (let k = 0, o = 0; k < all; k++, o += 16) {
		const x = a[o] * cx + a[o + 4] * cy + a[o + 8] * cz + a[o + 12]
		const y = a[o + 1] * cx + a[o + 5] * cy + a[o + 9] * cz + a[o + 13]
		const z = a[o + 2] * cx + a[o + 6] * cy + a[o + 10] * cz + a[o + 14]
		const sx = a[o] * a[o] + a[o + 1] * a[o + 1] + a[o + 2] * a[o + 2]
		const sy = a[o + 4] * a[o + 4] + a[o + 5] * a[o + 5] + a[o + 6] * a[o + 6]
		const sz = a[o + 8] * a[o + 8] + a[o + 9] * a[o + 9] + a[o + 10] * a[o + 10]
		const r = bs.radius * Math.sqrt(Math.max(sx, sy, sz))
		if (reach) {
			const dx = x - reach.center.x
			const dy = y - reach.center.y
			const dz = z - reach.center.z
			const d = r + reach.radius
			if (dx * dx + dy * dy + dz * dz > d * d) continue
		}
		test.center.set(x, y, z)
		test.radius = r
		if (frustum.intersectsSphere(test)) {
			if (frustum !== nearCascade) return true
			const moves = movers.get(mesh)
			if (!moves) return true
			if (moves & MOVES_POSE) nearSkeletons.add((mesh as unknown as { skeleton: THREE.Skeleton }).skeleton)
			if (moves & MOVES_MATERIAL) nearMaterials = true
			return !nearStill
		}
	}
	return false
}

/**
 * Lets three cull `mesh` per pass through `instancesMeet`, and has a shadow pass draw every instance
 * packed, the scene pass only those in view (`setPacked`). A caller that sets shadow hooks of its own
 * must call these too.
 */
export function cullForShadows(mesh: THREE.InstancedMesh) {
	mesh.frustumCulled = true
	mesh.onBeforeShadow = () => {
		const c = packedCounts.get(mesh)
		if (c) mesh.count = c.all
	}
	mesh.onAfterShadow = () => {
		const c = packedCounts.get(mesh)
		if (c) mesh.count = c.view
	}
	const m = mesh.material
	const pose = (mesh as { skeleton?: THREE.Skeleton }).skeleton ? MOVES_POSE : 0
	const material = (Array.isArray(m) ? m.some((x) => movingMaterials.has(x)) : movingMaterials.has(m)) ? MOVES_MATERIAL : 0
	if (pose | material) {
		movers.set(mesh, pose | material)
		mesh.layers.enable(POSED_LAYER)
	}
	mesh.intersectsFrustum = (frustum: THREE.Frustum) => instancesMeet(mesh, frustum)
}
