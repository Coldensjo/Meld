// Run with: node --import ./tests/register.mjs --test tests/wmoGroupCull.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { WmoGroupCull } from '../src/lib/world/wmoGroupCull.ts'

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
