import * as THREE from 'three'
import { SkinnedInstancedMesh } from './Animator'
import { cullSpheres, instanceSphere, packMatrices, type CullView } from './instanceCull'
import { cullForShadows, setPacked } from './shadowReach'

// The instance batch ObjectLayer and SpawnLayer share (#517): the rows of one model's instances (a
// world matrix and a bounding sphere each), the cull that picks the ones in view, and the packing of
// those into an instanced mesh's buffer, with the item each instance draws for picking. What the
// layers keep apart is what they batch: the object tree, its LOD split and WMO extras in ObjectLayer;
// spawns grouped by kind and marker in SpawnLayer.

/** With more moved rows than this, a mesh uploads its whole instance buffer rather than a range a row. */
export const RANGES_MAX = 32

/** The instance buffers `pack` rewrote that three has not uploaded yet: a range upload would cut that short. */
const wholePending = new WeakSet<THREE.InstancedBufferAttribute>()

/** Sets up an instance buffer for rewrites every frame, and clears its pending whole upload once three has made it. */
export function watchUploads(attr: THREE.InstancedBufferAttribute) {
	attr.setUsage(THREE.DynamicDrawUsage)
	attr.onUpload(() => wholePending.delete(attr))
}

/**
 * An instanced mesh for up to `capacity` instances of a model, skinned when it has a `skeleton`,
 * drawing nothing until the first `pack`. Our own cull packs what is in view; three only culls it per
 * point-light shadow face (`cullForShadows`). `ids` names the item each instance draws, as `pack`
 * writes it; the mesh keeps it in `userData.ids` for `hitId`, by reference.
 */
export function instancedMesh<T>(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], capacity: number, skeleton: THREE.Skeleton | null | undefined, ids: T[]): THREE.InstancedMesh {
	const m = skeleton ? new SkinnedInstancedMesh(geometry, material, capacity, skeleton) : new THREE.InstancedMesh(geometry, material, capacity)
	watchUploads(m.instanceMatrix)
	m.count = 0
	m.visible = false
	m.userData.ids = ids
	cullForShadows(m)
	// Once its textures are bound: a model's material gets its texture when the texture loads (`map`
	// and `needsUpdate`, models/assets.ts), and that is a program of its own.
	const list = Array.isArray(material) ? material : [material]
	void Promise.allSettled(list.map((x) => x.userData.ready as Promise<void> | undefined)).then(() => readyAhead(m))
	return m
}

/**
 * Has the engine compile the shaders of `o` (a mesh, or anything holding meshes) and upload its
 * textures ahead of its first draw (`precompileFresh`): call it once its materials have their
 * textures bound, as `instancedMesh` does for a model's mesh and the particle layer for a draw (#904).
 */
export function readyAhead(o: THREE.Object3D) {
	fresh.push(o)
}

/** The meshes `readyAhead` named since the engine last precompiled their shaders (`precompileFresh`). */
let fresh: THREE.Object3D[] = []
/** The meshes whose textures `precompileFresh` uploads ahead, a few each frame, from `uploadHead` on. */
let uploads: THREE.Object3D[] = []
let uploadHead = 0
/**
 * The texture bytes `precompileFresh` uploads ahead a frame, at most (and at least one mesh's): the first
 * frame at a new spot in Blackrock Depths uploaded 135 textures, 1.8 MB, at their first draw (#904).
 */
export const UPLOAD_BYTES = 2 << 20

/** The texture-valued properties of three's materials, and a `ShaderMaterial`'s texture uniforms. */
const TEXTURE_KEYS = ['map', 'alphaMap', 'lightMap', 'aoMap', 'emissiveMap', 'specularMap', 'normalMap', 'bumpMap', 'envMap'] as const

/** Calls `f` with each texture the materials of `o` and the meshes below it map. */
function eachTexture(o: THREE.Object3D, f: (t: THREE.Texture) => void) {
	o.traverse((x) => {
		const mat = (x as THREE.Mesh).material
		if (!mat) return
		for (const m of Array.isArray(mat) ? mat : [mat]) {
			for (const k of TEXTURE_KEYS) {
				const t: unknown = Reflect.get(m, k)
				if (t instanceof THREE.Texture) f(t)
			}
			const uniforms = (m as THREE.ShaderMaterial).uniforms
			if (uniforms)
				for (const k in uniforms) {
					const t: unknown = uniforms[k].value
					if (t instanceof THREE.Texture) f(t)
				}
		}
	})
}

/** About the bytes a texture takes on the GPU: its mip levels as stored, or four a texel and a third more for the mips. */
export function textureBytes(t: THREE.Texture): number {
	const mips = (t as THREE.CompressedTexture).mipmaps as { data?: ArrayBufferView }[] | undefined
	if ((t as THREE.CompressedTexture).isCompressedTexture && mips?.length) {
		let n = 0
		for (const m of mips) n += m.data?.byteLength ?? 0
		return n
	}
	const img = t.image as { width?: number; height?: number } | null | undefined
	const n = (img?.width ?? 0) * (img?.height ?? 0) * 4
	return t.generateMipmaps ? Math.ceil((n * 4) / 3) : n
}

/**
 * Uploads the textures of the queued meshes still in the scene that three has not uploaded yet, up to
 * `UPLOAD_BYTES` (#904). Three uploads a texture at its first draw, so a model the camera first turns to
 * uploaded all of them in that one frame.
 */
function uploadAhead(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
	let bytes = 0
	const props = renderer.properties
	const upload = (t: THREE.Texture) => {
		// Uploaded as it is: `initTexture` would only bind it. Version 0 has no image yet.
		if (t.version === 0 || (props.get(t) as { __version?: number }).__version === t.version) return
		renderer.initTexture(t)
		bytes += textureBytes(t)
	}
	while (uploadHead < uploads.length && bytes < UPLOAD_BYTES) {
		const o = uploads[uploadHead++]
		// Taken off its layer (disposed) since: its textures may be let go of too.
		if (inScene(o, scene)) eachTexture(o, upload)
	}
	if (uploadHead === uploads.length) {
		uploads = []
		uploadHead = 0
	}
}

/** Walks only `items`, so `renderer.compile` reaches the fresh meshes where they hang and no other. */
class MeshList extends THREE.Object3D {
	items: THREE.Object3D[] = []
	override traverse(callback: (o: THREE.Object3D) => void) {
		for (const o of this.items) o.traverse(callback)
	}
	// Lights only: the scene's own are what `compile` lights the meshes with.
	override traverseVisible() {}
}
const freshList = new MeshList()

/**
 * Compiles the shaders of the meshes `readyAhead` named since the last call, for `scene` as `camera`
 * draws it, without waiting for them (#903), then uploads a frame's share of their textures
 * (`uploadAhead`, #904). Three compiles a material's program when it is first drawn and waits there
 * for the driver: on the GPU (D3D11 through ANGLE) each new model shader cost 100 to 600 ms the first
 * time the camera turned to it, as flying Blackrock Depths did. Issued once a model's mesh is made and its textures bound, the
 * compile runs in the driver's own threads (KHR_parallel_shader_compile) while the camera looks
 * elsewhere, and the first draw finds the program ready; `pollLinks` then reads what three reads at a
 * program's first draw, once the driver has it linked. Called right after the scene's render, so the
 * render target and lights are the ones the scene draws with; a mesh not in `scene` (`inScene`) is skipped.
 */
export function precompileFresh(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
	if (fresh.length) {
		const items = freshList.items
		for (const m of fresh) {
			if (!inScene(m, scene)) continue
			items.push(m)
			uploads.push(m)
		}
		fresh = []
		if (items.length) {
			const props = renderer.properties
			// Every program of each material: one shared by a skinned and a still mesh has one for each,
			// and `currentProgram` names only the last.
			for (const m of renderer.compile(freshList, camera, scene)) {
				const ps = (props.get(m) as { programs?: Map<string, Program> }).programs
				if (ps) for (const p of ps.values()) linking.add(p)
			}
			if (linking.size) pollLinks(renderer)
		}
		items.length = 0
	}
	if (uploads.length) uploadAhead(renderer, scene)
}

/** Three's program, with what it has but does not type: whether the driver has linked it, asked without waiting. */
type Program = THREE.WebGLProgram & { isReady(): boolean }

/** The programs `precompileFresh` had made that three has not used yet, until the driver has linked them. */
const linking = new Set<Program>()
let polling: ReturnType<typeof setTimeout> | null = null

/**
 * Uses each program in `linking` once the driver has linked it, between frames (#904). Three reads a
 * program's info log and uniforms at its first draw, and that waits for the GPU process: on the GPU
 * (D3D11 through ANGLE) a program compiled ahead still cost its first frame 10 to 20 ms there, the
 * frame at a new spot in Blackrock Depths 40 to 70 ms. Polled every 10 ms as three's `compileAsync` polls,
 * so the frame never waits; a program let go of since (its material disposed) is dropped.
 */
function pollLinks(renderer: THREE.WebGLRenderer) {
	if (polling !== null) return
	const poll = () => {
		const live = renderer.info.programs ?? []
		for (const p of linking) {
			if (!live.includes(p)) linking.delete(p)
			else if (p.isReady()) {
				p.getUniforms()
				linking.delete(p)
			}
		}
		polling = linking.size ? setTimeout(poll, 10) : null
	}
	polling = setTimeout(poll, 10)
}

/**
 * Whether `o` is drawn by the engine's renderer: it hangs in `scene`, or in a layer of a map tab not
 * shown now (taken off the scene by `Engine.activate`), but is not taken off its layer (disposed) and
 * not in another scene, such as a preview's, which draws with a renderer of its own.
 */
function inScene(o: THREE.Object3D, scene: THREE.Scene): boolean {
	if (!o.parent) return false
	let p: THREE.Object3D = o
	while (p.parent) p = p.parent
	return p === scene || !(p as THREE.Scene).isScene
}

/** The position of `v` in `sorted[from..to)`, ascending, or -1. */
function indexIn(sorted: number[], v: number, from = 0, to = sorted.length): number {
	let lo = from
	let hi = to - 1
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		const x = sorted[mid]
		if (x === v) return mid
		if (x < v) lo = mid + 1
		else hi = mid - 1
	}
	return -1
}

// Scratch for `patch`.
const patchM = new THREE.Matrix4()
const patchS = new Float32Array(4)
const patchSphere = new THREE.Sphere()

/**
 * The rows of one batch of instances: `items[i]` is drawn with the matrix at `matrices[i * 16]` and
 * has the bounding sphere at `spheres[i * 4]`. `cull` finds the rows in view (`packed`), and `pack`
 * and `patch` write them into the meshes that draw them.
 */
export class InstanceBatch<T> {
	/** What each row draws: an object id, a spawn. */
	items: T[] = []
	matrices = new Float32Array(0)
	spheres = new Float32Array(0)
	/**
	 * Indices into `items` of the rows in view as of the last `cull`: first the ones in the camera's view
	 * (`split.view` of them), then the ones only a shadow needs, each part ascending.
	 */
	readonly packed: number[] = []
	/** How many of `packed` lead as the rows in the camera's view. */
	readonly split = { view: 0 }
	private readonly scratch: number[] = []
	/** Makes the next `cull` report a change even with the same rows in view: rows were rewritten. */
	repack = true

	/** Makes room for `n` rows. The rows are not kept when it grows: write them all again. */
	reserve(n: number) {
		if (this.matrices.length >= n * 16) return
		this.matrices = new Float32Array(n * 16)
		this.spheres = new Float32Array(n * 4)
	}

	/** Writes row `i`: its matrix `m`, and the sphere of `geometry` placed by it. */
	setRow(i: number, m: THREE.Matrix4, geometry: THREE.BufferGeometry) {
		m.toArray(this.matrices, i * 16)
		instanceSphere(geometry, m, this.spheres, i * 4)
	}

	/**
	 * Finds the rows in `view` (`cullSpheres`; `exempt` is a row the room gate lets through, `doodads`
	 * cuts by the doodad draw distance) into `packed`. Returns whether they changed, or `repack` was set,
	 * so the meshes need packing again.
	 */
	cull(view: CullView, exempt = -1, doodads = false): boolean {
		const changed = cullSpheres(view, this.spheres, this.items.length, this.packed, this.scratch, exempt, doodads, this.split)
		const again = this.repack
		this.repack = false
		return changed || again
	}

	/**
	 * Packs the rows `which` names (indices into `items`, `packed` by default, the first `view` of them
	 * in the camera's view) to the front of `mesh`, and the items they draw into `ids` (the mesh's
	 * `userData.ids`). The mesh's `count` is the ones in view; its shadow passes draw them all
	 * (`setPacked`). An empty mesh is hidden: three would still set up each of its groups in every pass (#323).
	 */
	pack(mesh: THREE.InstancedMesh, ids: T[], which: number[] = this.packed, view = this.split.view) {
		packMatrices(this.matrices, which, mesh.instanceMatrix.array as Float32Array)
		ids.length = which.length
		for (let k = 0; k < which.length; k++) ids[k] = this.items[which[k]]
		setPacked(mesh, which.length, view)
		mesh.visible = which.length > 0
		// The whole buffer: a range left from a `patch` not yet uploaded would cut the upload short.
		mesh.instanceMatrix.clearUpdateRanges()
		mesh.instanceMatrix.needsUpdate = true
		wholePending.add(mesh.instanceMatrix)
		// Picking tests the mesh's sphere first, so it must cover the instances drawn (in view).
		mesh.computeBoundingSphere()
	}

	/**
	 * Writes the rows `moved` (indices into `items`, rewritten by `setRow` since the last pack) into
	 * `mesh`, where `which` (as packed into it, the first `view` of them in view) draws them, and
	 * uploads only those rows (#510). The mesh's sphere grows to cover the ones in view; the next
	 * `pack` fits it again.
	 */
	patch(mesh: THREE.InstancedMesh, moved: readonly number[], which: number[] = this.packed, view = this.split.view) {
		const attr = mesh.instanceMatrix
		const arr = attr.array as Float32Array
		const ranged = !wholePending.has(attr) && moved.length <= RANGES_MAX
		let any = false
		for (const i of moved) {
			let k = indexIn(which, i, 0, view)
			if (k < 0) k = indexIn(which, i, view)
			if (k < 0) continue
			const s = i * 16
			const d = k * 16
			for (let j = 0; j < 16; j++) arr[d + j] = this.matrices[s + j]
			if (ranged) attr.addUpdateRange(d, 16)
			patchM.fromArray(this.matrices, s)
			instanceSphere(mesh.geometry, patchM, patchS, 0)
			patchSphere.center.set(patchS[0], patchS[1], patchS[2])
			patchSphere.radius = patchS[3]
			if (mesh.boundingSphere && k < view) mesh.boundingSphere.union(patchSphere)
			any = true
		}
		if (!any) return
		if (!ranged) attr.clearUpdateRanges()
		attr.needsUpdate = true
		if (!mesh.boundingSphere) mesh.computeBoundingSphere()
	}
}
