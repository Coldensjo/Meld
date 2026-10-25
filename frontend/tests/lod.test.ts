// Run with: bun test tests/lod.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildLod } from '../src/lib/models/lod.ts'

/** A dense sphere with two material groups, top and bottom half. */
function model() {
	const g = new THREE.SphereGeometry(5, 64, 48)
	const n = g.index!.count
	const half = Math.floor(n / 6) * 3
	g.clearGroups()
	g.addGroup(0, half, 0)
	g.addGroup(half, n - half, 1)
	g.computeBoundingSphere()
	return g
}

test('a LOD keeps the groups, shares the vertex buffers and has far fewer triangles', async () => {
	const g = model()
	const lod = await buildLod(g)
	assert.ok(lod)
	assert.ok(lod.index!.count < g.index!.count * 0.7, `${lod.index!.count} of ${g.index!.count}`)
	assert.equal(lod.getAttribute('position'), g.getAttribute('position'))
	assert.equal(lod.getAttribute('uv'), g.getAttribute('uv'))
	assert.deepEqual(
		lod.groups.map((x) => x.materialIndex),
		[0, 1],
	)
	// Each group's triangles still use only that group's vertices.
	g.groups.forEach((gr, k) => {
		const verts = new Set<number>()
		for (let i = gr.start; i < gr.start + gr.count; i++) verts.add(g.index!.getX(i))
		const lg = lod.groups[k]
		assert.ok(lg.count > 0 && lg.count % 3 === 0)
		for (let i = lg.start; i < lg.start + lg.count; i++) assert.ok(verts.has(lod.index!.getX(i)))
	})
	assert.equal(lod.groups.at(-1)!.start + lod.groups.at(-1)!.count, lod.index!.count)
})

test('a model too simple to save enough gets no LOD', async () => {
	const g = new THREE.BoxGeometry(2, 2, 2)
	g.computeBoundingSphere()
	assert.equal(await buildLod(g), undefined)
})
