// Run with: bun test tests/bvh.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { buildBoundsTree } from '../src/lib/world/bvh.ts'

/** A bumpy grid with two geometry groups, like a WoW model with two materials. */
function model() {
	const g = new THREE.PlaneGeometry(10, 10, 24, 24).rotateX(-Math.PI / 2)
	const pos = g.getAttribute('position')
	for (let i = 0; i < pos.count; i++) pos.setY(i, Math.sin(pos.getX(i)) * Math.cos(pos.getZ(i)))
	const n = g.index!.count
	g.clearGroups()
	g.addGroup(0, n / 2, 0)
	g.addGroup(n / 2, n / 2, 1)
	g.computeBoundingSphere()
	return g
}

function instances(geometry: THREE.BufferGeometry) {
	const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
	const mesh = new THREE.InstancedMesh(geometry, [mat, mat], 3)
	const m = new THREE.Matrix4()
	mesh.setMatrixAt(0, m.makeTranslation(0, 0, 0))
	mesh.setMatrixAt(1, m.compose(new THREE.Vector3(12, 2, -3), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7), new THREE.Vector3(1.5, 1.5, 1.5)))
	mesh.setMatrixAt(2, m.makeTranslation(-11, -1, 4))
	mesh.computeBoundingSphere()
	mesh.updateMatrixWorld()
	return mesh
}

test('picking an instanced model through its bounds tree finds the same nearest hits as a brute-force raycast', () => {
	const plain = instances(model())
	const tree = model()
	buildBoundsTree(tree)
	assert.ok(tree.boundsTree instanceof MeshBVH)
	const fast = instances(tree)

	const ray = new THREE.Raycaster()
	const rnd = (a: number, b: number) => a + Math.random() * (b - a)
	let hits = 0
	for (let k = 0; k < 300; k++) {
		ray.ray.origin.set(rnd(-20, 20), 30, rnd(-12, 12))
		ray.ray.direction.set(rnd(-0.3, 0.3), -1, rnd(-0.3, 0.3)).normalize()
		ray.firstHitOnly = false
		const want = ray.intersectObject(plain, false)
		ray.firstHitOnly = true
		const got = ray.intersectObject(fast, false)
		// The brute-force cast also returns hits behind the nearest on the same instance; the nearest
		// hit of each instance must agree.
		const nearest = new Map<number, number>()
		for (const h of want) if (!nearest.has(h.instanceId!)) nearest.set(h.instanceId!, h.distance)
		assert.equal(got.length, nearest.size)
		for (const h of got) assert.ok(Math.abs(h.distance - nearest.get(h.instanceId!)!) < 1e-4)
		hits += got.length
	}
	assert.ok(hits > 50, `rays hit the models (${hits})`)
})

test("building the tree keeps every group's triangles inside the group", () => {
	const g = model()
	const before = g.groups.map((gr) => {
		const set = new Set<string>()
		for (let i = gr.start; i < gr.start + gr.count; i += 3) set.add([g.index!.getX(i), g.index!.getX(i + 1), g.index!.getX(i + 2)].sort().join(','))
		return set
	})
	buildBoundsTree(g)
	g.groups.forEach((gr, k) => {
		for (let i = gr.start; i < gr.start + gr.count; i += 3) {
			assert.ok(before[k].has([g.index!.getX(i), g.index!.getX(i + 1), g.index!.getX(i + 2)].sort().join(',')))
		}
	})
})
