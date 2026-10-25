// Run with: bun test tests/sculptShapes.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { angledHeight, creviceDig, creviceRidge, mountainHeight, ridgeScale, terraceHeight, terraceLevel, trenchWidth } from '../src/lib/tools/sculptShapes.ts'

const near = (a: number, b: number, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

test('the crevice digs inside the trench and piles up outside it, never both', () => {
	const falloff = 0.6
	const c = trenchWidth(falloff)
	near(c, 0.4)
	near(creviceDig(0, falloff), 1)
	near(creviceDig(c, falloff), 0)
	near(creviceRidge(c, falloff), 0)
	near(creviceRidge(1, falloff), 0)
	assert.ok(creviceRidge((c + 1) / 2, falloff) > 0.99)
	for (let t = 0; t <= 1.2; t += 0.01) {
		const dig = creviceDig(t, falloff)
		const ridge = creviceRidge(t, falloff)
		assert.ok(dig >= 0 && ridge >= 0)
		assert.ok(dig === 0 || ridge === 0, `both at ${t}`)
		if (t > 1) assert.equal(dig + ridge, 0)
	}
})

test('the trench always leaves room for ridges, and ridges for a trench', () => {
	near(trenchWidth(0), 0.9)
	near(trenchWidth(1), 0.1)
	assert.ok(creviceRidge(0.95, 0) > 0)
	assert.ok(creviceDig(0.05, 1) > 0)
})

test('the ridge scale conserves the dug volume on a grid, capped for thin bands', () => {
	// Sum both profiles over a 2D grid of a brush of radius 20 cells.
	const R = 20
	let dig = 0,
		ridge = 0
	for (let z = -R; z <= R; z++) {
		for (let x = -R; x <= R; x++) {
			const t = Math.sqrt(x * x + z * z) / R
			dig += creviceDig(t, 0.6)
			ridge += creviceRidge(t, 0.6)
		}
	}
	const k = ridgeScale(dig, ridge)
	near(ridge * k, dig, 1e-6)
	assert.equal(ridgeScale(100, 1), 4)
	assert.equal(ridgeScale(100, 0), 0)
})

test('a mountain is a peak that ridges carve, and smooth with no ridges', () => {
	near(mountainHeight(0, 0.2, 0), 1)
	near(mountainHeight(0, 0.2, 1), 0.2)
	near(mountainHeight(0, 0.2, 0.5), 0.6)
	// A slope all the way: no plateau, so it tops out in a point.
	assert.ok(mountainHeight(0.2, 1, 0) < mountainHeight(0, 1, 0))
	assert.ok(mountainHeight(0.5, 1, 0) < mountainHeight(0.2, 1, 0))
	assert.equal(mountainHeight(1, 1, 1), 0)
})

test('the angled plane passes through its origin and rises toward its direction', () => {
	near(angledHeight(5, 7, 5, 10, 7, 45, 90), 10)
	near(angledHeight(15, 0, 5, 10, 0, 45, 0), 20)
	near(angledHeight(5, 10, 5, 10, 0, 45, 90), 20)
	near(angledHeight(5, 10, 5, 10, 0, 45, 0), 10)
	near(angledHeight(15, 0, 5, 10, 0, -45, 0), 0)
})

test('the terrace steps the ground onto levels, sharp or smooth', () => {
	near(terraceLevel(13, 6, 0), 12)
	near(terraceLevel(-1, 6, 0), -6)
	near(terraceLevel(13, 6, 2), 8)
	// Hard cliffs: everything on a step falls to its level.
	near(terraceHeight(13, 6, 0, 1), 12)
	near(terraceHeight(17.9, 6, 0, 1), 12)
	// Half sharp: flat over the first half of the step, then rising to the next level.
	near(terraceHeight(14, 6, 0, 0.5), 12)
	near(terraceHeight(16.5, 6, 0, 0.5), 15)
	assert.ok(terraceHeight(17.5, 6, 0, 0.5) > 17)
	// Smooth stairs never move a level itself and keep the order of heights.
	near(terraceHeight(12, 6, 0, 0), 12)
	let prev = -Infinity
	for (let h = 0; h < 24; h += 0.25) {
		const v = terraceHeight(h, 6, 0, 0.3)
		assert.ok(v >= prev - 1e-9, `falls at ${h}`)
		prev = v
	}
	near(terraceHeight(7, 0, 0, 1), 7)
})
