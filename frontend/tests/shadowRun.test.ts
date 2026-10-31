// Run with: bun test tests/shadowRun.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { orderForShadows, setShadowRun, useShadowGroups, type ShadowGroup } from '../src/lib/world/shadowRun.ts'
import { WmoGroupCull } from '../src/lib/world/wmoGroupCull.ts'

test('the groups whose shadow draws merge lead the index, in their order, the others after them', () => {
	// Each triangle's indices name its group: 1s, 2s, 3s, 4s.
	const index = new Uint32Array([1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4])
	const groups: ShadowGroup[] = [
		{ start: 0, count: 3, blend: 0 },
		{ start: 3, count: 3, blend: 1 },
		{ start: 6, count: 6, blend: 2 },
		{ start: 12, count: 3, blend: 0, color: {} },
	]
	const starts: number[] = []
	const run = orderForShadows(index, groups, starts)
	assert.deepEqual(run, { start: 0, count: 9, groups: [0, 2] }, 'the opaque and the blended group merge, the cut-out and the fading one do not')
	assert.deepEqual([...index], [1, 1, 1, 3, 3, 3, 3, 3, 3, 2, 2, 2, 4, 4, 4])
	assert.deepEqual(starts, [0, 9, 3, 12])
})

test('nothing moves with fewer than two groups to merge, or groups that do not tile the index', () => {
	const index = new Uint16Array([1, 1, 1, 2, 2, 2])
	assert.equal(
		orderForShadows(
			index,
			[
				{ start: 0, count: 3, blend: 0 },
				{ start: 3, count: 3, blend: 1 },
			],
			[],
		),
		null,
	)
	assert.equal(
		orderForShadows(
			index,
			[
				{ start: 0, count: 3, blend: 0 },
				{ start: 0, count: 3, blend: 0 },
			],
			[],
		),
		null,
		'overlapping',
	)
	assert.equal(
		orderForShadows(
			index,
			[
				{ start: 0, count: 3, blend: 0 },
				{ start: 4, count: 2, blend: 0 },
			],
			[],
		),
		null,
		'a gap',
	)
	assert.deepEqual([...index], [1, 1, 1, 2, 2, 2])
})

test("while the shadow maps are drawn, a geometry's groups are one for the merged run and the others as they are", () => {
	const g = new THREE.BufferGeometry()
	g.addGroup(0, 3, 0)
	g.addGroup(9, 3, 1)
	g.addGroup(3, 6, 2)
	const own = g.groups
	setShadowRun(g, { start: 0, count: 9, groups: [0, 2] })
	useShadowGroups(true)
	assert.deepEqual(
		g.groups.map((x) => [x.start, x.count, x.materialIndex]),
		[
			[0, 9, 0],
			[9, 3, 1],
		],
	)
	assert.equal(g.groups[1], own[1], 'the cut-out keeps its own group, which the cull hooks know')
	useShadowGroups(false)
	assert.equal(g.groups, own)
	g.dispose()
	useShadowGroups(true)
	assert.equal(g.groups, own, 'a disposed geometry is no longer swapped')
	useShadowGroups(false)
})

/** One triangle per WMO group along x (group g at x = 100 (g - 1)), over three materials: opaque, cut-out, opaque. */
function model() {
	const tris = [
		{ group: 1, mat: 0 },
		{ group: 3, mat: 0 },
		{ group: 1, mat: 1 },
		{ group: 2, mat: 1 },
		{ group: 2, mat: 2 },
		{ group: 3, mat: 2 },
		{ group: 4, mat: 2 },
	]
	const pos: number[] = []
	const room: number[] = []
	for (const t of tris) {
		const x = 100 * (t.group - 1)
		pos.push(x, 0, 0, x + 1, 0, 0, x, 1, 0)
		room.push(t.group, 0, t.group, 0, t.group, 0)
	}
	const g = new THREE.BufferGeometry()
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
	g.setAttribute('wmoRoom', new THREE.Uint16BufferAttribute(room, 2))
	const index = new Uint32Array(tris.length * 3).map((_, i) => i)
	const groups: ShadowGroup[] = [
		{ start: 0, count: 6, blend: 0 },
		{ start: 6, count: 6, blend: 1 },
		{ start: 12, count: 9, blend: 0 },
	]
	const starts: number[] = []
	const run = orderForShadows(index, groups, starts)!
	g.setIndex(new THREE.BufferAttribute(index, 1))
	groups.forEach((grp, i) => g.addGroup(starts[i], grp.count, i))
	setShadowRun(g, run)
	return g
}

function view(lo: number, hi: number) {
	const cam = new THREE.OrthographicCamera(lo, hi, 50, -50, 0.1, 100)
	cam.position.set(0, 0, 10)
	cam.updateMatrixWorld()
	const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
	return { cam, f }
}

function groupsIn(c: WmoGroupCull, start: number, count: number) {
	const idx = c.geometry.index!.array
	const room = c.geometry.getAttribute('wmoRoom')
	const out: number[] = []
	for (let i = start; i < start + count; i += 3) out.push(room.getX(idx[i]))
	return out.sort()
}

test("a group cull draws the merged materials as one call from either half, and the scene pass each material's own", () => {
	const c = WmoGroupCull.of(model(), 0, 2)!
	assert.ok(c)
	const [, cut, last] = c.geometry.groups
	useShadowGroups(true)
	const [lead, cutShadow] = c.geometry.groups
	useShadowGroups(false)
	assert.equal(cutShadow, cut)
	const other = new THREE.OrthographicCamera()
	// The far cascade: the full half's run.
	c.shadowBefore(other, lead)
	assert.deepEqual(groupsIn(c, lead.start, lead.count), [1, 2, 3, 3, 4])
	c.shadowAfter(other, lead)
	assert.deepEqual([lead.start, lead.count], [0, 15])

	// Groups 1 and 2 in view (x 0 and 100): the view half's run holds their merged triangles, one after another.
	const { cam, f } = view(-10, 150)
	const identity = new THREE.Matrix4().toArray()
	c.update(cam, f, identity)
	c.shadowBefore(other, lead)
	assert.deepEqual([lead.start, lead.count], [0, 15], 'another camera draws the full run')
	c.shadowAfter(other, lead)
	c.shadowBefore(cam, lead)
	assert.deepEqual(groupsIn(c, lead.start, lead.count), [1, 2])
	assert.equal(lead.start, c.halfLength)
	c.shadowAfter(cam, lead)
	assert.deepEqual([lead.start, lead.count], [0, 15])
	c.before(cam, last)
	assert.deepEqual(groupsIn(c, last.start, last.count), [2], "the scene pass draws the last material's own run")
	c.after(cam, last)
	c.shadowBefore(cam, cut)
	assert.deepEqual(groupsIn(c, cut.start, cut.count), [1, 2], 'the cut-out draws its own view run')
	c.shadowAfter(cam, cut)

	// Nothing merged in view: the run draws nothing rather than an empty call.
	const away = view(1000, 1100)
	c.update(away.cam, away.f, identity)
	c.shadowBefore(away.cam, lead)
	assert.equal(lead.count, -1)
	c.shadowAfter(away.cam, lead)
	assert.deepEqual([lead.start, lead.count], [0, 15])
})
