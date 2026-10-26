// Run with: bun test tests/farLayers.test.ts
// A far WMO's LOD merges its groups by class (#691): the plan's classes, and the worker's merge.
import './runes.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MeshGroup } from '../src/lib/wow/api.ts'
import { farMerge, type LodIndex } from '../src/lib/models/lod.ts'
import { farPlan } from '../src/lib/models/farLayers.ts'

const group = (g: Partial<MeshGroup>): MeshGroup => ({ start: 0, count: 3, texture: 'a.blp', blend: 0, twoSided: false, unlit: false, ...g })

test('a far plan puts groups that draw alike in one class, and keeps a moving one apart', () => {
	const plan = farPlan(
		[
			group({ texture: 'wall.blp' }),
			group({ texture: 'roof.blp' }),
			group({ texture: 'fence.blp', blend: 1 }),
			group({ texture: 'glow.blp', blend: 4 }),
			group({ texture: 'add.blp', blend: 3 }),
			group({ texture: 'water.blp', uv: { t: { t: [0], v: [0], loop: 0 } } }),
			group({ texture: 'hall.blp', interior: true }),
			group({ texture: '' }),
		],
		false,
		true,
	)
	const c = [...plan.classes]
	assert.equal(c[0], c[1], 'two opaque lit textures share a class')
	assert.notEqual(c[2], c[0], 'a cut-out is a class of its own')
	assert.equal(c[3], c[4], 'both additive blends are one class')
	assert.equal(c[5], -1, 'a moving texture keeps its own material')
	assert.notEqual(c[6], c[0], 'an interior is unlit')
	assert.equal(c[7], c[0], 'an untextured group draws with the opaque lit class')
	assert.equal(plan.materials.length, 4)
	assert.ok(plan.textures[2].cut && !plan.textures[0].cut)
	// The tints wowMaterial gives these groups' materials: a dim interior without baked colours, a grey untextured group.
	assert.equal(plan.textures[6].tint, 0x707070)
	assert.equal(plan.textures[7].tint, 0x9a9a9a)
	assert.equal(plan.textures[0].tint, 0xffffff)
	// Shared: another WMO's plan draws its like groups with the same materials.
	const again = farPlan([group({ texture: 'other.blp' })], false, true)
	assert.equal(again.materials[0], plan.materials[c[0]])
})

test('a far merge draws a class in one group, copying each vertex its groups share', () => {
	// Groups 0 and 2 are one class, group 1 is kept apart; vertex 2 is in all three.
	const lod: LodIndex = {
		index: new Uint16Array([0, 1, 2, 2, 3, 4, 2, 5, 6]),
		groups: [
			{ start: 0, count: 3, materialIndex: 0 },
			{ start: 3, count: 3, materialIndex: 1 },
			{ start: 6, count: 3, materialIndex: 2 },
		],
	}
	const far = farMerge(lod, new Int32Array([0, -1, 0]), 3, 7)
	assert.ok(far)
	assert.deepEqual(far.groups, [
		{ start: 0, count: 6, materialIndex: 3 },
		{ start: 6, count: 3, materialIndex: 1 },
	])
	// Every triangle keeps its vertices, through `src`, and its group's order.
	const tris = [...far.index].map((v) => far.src[v])
	assert.deepEqual(tris, [0, 1, 2, 2, 5, 6, 2, 3, 4])
	// Vertex 2 is copied for each group, and each group's vertices are one run.
	assert.equal(far.src.length, 9)
	assert.deepEqual([...far.runs], [0, 3, 0, 3, 3, 2, 6, 3, 1])
})

test('a far merge is skipped when every group is a class of its own', () => {
	const lod: LodIndex = {
		index: new Uint16Array([0, 1, 2, 2, 3, 4]),
		groups: [
			{ start: 0, count: 3, materialIndex: 0 },
			{ start: 3, count: 3, materialIndex: 1 },
		],
	}
	assert.equal(farMerge(lod, new Int32Array([0, 1]), 2, 5), undefined)
	assert.equal(farMerge(lod, new Int32Array([-1, -1]), 2, 5), undefined)
})
