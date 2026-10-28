// Run with: bun test tests/dirtyRect.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DirtyRegion, growRect, uploadRect } from '../src/lib/terrain/dirtyRect.ts'

test('growRect covers both rects and returns the first', () => {
	const r = { x0: 2, z0: 3, x1: 4, z1: 5 }
	assert.equal(growRect(r, { x0: 0, z0: 4, x1: 3, z1: 9 }), r)
	assert.deepEqual(r, { x0: 0, z0: 3, x1: 4, z1: 9 })
})

test("a first mark copies its rect, so a later change to the caller's rect does not leak in", () => {
	const d = new DirtyRegion()
	assert.equal(d.dirty, false)
	const a = { x0: 1, z0: 1, x1: 2, z1: 2 }
	d.mark(a)
	a.x1 = 50
	assert.equal(d.dirty, true)
	assert.deepEqual(d.rect, { x0: 1, z0: 1, x1: 2, z1: 2 })
})

test('a second mark grows the rect to the union of both', () => {
	const d = new DirtyRegion()
	d.mark({ x0: 1, z0: 1, x1: 2, z1: 2 })
	d.mark({ x0: 5, z0: 0, x1: 6, z1: 1 })
	assert.deepEqual(d.rect, { x0: 1, z0: 0, x1: 6, z1: 2 })
})

test('a mark without a rect means the whole texture, and stays whole after a rect', () => {
	const d = new DirtyRegion()
	d.mark()
	assert.equal(d.dirty, true)
	assert.equal(d.rect, null)
	d.mark({ x0: 1, z0: 1, x1: 2, z1: 2 })
	assert.equal(d.rect, null)
})

test('a whole mark after a rect makes it whole', () => {
	const d = new DirtyRegion()
	d.mark({ x0: 1, z0: 1, x1: 2, z1: 2 })
	d.mark(null)
	assert.equal(d.dirty, true)
	assert.equal(d.rect, null)
})

test('clear resets, and the next rect starts fresh rather than growing the old one', () => {
	const d = new DirtyRegion()
	d.mark({ x0: 0, z0: 0, x1: 9, z1: 9 })
	d.clear()
	assert.equal(d.dirty, false)
	assert.equal(d.rect, null)
	d.mark({ x0: 4, z0: 4, x1: 5, z1: 5 })
	assert.deepEqual(d.rect, { x0: 4, z0: 4, x1: 5, z1: 5 })
})

test('uploadRect clips to the texture and returns null for a rect outside it', () => {
	assert.deepEqual(uploadRect({ x0: -3, z0: 10, x1: 2, z1: 40 }, 16), { x0: 0, z0: 10, x1: 2, z1: 15 })
	assert.equal(uploadRect({ x0: 16, z0: 0, x1: 20, z1: 4 }, 16), null)
	assert.equal(uploadRect({ x0: -5, z0: 0, x1: -1, z1: 4 }, 16), null)
	assert.equal(uploadRect({ x0: 3, z0: 3, x1: 2, z1: 4 }, 16), null, 'an empty rect')
})

test('uploadRect returns whole past half the texture, and the rect at exactly half', () => {
	// 16 x 8 of a 16 x 16 texture is exactly half: still a rect.
	assert.deepEqual(uploadRect({ x0: 0, z0: 0, x1: 15, z1: 7 }, 16), { x0: 0, z0: 0, x1: 15, z1: 7 })
	// One more row is past half.
	assert.equal(uploadRect({ x0: 0, z0: 0, x1: 15, z1: 8 }, 16), 'whole')
	// The clipped size decides, not the asked one.
	assert.deepEqual(uploadRect({ x0: -100, z0: 0, x1: 3, z1: 3 }, 16), { x0: 0, z0: 0, x1: 3, z1: 3 })
})
