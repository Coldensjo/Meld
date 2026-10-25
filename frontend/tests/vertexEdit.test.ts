// Run with: bun test tests/vertexEdit.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VertexSelection, flattenVertices, moveVertices, orientVertices } from '../src/lib/tools/vertexEdit.ts'

const near = (a: number, b: number, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

/** A 5x5-vertex map with every vertex at height 3. */
function map() {
	const V = 5
	return { V, heights: new Float32Array(V * V).fill(3), sel: new VertexSelection(V) }
}

test('a vertex is selected once, and removing it keeps the rest', () => {
	const { sel } = map()
	sel.add(6)
	sel.add(6)
	sel.add(7)
	sel.add(12)
	assert.equal(sel.size, 3)
	sel.remove(7)
	assert.deepEqual(
		[...sel.ids].sort((a, b) => a - b),
		[6, 12],
	)
	assert.equal(sel.has(7), false)
	sel.clear()
	assert.equal(sel.size, 0)
	assert.equal(sel.has(6), false)
})

test('the rect covers the selected vertices', () => {
	const { sel } = map()
	sel.add(6) // (1, 1)
	sel.add(18) // (3, 3)
	sel.add(8) // (3, 1)
	assert.deepEqual(sel.rect(), { x0: 1, z0: 1, x1: 3, z1: 3 })
	sel.clear()
	assert.equal(sel.rect(), null)
})

test('move and flatten change only the selected vertices', () => {
	const { heights, sel } = map()
	sel.add(6)
	sel.add(7)
	moveVertices(heights, sel, 2)
	assert.equal(heights[6], 5)
	assert.equal(heights[7], 5)
	assert.equal(heights[8], 3)
	flattenVertices(heights, sel, -1)
	assert.equal(heights[6], -1)
	assert.equal(heights[0], 3)
})

test('the centre is the mean world position', () => {
	const { heights, sel } = map()
	heights[6] = 1
	heights[8] = 5
	sel.add(6) // (1, 1)
	sel.add(8) // (3, 1)
	const c = sel.center(heights, 2, { x: 0, y: 0, z: 0 })
	assert.deepEqual(c, { x: 4, y: 3, z: 2 })
})

test('orienting lays the vertices on a plane through the reference', () => {
	const { heights, sel } = map()
	for (const i of [6, 7, 8, 11, 12, 13]) sel.add(i)
	const ref = { x: 4, y: 10, z: 2 }
	// 45 degrees rising toward +x: one unit up per unit along x.
	orientVertices(heights, sel, 2, ref, 45, 0)
	near(heights[6], 8) // x = 2
	near(heights[7], 10) // x = 4
	near(heights[8], 12) // x = 6
	near(heights[11], 8)
	// Toward +z instead: x no longer matters.
	orientVertices(heights, sel, 2, ref, 45, 90)
	near(heights[6], 10) // z = 2
	near(heights[11], 12) // z = 4
	assert.equal(heights[0], 3)
})

test('the slope angle is limited to 89 degrees', () => {
	const { heights, sel } = map()
	sel.add(7)
	orientVertices(heights, sel, 2, { x: 0, y: 0, z: 0 }, 90, 0)
	assert.ok(Number.isFinite(heights[7]))
})

test('the selection version moves only when the selection changes', () => {
	const { sel } = map()
	const v0 = sel.version
	sel.add(6)
	const v1 = sel.version
	assert.notEqual(v1, v0)
	sel.add(6)
	assert.equal(sel.version, v1)
	sel.remove(9)
	assert.equal(sel.version, v1)
	sel.remove(6)
	assert.notEqual(sel.version, v1)
	const v2 = sel.version
	sel.add(7)
	sel.clear()
	assert.ok(sel.version > v2)
})
