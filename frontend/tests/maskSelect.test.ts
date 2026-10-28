// Run with: bun test tests/maskSelect.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { combineMask, featherMask, growMask, shrinkMask, wandSelect } from '../src/lib/terrain/maskSelect.ts'

const count = (m: Uint8Array, v = 255) => m.reduce((n, x) => n + (x === v ? 1 : 0), 0)

test('the contiguous wand takes only the region joined to the seed', () => {
	// Two 2x2 squares of "inside" texels in an 8x8 map, apart from each other.
	const res = 8
	const inside = (p: number) => {
		const x = p % res
		const z = Math.floor(p / res)
		return (x < 2 && z < 2) || (x >= 5 && x < 7 && z >= 5 && z < 7)
	}
	const out = new Uint8Array(res * res)
	assert.equal(wandSelect(res, inside, 0, true, out), 4)
	assert.equal(count(out), 4)
	assert.equal(out[1 * res + 1], 255)
	assert.equal(out[5 * res + 5], 0)
	// No texel is left marked as visited-outside.
	assert.equal(count(out, 0), res * res - 4)
	// Global: both squares.
	assert.equal(wandSelect(res, inside, 0, false, out), 8)
	// A seed outside takes nothing.
	assert.equal(wandSelect(res, inside, 3, true, out), 0)
	assert.equal(count(out), 0)
})

test('the wand does not wrap from one row into the next', () => {
	const res = 4
	// The last texel of row 0 and the first of row 1 are neighbours in memory only.
	const inside = (p: number) => p === 3 || p === 4
	const out = new Uint8Array(res * res)
	assert.equal(wandSelect(res, inside, 3, true, out), 1)
})

test('combining replaces, adds or subtracts', () => {
	const mask = new Uint8Array([0, 100, 255, 255])
	const sel = new Uint8Array([255, 50, 0, 255])
	const a = mask.slice()
	combineMask(a, sel, 'replace')
	assert.deepEqual([...a], [255, 50, 0, 255])
	const b = mask.slice()
	combineMask(b, sel, 'add')
	assert.deepEqual([...b], [255, 100, 255, 255])
	const c = mask.slice()
	combineMask(c, sel, 'subtract')
	assert.deepEqual([...c], [0, 100, 255, 0])
})

test('grow widens and shrink narrows a square by the texels asked', () => {
	const res = 32
	const m = new Uint8Array(res * res)
	for (let z = 10; z < 20; z++) for (let x = 10; x < 20; x++) m[z * res + x] = 255
	const g = m.slice()
	growMask(g, res, 2)
	// 10x10 grows to 14x14 straight out; the corners are cut by the chamfer.
	assert.equal(g[15 * res + 8], 255)
	assert.equal(g[15 * res + 7], 0)
	assert.equal(g[8 * res + 15], 255)
	assert.equal(count(g), 14 * 14 - 4 * 3)
	const s = m.slice()
	shrinkMask(s, res, 2)
	assert.equal(s[15 * res + 12], 255)
	assert.equal(s[15 * res + 11], 0)
	assert.equal(count(s), 6 * 6)
	// Shrinking what grew by the same amount gives the square back, but for its rounded corners.
	shrinkMask(g, res, 2)
	assert.equal(g[15 * res + 10], 255)
	assert.equal(g[15 * res + 9], 0)
})

test('feather softens an edge and keeps the middle and far texels', () => {
	const res = 64
	const m = new Uint8Array(res * res)
	for (let z = 0; z < res; z++) for (let x = 0; x < 32; x++) m[z * res + x] = 255
	featherMask(m, res, 6)
	const row = 20 * res
	assert.equal(m[row + 5], 255)
	assert.equal(m[row + 60], 0)
	// The edge ramps down across x = 32.
	assert.ok(m[row + 29] > m[row + 32] && m[row + 32] > m[row + 35])
	assert.ok(Math.abs(m[row + 31] + m[row + 32] - 255) <= 2)
	// A blur along z changes nothing in a mask that is the same down every column.
	assert.equal(m[0 * res + 30], m[63 * res + 30])
})
