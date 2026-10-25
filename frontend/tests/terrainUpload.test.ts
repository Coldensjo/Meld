// Run with: bun test tests/terrainUpload.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DirtyRegion, growRect, uploadRect } from '../src/lib/terrain/dirtyRect.ts'

test('a mark keeps its rect, and marks in one frame merge', () => {
	const d = new DirtyRegion()
	assert.equal(d.dirty, false)
	d.mark({ x0: 10, z0: 10, x1: 12, z1: 12 })
	assert.equal(d.dirty, true)
	assert.deepEqual(d.rect, { x0: 10, z0: 10, x1: 12, z1: 12 })
	d.mark({ x0: 40, z0: 5, x1: 41, z1: 6 })
	assert.deepEqual(d.rect, { x0: 10, z0: 5, x1: 41, z1: 12 })
	d.clear()
	assert.equal(d.dirty, false)
	assert.equal(d.rect, null)
})

test('a mark without a rect means the whole texture, before or after a rect', () => {
	const d = new DirtyRegion()
	d.mark({ x0: 1, z0: 1, x1: 2, z1: 2 })
	d.mark()
	assert.equal(d.dirty, true)
	assert.equal(d.rect, null)
	d.mark({ x0: 1, z0: 1, x1: 2, z1: 2 })
	assert.equal(d.rect, null, 'a rect after the whole does not shrink it')
	const e = new DirtyRegion()
	e.mark(null)
	assert.equal(e.dirty, true)
	assert.equal(e.rect, null)
})

test('the marked rect is a copy, so the caller may reuse its own', () => {
	const d = new DirtyRegion()
	const r = { x0: 1, z0: 1, x1: 2, z1: 2 }
	d.mark(r)
	r.x1 = 50
	assert.deepEqual(d.rect, { x0: 1, z0: 1, x1: 2, z1: 2 })
})

test('an upload rect is clipped to the texture', () => {
	assert.deepEqual(uploadRect({ x0: -5, z0: 61, x1: 4, z1: 70 }, 64), { x0: 0, z0: 61, x1: 4, z1: 63 })
	assert.deepEqual(uploadRect({ x0: 10, z0: 20, x1: 30, z1: 25 }, 256), { x0: 10, z0: 20, x1: 30, z1: 25 })
	assert.equal(uploadRect({ x0: 70, z0: 0, x1: 80, z1: 5 }, 64), null, 'wholly outside uploads nothing')
})

test('a rect over half the texture or more uploads the whole texture', () => {
	assert.equal(uploadRect({ x0: 0, z0: 0, x1: 63, z1: 40 }, 64), 'whole')
	assert.deepEqual(uploadRect({ x0: 0, z0: 0, x1: 63, z1: 30 }, 64), { x0: 0, z0: 0, x1: 63, z1: 30 })
})

test('growRect covers both rects', () => {
	assert.deepEqual(growRect({ x0: 5, z0: 5, x1: 6, z1: 6 }, { x0: 1, z0: 7, x1: 2, z1: 9 }), { x0: 1, z0: 5, x1: 6, z1: 9 })
})
