// Run with: bun test tests/wmoGroupCull.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { WmoGroupCull } from '../src/lib/world/wmoGroupCull.ts'
import { buildBoundsTree } from '../src/lib/world/bvh.ts'

/**
 * A model of one triangle per WMO group, side by side along x (group g at x = 100 g), plus one triangle
 * in no group at the origin, over two materials; the triangles are listed out of group order.
 */
function model() {
	const tris = [
		{ group: 2, mat: 0 },
		{ group: 0, mat: 0 },
		{ group: 1, mat: 0 },
		{ group: 4, mat: 1 },
		{ group: 3, mat: 1 },
		{ group: 1, mat: 1 },
	]
	const pos: number[] = []
	const room: number[] = []
	for (const t of tris) {
		const x = t.group ? 100 * (t.group - 1) : 0
		pos.push(x, 0, 0, x + 1, 0, 0, x, 1, 0)
		room.push(t.group, 0, t.group, 0, t.group, 0)
	}
	const g = new THREE.BufferGeometry()
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
	g.setAttribute('wmoRoom', new THREE.Uint16BufferAttribute(room, 2))
	g.setIndex(Array.from({ length: tris.length * 3 }, (_, i) => i))
	g.addGroup(0, 9, 0)
	g.addGroup(9, 9, 1)
	return g
}

/** A box-shaped view holding x from lo to hi (and everything in y and z near the model). */
function view(lo: number, hi: number) {
	const cam = new THREE.OrthographicCamera(lo, hi, 50, -50, 0.1, 100)
	cam.position.set(0, 0, 10)
	cam.updateMatrixWorld()
	const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
	return { cam, f }
}

/** The WMO groups of the triangles in an index range, by the room attribute of their first vertex. */
function groupsIn(c: WmoGroupCull, range: { start: number; count: number }) {
	const idx = c.geometry.index!.array
	const room = c.geometry.getAttribute('wmoRoom')
	const out: number[] = []
	for (let i = range.start; i < range.start + range.count; i += 3) out.push(room.getX(idx[i]))
	return out.sort()
}

const identity = new THREE.Matrix4().toArray()

test('a model without enough groups or triangles gets no cull', () => {
	assert.equal(WmoGroupCull.of(model()), null, 'the default thresholds rule out a small model')
	const plain = new THREE.BoxGeometry()
	assert.equal(WmoGroupCull.of(plain, 0, 0), null, 'no room attribute')
})

test('the full half keeps every triangle of each material, sorted into runs by group', () => {
	const m = model()
	const c = WmoGroupCull.of(m, 0, 2)!
	assert.ok(c)
	assert.equal(WmoGroupCull.of(m, 0, 2), c, 'made once a model')
	assert.deepEqual(groupsIn(c, c.fullRange(0)), [0, 1, 2])
	assert.deepEqual(groupsIn(c, c.fullRange(1)), [1, 3, 4])
	assert.equal(c.halfLength, 18)
	assert.equal(c.geometry.getAttribute('position'), m.getAttribute('position'), 'the twin shares the vertex buffers')
	assert.equal(m.index!.count, 18, 'the model keeps its own index')
})

test('the view half holds the groups in view and the triangles in no group', () => {
	const c = WmoGroupCull.of(model(), 0, 2)!
	const { cam, f } = view(-10, 150)
	c.update(cam, f, identity)
	assert.deepEqual(groupsIn(c, c.viewRange(0)), [0, 1, 2], 'groups 1 and 2 (x 0 and 100) and the loose triangle')
	assert.deepEqual(groupsIn(c, c.viewRange(1)), [1])
	assert.equal(c.drawn, 12)
	assert.equal(c.geometry.userData.drawnIndexCount, 12)

	// Moved over by the placement, group 4 (x 300) comes into view and groups 1 and 2 leave it.
	const moved = new THREE.Matrix4().makeTranslation(-300, 0, 0).toArray()
	c.update(cam, f, moved)
	assert.deepEqual(groupsIn(c, c.viewRange(0)), [0])
	assert.deepEqual(groupsIn(c, c.viewRange(1)), [4])
})

test('only the culled camera draws the view half, and the group is put back after', () => {
	const c = WmoGroupCull.of(model(), 0, 2)!
	const { cam, f } = view(-10, 50)
	c.update(cam, f, identity)
	const grp = c.geometry.groups[1]
	const shadowCam = new THREE.OrthographicCamera()
	c.before(shadowCam, grp)
	assert.deepEqual({ start: grp.start, count: grp.count }, c.fullRange(1), 'another camera draws the whole model')
	c.after(shadowCam, grp)
	c.before(cam, grp)
	assert.deepEqual({ start: grp.start, count: grp.count }, c.viewRange(1))
	c.after(cam, grp)
	assert.deepEqual({ start: grp.start, count: grp.count }, c.fullRange(1))

	c.update(null, f, identity)
	c.before(cam, grp)
	assert.deepEqual({ start: grp.start, count: grp.count }, c.fullRange(1), 'with the cull stopped, the view camera draws it all too')
	assert.equal(c.geometry.userData.drawnIndexCount, 18)
})

test('a material with nothing in view gets a negative count, so three skips its draw call (#934)', () => {
	const c = WmoGroupCull.of(model(), 0, 2)!
	const { cam, f } = view(90, 110)
	c.update(cam, f, identity)
	assert.deepEqual(groupsIn(c, c.viewRange(0)), [0, 2], 'group 2 (x 100) and the loose triangle')
	assert.equal(c.viewRange(1).count, 0, 'none of the second material in view')
	assert.equal(c.geometry.userData.drawnCalls, 1, 'the performance overlay counts one call')
	const grp = c.geometry.groups[1]
	c.before(cam, grp)
	assert.equal(grp.count, -1)
	c.after(cam, grp)
	assert.deepEqual({ start: grp.start, count: grp.count }, c.fullRange(1), 'put back after')
	c.update(null, f, identity)
	assert.equal(c.geometry.userData.drawnCalls, 2, 'every material again with the cull stopped')
})

test('a draw group the twin does not hold is left alone (#521)', () => {
	const c = WmoGroupCull.of(model(), 0, 2)!
	const { cam, f } = view(-10, 50)
	c.update(cam, f, identity)
	const other = { start: 3, count: 6, materialIndex: 1 }
	c.before(cam, other)
	assert.deepEqual(other, { start: 3, count: 6, materialIndex: 1 })
	c.after(cam, other)
	assert.deepEqual(other, { start: 3, count: 6, materialIndex: 1 })
	c.before(cam, null)
	c.after(cam, null)
})

test('the near shadow cascade adds its groups to the view half and draws it; other shadow cameras draw it all', () => {
	const c = WmoGroupCull.of(model(), 0, 2)!
	const { cam, f } = view(-10, 50)
	const near = view(250, 350)
	c.update(cam, f, identity, near.cam, near.f)
	assert.deepEqual(groupsIn(c, c.viewRange(0)), [0, 1], 'group 1 in view and the loose triangle')
	assert.deepEqual(groupsIn(c, c.viewRange(1)), [1, 4], 'group 1 in view, group 4 (x 300) in the cascade')
	const grp = c.geometry.groups[1]
	c.before(near.cam, grp)
	assert.deepEqual({ start: grp.start, count: grp.count }, c.viewRange(1), 'the near cascade draws the view half')
	c.after(near.cam, grp)
	assert.deepEqual({ start: grp.start, count: grp.count }, c.fullRange(1))
	const far = new THREE.OrthographicCamera()
	c.before(far, grp)
	assert.deepEqual({ start: grp.start, count: grp.count }, c.fullRange(1), 'the far cascade draws the whole model')
	c.after(far, grp)

	// Without shadows the cascade's groups leave the view half, and its camera draws the whole model.
	c.update(cam, f, identity, near.cam, null)
	assert.deepEqual(groupsIn(c, c.viewRange(1)), [1])
	c.before(near.cam, grp)
	assert.deepEqual({ start: grp.start, count: grp.count }, c.fullRange(1))
	c.after(near.cam, grp)
})

test("the batch mesh drawing the twin picks through the model's bounds tree (#286)", () => {
	const m = model()
	buildBoundsTree(m)
	const c = WmoGroupCull.of(m, 0, 2)!
	assert.equal(c.geometry.boundsTree, m.boundsTree, 'the twin shares the tree, so a ray never walks every triangle')
	const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
	const mesh = new THREE.InstancedMesh(c.geometry, [mat, mat], 1)
	mesh.setMatrixAt(0, new THREE.Matrix4())
	mesh.computeBoundingSphere()
	mesh.updateMatrixWorld()
	const ray = new THREE.Raycaster(new THREE.Vector3(100.2, 0.2, 10), new THREE.Vector3(0, 0, -1))
	ray.firstHitOnly = true
	const hits = ray.intersectObject(mesh, false)
	assert.equal(hits.length, 1)
	assert.ok(Math.abs(hits[0].distance - 10) < 1e-6, 'the hit is on group 2, at x 100')
	assert.equal(hits[0].instanceId, 0)
})

test('existing never builds a cull, and culledFor tells the culled placement from another', () => {
	const m = model()
	assert.equal(WmoGroupCull.existing(m), null, 'not made yet')
	const c = WmoGroupCull.of(m, 0, 2)!
	assert.equal(WmoGroupCull.existing(m), c)
	const { cam, f } = view(-10, 150)
	const placed = new THREE.Matrix4().makeTranslation(1000.5, 20, -3000.25)
	c.update(cam, f, new Float32Array(placed.elements))
	assert.ok(c.culledFor(placed), 'the same placement, through the float instance matrix')
	assert.ok(!c.culledFor(new THREE.Matrix4().makeTranslation(1010, 20, -3000.25)), 'another instance')
})
