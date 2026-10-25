// Run with: bun test tests/helpers.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HELPERS, helperGeometry, isHelper } from '../src/lib/models/helpers.ts'

test('each helper is a shape of its size standing on its origin, and only helper types are helpers', () => {
	for (const h of HELPERS) {
		const g = helperGeometry(h.type)
		assert.ok(g, h.type)
		g!.computeBoundingBox()
		assert.ok(Math.abs(g!.boundingBox!.min.y) < 1e-6, `${h.type} stands on its origin`)
	}
	const human = helperGeometry('helper:human')!
	human.computeBoundingBox()
	assert.ok(Math.abs(human.boundingBox!.max.y - 2) < 1e-6, 'the human post is two yards tall')
	const cube = helperGeometry('helper:cube:4')!
	cube.computeBoundingBox()
	assert.ok(Math.abs(cube.boundingBox!.max.x - 2) < 1e-6)
	assert.equal(isHelper('m2:World\Generic\Tree.m2'), false)
	assert.equal(helperGeometry('m2:x.m2'), null)
})
