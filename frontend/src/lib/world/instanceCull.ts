import * as THREE from 'three'

// Culling of instanced models: only the instances that are in view (the camera's frustum, or the
// shadow camera's, so a model just off screen still throws its shadow into view) are packed into the
// instance buffer and drawn, and a model too small on screen to see is left out. Kept apart from the
// layers so it can be tested on its own.

/** What is in view this frame, for culling. */
export interface CullView {
	/** An instance is drawn when any of these holds it: the camera's frustum and, with shadows, the shadow camera's. */
	frustums: THREE.Frustum[]
	/** The camera `frustums[0]` belongs to, which a WMO culled by group culls its groups for (#198). */
	camera?: THREE.Camera
	/**
	 * The near shadow cascade's camera and frustum (null without shadows), redrawn every frame, which a
	 * WMO culled by group also culls its groups for (#215).
	 */
	shadowCamera?: THREE.Camera | null
	shadowFrustum?: THREE.Frustum | null
	/** An instance is also drawn when it touches one of these: the reach of the shadowed point lights. */
	spheres?: THREE.Sphere[]
	/** The camera's position. */
	eye: THREE.Vector3
	/** Pixels one world unit covers at a distance of one, for the small-model cutoff. */
	pxPerUnit: number
	/** Instances whose bounds would cover fewer pixels than this are left out; 0 keeps them all. */
	cutoffPx: number
	/** Instances whose bounds cover fewer pixels than this are drawn with their model's LOD; 0 never. */
	lodPx?: number
	/**
	 * Whether a batch culled as doodads (`cullSpheres`' `doodads`) leaves out the instances past the
	 * client's draw distance for their size (`doodadReach`): the world view's, as the game draws them.
	 */
	doodadReach?: boolean
	/**
	 * With the camera in a WMO room, the open world shows only through the room's doorways: an
	 * instance must also meet one of these frustums (none, in a sealed room). Null outside.
	 */
	gate?: THREE.Frustum[] | null
	/** The object the gate leaves alone: the building the camera is in, gated by its own groups. */
	gateExempt?: number
	/** With a gate, also lets through what stands in a room the flood reached (`world/roomAdmit.ts`). */
	gateAdmits?: ((s: THREE.Sphere) => boolean) | null
}

/** Whether a sphere passes the view's room gate (always, with no gate). */
export function throughGate(view: CullView, s: THREE.Sphere): boolean {
	const gate = view.gate
	if (!gate) return true
	for (let k = 0; k < gate.length; k++) if (gate[k].intersectsSphere(s)) return true
	return view.gateAdmits?.(s) ?? false
}

const sphere = new THREE.Sphere()
/** Scratch for `cullSpheres`: the instances only a shadow's frustum or a light's reach holds. */
const shadowOnly: number[] = []

/** Above this radius in yards a doodad has no draw distance of its own; only the far clip drops it. */
export const DOODAD_ALWAYS_RADIUS = 7

/**
 * How far in yards, across the ground, past its own radius a doodad (a placed M2) of `radius` yards is
 * drawn in the 1.12 client (#15): 50 for one up to half a yard (a candle), 125 up to 2.5 (a fence, a
 * haystack), 200 up to 7, and always above that (a tree). These are the ends of the client's distance
 * fade bands (Benilla's `model_fade.rs`, `doodad_fade_alpha`, read from the client at `0x683f80`);
 * the world view cuts at the end instead of fading.
 */
export function doodadReach(radius: number): number {
	if (radius > DOODAD_ALWAYS_RADIUS) return Infinity
	if (radius <= 0.5) return 50
	if (radius <= 2.5) return 125
	return 200
}

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
 * the caller can skip re-packing the instance buffer. With `doodads` and the view's `doodadReach`,
 * an instance further across the ground than its `doodadReach` past its radius is left out too.
 *
 * With `split`, `out` leads with the instances in the camera's frustum (`frustums[0]`), in order, and
 * then the ones only a shadow's frustum or a light's reach holds, in order; `split.view` says how many
 * lead (#15). The scene pass draws only those, the shadow passes all of them (`setPacked`).
 */
export function cullSpheres(view: CullView, spheres: Float32Array, n: number, out: number[], scratch: number[], exempt = -1, doodads = false, split?: { view: number }): boolean {
	scratch.length = 0
	shadowOnly.length = 0
	const { frustums, eye, pxPerUnit, cutoffPx } = view
	const reachCut = doodads && view.doodadReach === true
	for (let i = 0; i < n; i++) {
		const o = i * 4
		const r = spheres[o + 3]
		if (reachCut && r <= DOODAD_ALWAYS_RADIUS) {
			const far = doodadReach(r) + r
			const dx = spheres[o] - eye.x
			const dz = spheres[o + 2] - eye.z
			if (dx * dx + dz * dz > far * far) continue
		}
		sphere.center.set(spheres[o], spheres[o + 1], spheres[o + 2])
		sphere.radius = r
		if (cutoffPx > 0) {
			const d = eye.distanceTo(sphere.center)
			// Seen from outside, the model covers about its diameter over its distance.
			if (d > r && (2 * r * pxPerUnit) / d < cutoffPx) continue
		}
		const inView = frustums.length > 0 && frustums[0].intersectsSphere(sphere)
		let seen = inView
		for (let k = 1; !seen && k < frustums.length; k++) seen = frustums[k].intersectsSphere(sphere)
		const reach = view.spheres
		for (let k = 0; !seen && reach && k < reach.length; k++) seen = reach[k].intersectsSphere(sphere)
		if (seen && i !== exempt && !throughGate(view, sphere)) seen = false
		if (!seen) continue
		if (inView || !split) scratch.push(i)
		else shadowOnly.push(i)
	}
	const nView = scratch.length
	for (let k = 0; k < shadowOnly.length; k++) scratch.push(shadowOnly[k])
	let same = scratch.length === out.length && (!split || split.view === nView)
	for (let k = 0; same && k < scratch.length; k++) if (scratch[k] !== out[k]) same = false
	if (same) return false
	out.length = scratch.length
	for (let k = 0; k < scratch.length; k++) out[k] = scratch[k]
	if (split) split.view = nView
	return true
}

/**
 * Splits the instances `packed` names into the ones drawn in full (`near`) and the ones that cover
 * fewer than `view.lodPx` pixels and get their model's LOD (`far`). Returns false when both already
 * held exactly them, so the caller can skip re-packing. With `split`, the first `inView` of `packed`
 * are the ones in the camera's view (`cullSpheres`' `split`): each list keeps them in the lead, and
 * `split.near` and `split.far` say how many lead each.
 */
export function splitLod(view: CullView, spheres: Float32Array, packed: number[], near: number[], far: number[], scratchNear: number[], scratchFar: number[], inView = packed.length, split?: { near: number; far: number }): boolean {
	const { eye, pxPerUnit } = view
	const lodPx = view.lodPx ?? 0
	scratchNear.length = 0
	scratchFar.length = 0
	let nearView = 0
	let farView = 0
	for (let k = 0; k < packed.length; k++) {
		const i = packed[k]
		const o = i * 4
		const r = spheres[o + 3]
		const dx = spheres[o] - eye.x,
			dy = spheres[o + 1] - eye.y,
			dz = spheres[o + 2] - eye.z
		const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
		if (lodPx > 0 && d > r && (2 * r * pxPerUnit) / d < lodPx) {
			scratchFar.push(i)
			if (k < inView) farView++
		} else {
			scratchNear.push(i)
			if (k < inView) nearView++
		}
	}
	const a = copyIfChanged(scratchNear, near)
	const b = copyIfChanged(scratchFar, far)
	if (!split) return a || b
	const c = split.near !== nearView || split.far !== farView
	split.near = nearView
	split.far = farView
	return a || b || c
}

function copyIfChanged(from: number[], to: number[]): boolean {
	let same = from.length === to.length
	for (let k = 0; same && k < from.length; k++) if (from[k] !== to[k]) same = false
	if (same) return false
	to.length = from.length
	for (let k = 0; k < from.length; k++) to[k] = from[k]
	return true
}

/** Copies the matrices of the instances `packed` names (16 values each in `matrices`) to the front of `into`. */
export function packMatrices(matrices: Float32Array, packed: number[], into: Float32Array) {
	for (let k = 0; k < packed.length; k++) {
		const s = packed[k] * 16
		into.set(matrices.subarray(s, s + 16), k * 16)
	}
}
