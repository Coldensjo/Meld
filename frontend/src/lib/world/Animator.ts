import * as THREE from 'three'
import type { AnimBone, AnimTrack } from '../wow/api'
import { sampleTrack } from './uvAnim'

const IDENTITY = new THREE.Matrix4()

/**
 * A skeleton whose bones are posed straight in model space, so its inverses are the identity. three
 * calls `update` once a frame for every skeleton it draws, and its own multiplies each bone by its
 * inverse and uploads the bone texture whether the pose changed or not; this one copies the matrices
 * and flags the texture only after a new pose (#328). The scene, shadow and outline passes all draw
 * the same skeleton, so they stay in step.
 */
class PosedSkeleton extends THREE.Skeleton {
	/** Set by a new pose; cleared once its matrices are copied for drawing. */
	changed = true

	override update() {
		if (!this.changed) return
		this.changed = false
		const bones = this.bones
		const out = this.boneMatrices!
		for (let i = 0; i < bones.length; i++) bones[i].matrixWorld.toArray(out, i * 16)
		if (this.boneTexture) this.boneTexture.needsUpdate = true
	}
}

/** Whether a track holds one value (no keys past the first, or no loop), as `sampleTrack` reads it. */
function constant(tr: AnimTrack | undefined): boolean {
	return !tr || tr.t.length < 2 || !tr.loop
}

/**
 * Plays a model's idle loop on the GPU. Each frame the bones' matrices are sampled into a Skeleton
 * that every instance of the model shares, and the shader skins the vertices from it, so a model
 * type costs its bone count per frame rather than its vertex count, and nothing but the small bone
 * texture is uploaded. All instances of a model animate in sync.
 */
export class ModelAnimation {
	/** The bones' current matrices in model space, for any mesh drawing the geometry. */
	readonly skeleton: PosedSkeleton
	private bones: AnimBone[]
	/** The matrix of each bone: its Bone's world matrix, which the skeleton reads. */
	private mats: THREE.Matrix4[]
	/**
	 * Each bone's own transform about its pivot when none of its tracks moves (one key, or no loop),
	 * worked out once; null for a bone that moves.
	 */
	private local: (THREE.Matrix4 | null)[]
	/** Whether a bone's matrix never changes: it doesn't move, and nor does any bone above it. */
	private fixed: Uint8Array
	/** Whether any bone moves; a model with none is posed once. */
	private moving = false
	private tmpV = new THREE.Vector3()
	private tmpQ = new THREE.Quaternion()
	private tmpS = new THREE.Vector3()

	constructor(geometry: THREE.BufferGeometry, bones: AnimBone[], boneIdx: Uint8Array, boneW: Uint8Array) {
		this.bones = bones
		// A vertex no bone moves (all weights zero) keeps the bind pose through a still bone at the end.
		const rest = bones.length
		const idx = boneIdx.slice()
		const w = boneW.slice()
		const still = rest <= 255
		if (still) {
			for (let o = 0; o < w.length; o += 4) {
				if (w[o] + w[o + 1] + w[o + 2] + w[o + 3] === 0) {
					idx[o] = rest
					w[o] = 255
				}
			}
		}
		geometry.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4))
		geometry.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4, true))
		const list: THREE.Bone[] = []
		for (let i = 0; i < rest + (still ? 1 : 0); i++) {
			const b = new THREE.Bone()
			b.matrixAutoUpdate = false
			list.push(b)
		}
		this.mats = list.map((b) => b.matrixWorld)
		this.skeleton = new PosedSkeleton(
			list,
			list.map(() => new THREE.Matrix4()),
		)
		this.fixed = new Uint8Array(rest)
		this.local = bones.map((bone, i) => {
			if (!(constant(bone.tr) && constant(bone.rot) && constant(bone.sc))) {
				this.moving = true
				return null
			}
			// M2 lists parents before children.
			this.fixed[i] = bone.parent < 0 || bone.parent >= i || this.fixed[bone.parent] ? 1 : 0
			if (!this.fixed[i]) this.moving = true
			return this.boneLocal(bone, 0, new THREE.Matrix4())
		})
	}

	/** Bone `bone`'s own transform at `ms` about its pivot, into `out`: T(pivot) · TRS · T(-pivot). */
	private boneLocal(bone: AnimBone, ms: number, out: THREE.Matrix4): THREE.Matrix4 {
		this.tmpV.set(0, 0, 0)
		this.tmpQ.identity()
		this.tmpS.set(1, 1, 1)
		if (bone.tr) {
			sampleTrack(bone.tr, ms, 3, this.s3)
			this.tmpV.fromArray(this.s3)
		}
		if (bone.rot) {
			sampleTrack(bone.rot, ms, 4, this.s4)
			this.tmpQ.fromArray(this.s4).normalize()
		}
		if (bone.sc) {
			sampleTrack(bone.sc, ms, 3, this.s3)
			this.tmpS.fromArray(this.s3)
		}
		out.compose(this.tmpV, this.tmpQ, this.tmpS)
		// About the pivot p the translation becomes t + p - M·p, which spares two matrix products.
		const e = out.elements
		const p = bone.pivot
		const x = p[0],
			y = p[1],
			z = p[2]
		e[12] += x - (e[0] * x + e[4] * y + e[8] * z)
		e[13] += y - (e[1] * x + e[5] * y + e[9] * z)
		e[14] += z - (e[2] * x + e[6] * y + e[10] * z)
		return out
	}

	private s3 = [0, 0, 0]
	private s4 = [0, 0, 0, 1]

	/** Bone i's current matrix in model space (from the last `update`), or null for no such bone. */
	boneMatrix(i: number): THREE.Matrix4 | null {
		return i >= 0 && i < this.bones.length ? this.mats[i] : null
	}

	/** The last time the bones were posed for, or -1 before the first pose (the bind pose, often a T-pose). */
	posedAt = -1

	/** Poses the bones for time `ms`. The skeleton picks the matrices up when it is next drawn. */
	update(ms: number) {
		// A bone that never moves keeps the matrix of the first pose; a model with no moving bone is posed once.
		const first = this.posedAt < 0
		this.posedAt = ms
		if (!first && !this.moving) return
		const b = this.bones
		for (let i = 0; i < b.length; i++) {
			if (this.fixed[i] && !first) continue
			const bone = b[i]
			const m = this.mats[i]
			const local = this.local[i]
			if (local) m.copy(local)
			else this.boneLocal(bone, ms, m)
			// M2 lists parents before children.
			if (bone.parent >= 0 && bone.parent < i) m.premultiply(this.mats[bone.parent])
		}
		this.skeleton.changed = true
	}

	/**
	 * The bounds of `geometry` as the current pose skins it, for framing a view: a pose can carry a
	 * model far from its bind-pose box (a tree creature rising from the ground, a root bone that
	 * walks). Skins every vertex once on the CPU, so it is for a load, not a frame.
	 */
	posedBounds(geometry: THREE.BufferGeometry, out: THREE.Box3): THREE.Box3 {
		const pos = geometry.getAttribute('position') as THREE.BufferAttribute
		const idx = geometry.getAttribute('skinIndex') as THREE.BufferAttribute
		const w = geometry.getAttribute('skinWeight') as THREE.BufferAttribute
		out.makeEmpty()
		const v = this.tmpV
		const sum = new THREE.Vector3()
		for (let i = 0; i < pos.count; i++) {
			sum.set(0, 0, 0)
			let total = 0
			for (let k = 0; k < 4; k++) {
				const weight = w.getComponent(i, k)
				if (weight === 0) continue
				const m = this.mats[idx.getComponent(i, k)]
				if (!m) continue
				v.fromBufferAttribute(pos, i).applyMatrix4(m)
				sum.addScaledVector(v, weight)
				total += weight
			}
			if (total === 0) sum.fromBufferAttribute(pos, i)
			else if (total !== 1) sum.divideScalar(total)
			out.expandByPoint(sum)
		}
		return out
	}
}

/**
 * Instances of an animated model. The renderer skins any object flagged as a skinned mesh with its
 * skeleton, in model space before the instance matrix applies, so the instances share one pose.
 */
export class SkinnedInstancedMesh extends THREE.InstancedMesh {
	/** Read by the renderer: skin the vertices with `skeleton` in the shader. */
	readonly isSkinnedMesh = true
	readonly bindMatrix = IDENTITY
	readonly bindMatrixInverse = IDENTITY
	readonly skeleton: THREE.Skeleton

	constructor(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], count: number, skeleton: THREE.Skeleton) {
		super(geometry, material, count)
		this.skeleton = skeleton
	}
}

/**
 * One mesh of a model: a skinned mesh posed by `skeleton` when the model animates, so a preview or
 * an outline follows the instances, else a plain mesh.
 */
export function modelMesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], skeleton?: THREE.Skeleton | null): THREE.Mesh {
	if (!skeleton) return new THREE.Mesh(geometry, material)
	const m = new THREE.SkinnedMesh(geometry, material)
	// The bones are in model space, so the mesh's own transform must not fold into the bind matrix.
	m.bindMode = THREE.DetachedBindMode
	m.bind(skeleton, IDENTITY)
	return m
}

/** Whether `mesh` is posed by `skeleton` (null: not skinned at all), as modelMesh makes it. */
export function hasSkeleton(mesh: THREE.Mesh, skeleton: THREE.Skeleton | null | undefined): boolean {
	const s = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as THREE.SkinnedMesh).skeleton : null
	return (s ?? null) === (skeleton ?? null)
}
