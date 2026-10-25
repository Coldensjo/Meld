// Run with: bun test tests/animator.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { ModelAnimation, SkinnedInstancedMesh, hasSkeleton, modelMesh } from '../src/lib/world/Animator.ts'
import type { AnimBone } from '../src/lib/wow/api.ts'

function geometry(verts: number) {
	const g = new THREE.BufferGeometry()
	g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
	g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
	return g
}

const near = (a: ArrayLike<number>, b: ArrayLike<number>, msg?: string) => {
	assert.equal(a.length, b.length, msg)
	for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-5, `${msg ?? ''} [${i}] ${a[i]} vs ${b[i]}`)
}

test("the skeleton holds each bone's matrix about its pivot, with parents applied", () => {
	const bones: AnimBone[] = [
		{ parent: -1, pivot: [0, 0, 0], tr: { t: [0, 1000], v: [0, 0, 0, 10, 0, 0], loop: 1000 } },
		{ parent: 0, pivot: [0, 2, 0], rot: { t: [0, 1000], v: [0, 0, 0, 1, 0, 0, 0, 1], loop: 1000 } },
	]
	const g = geometry(2)
	const a = new ModelAnimation(g, bones, new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0]), new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0]))
	a.update(500)
	a.skeleton.update()
	const m = a.skeleton.boneMatrices!
	// Bone 0 slides 5 units along x at the loop's midpoint.
	near(m.subarray(12, 15), [5, 0, 0], 'bone 0 translation')
	// Bone 1 turns nothing but is a child of bone 0, so it carries the slide.
	near(m.subarray(16 + 12, 16 + 15), [5, 0, 0], 'bone 1 inherits the parent')
	assert.equal(a.skeleton.bones.length, 3, "a still bone sits after the model's bones")
})

test('vertices with no bone weight are tied to the still bone, and the attributes are shared skinning inputs', () => {
	const g = geometry(2)
	const bones: AnimBone[] = [{ parent: -1, pivot: [0, 0, 0], tr: { t: [0], v: [3, 0, 0], loop: 0 } }]
	const a = new ModelAnimation(g, bones, new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array([255, 0, 0, 0, 0, 0, 0, 0]))
	const idx = g.getAttribute('skinIndex') as THREE.BufferAttribute
	const w = g.getAttribute('skinWeight') as THREE.BufferAttribute
	assert.deepEqual([...(idx.array as Uint8Array)], [0, 0, 0, 0, 1, 0, 0, 0])
	assert.deepEqual([...(w.array as Uint8Array)], [255, 0, 0, 0, 255, 0, 0, 0])
	assert.equal(w.normalized, true, 'weights are 0 to 1 in the shader')
	a.update(0)
	a.skeleton.update()
	near(a.skeleton.boneMatrices!.subarray(16, 32), new THREE.Matrix4().elements, 'the still bone is the identity')
})

test('meshes of an animated model are skinned with its skeleton; others are plain', () => {
	const g = geometry(1)
	const a = new ModelAnimation(g, [{ parent: -1, pivot: [0, 0, 0] }], new Uint8Array(4), new Uint8Array([255, 0, 0, 0]))
	const mat = new THREE.MeshBasicMaterial()
	const inst = new SkinnedInstancedMesh(g, mat, 4, a.skeleton)
	assert.equal(inst.isInstancedMesh, true)
	assert.equal(inst.isSkinnedMesh, true)
	assert.equal(inst.skeleton, a.skeleton)
	const skinned = modelMesh(g, mat, a.skeleton)
	assert.ok((skinned as THREE.SkinnedMesh).isSkinnedMesh)
	assert.equal((skinned as THREE.SkinnedMesh).bindMode, THREE.DetachedBindMode)
	assert.ok(hasSkeleton(skinned, a.skeleton))
	assert.ok(!hasSkeleton(skinned, null))
	const plain = modelMesh(g, mat, null)
	assert.ok(!(plain as THREE.SkinnedMesh).isSkinnedMesh)
	assert.ok(hasSkeleton(plain, null))
	assert.ok(!hasSkeleton(plain, a.skeleton))
})

test('a stepped bone track holds its last key until the loop ends', () => {
	const bones: AnimBone[] = [{ parent: -1, pivot: [0, 0, 0], tr: { t: [0, 500], v: [0, 0, 0, 4, 0, 0], loop: 1000, step: true } }]
	const a = new ModelAnimation(geometry(1), bones, new Uint8Array([0, 0, 0, 0]), new Uint8Array([255, 0, 0, 0]))
	a.update(700)
	a.skeleton.update()
	near(a.skeleton.boneMatrices!.subarray(12, 15), [4, 0, 0], 'the second key holds')
})

test('a bone turns and scales about its pivot under its parent, as T(pivot) · TRS · T(-pivot) (#328)', () => {
	const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 3)
	const bones: AnimBone[] = [
		{ parent: -1, pivot: [1, 2, 3], tr: { t: [0, 1000], v: [0, 0, 0, 4, 0, 2], loop: 1000 } },
		{ parent: 0, pivot: [-2, 5, 1], rot: { t: [0, 1000], v: [0, 0, 0, 1, q.x, q.y, q.z, q.w], loop: 1000 }, sc: { t: [0], v: [2, 1, 0.5], loop: 0 } },
		// Still, under a moving parent: it follows the parent each pose.
		{ parent: 1, pivot: [0, 1, 0], tr: { t: [0], v: [0, 3, 0], loop: 1000 } },
	]
	const a = new ModelAnimation(geometry(1), bones, new Uint8Array([0, 0, 0, 0]), new Uint8Array([255, 0, 0, 0]))
	const expect = (bone: AnimBone, tr: number[], rot: THREE.Quaternion, sc: number[]) => {
		const p = bone.pivot
		return new THREE.Matrix4()
			.makeTranslation(p[0], p[1], p[2])
			.multiply(new THREE.Matrix4().compose(new THREE.Vector3(...tr), rot, new THREE.Vector3(...sc)))
			.multiply(new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]))
	}
	for (const ms of [250, 1500]) {
		a.update(ms)
		const f = (ms % 1000) / 1000
		const m0 = expect(bones[0], [4 * f, 0, 2 * f], new THREE.Quaternion(), [1, 1, 1])
		const m1 = m0.clone().multiply(expect(bones[1], [0, 0, 0], new THREE.Quaternion(q.x * f, q.y * f, q.z * f, 1 + (q.w - 1) * f).normalize(), [2, 1, 0.5]))
		const m2 = m1.clone().multiply(expect(bones[2], [0, 3, 0], new THREE.Quaternion(), [1, 1, 1]))
		near(a.boneMatrix(0)!.elements, m0.elements, `bone 0 at ${ms}`)
		near(a.boneMatrix(1)!.elements, m1.elements, `bone 1 at ${ms}`)
		near(a.boneMatrix(2)!.elements, m2.elements, `bone 2 at ${ms}`)
	}
})

test('the skeleton copies the bones and uploads its texture only after a new pose (#328)', () => {
	const bones: AnimBone[] = [{ parent: -1, pivot: [0, 0, 0], tr: { t: [0, 1000], v: [0, 0, 0, 10, 0, 0], loop: 1000 } }]
	const a = new ModelAnimation(geometry(1), bones, new Uint8Array([0, 0, 0, 0]), new Uint8Array([255, 0, 0, 0]))
	a.skeleton.computeBoneTexture()
	const tex = a.skeleton.boneTexture!
	a.update(500)
	const v0 = tex.version
	a.skeleton.update()
	assert.ok(tex.version > v0, 'a new pose uploads')
	near(a.skeleton.boneMatrices!.subarray(12, 15), [5, 0, 0], "into the texture's own array")
	const v1 = tex.version
	a.skeleton.update()
	assert.equal(tex.version, v1, 'no pose since, no upload')
	a.update(250)
	a.skeleton.update()
	assert.ok(tex.version > v1, 'the next pose uploads')
	near(a.skeleton.boneMatrices!.subarray(12, 15), [2.5, 0, 0])
})

test('a model whose bones never move is posed once, at its first frame (#328)', () => {
	const bones: AnimBone[] = [
		{ parent: -1, pivot: [0, 0, 0], tr: { t: [0], v: [3, 0, 0], loop: 1000 } },
		{ parent: 0, pivot: [0, 0, 0], tr: { t: [0, 500], v: [0, 1, 0, 0, 9, 0], loop: 0 } },
	]
	const a = new ModelAnimation(geometry(1), bones, new Uint8Array([0, 0, 0, 0]), new Uint8Array([255, 0, 0, 0]))
	a.update(0)
	a.skeleton.update()
	near(a.boneMatrix(1)!.elements.slice(12, 15), [3, 1, 0], 'a track with no loop holds its first key')
	a.boneMatrix(1)!.elements[12] = 99
	a.update(400)
	assert.equal(a.boneMatrix(1)!.elements[12], 99, 'not posed again')
	assert.equal(a.posedAt, 400)
})
