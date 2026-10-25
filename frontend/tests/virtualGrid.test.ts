import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridCols, gridWindow, rowTop } from '../src/lib/ui/virtualGrid.ts'

test('columns fit the width with one gap of inset, and never drop below one', () => {
	// 6 + 4 * (96 + 6) = 414: four tiles fit exactly, one pixel less fits three.
	assert.equal(gridCols(414, 96, 6), 4)
	assert.equal(gridCols(413, 96, 6), 3)
	assert.equal(gridCols(0, 96, 6), 1)
	assert.equal(gridCols(50, 96, 6), 1)
	// A wider inset (the display picker's 12 px padding less a gap) takes its room first.
	assert.equal(gridCols(414, 96, 6, 6), 4)
	assert.equal(gridCols(414, 96, 6, 7), 3)
})

test('the window covers the rows in view and one more on each side', () => {
	// 100 items, 4 a row: 25 rows of 124 px. A view 400 px tall at 1000 px shows rows 8 to 11.
	const w = gridWindow(100, 4, 124, 1000, 400)
	assert.equal(w.rows, 25)
	assert.equal(w.first, 7)
	assert.equal(w.last, 13)
	assert.equal(w.start, 28)
	assert.equal(w.end, 52)
})

test('at the top the window starts at row 0, and at the end it stops at the last item', () => {
	const top = gridWindow(10, 4, 100, 0, 150)
	assert.deepEqual(top, { rows: 3, first: 0, last: 3, start: 0, end: 10 })
	// The last row holds two of four: end is the item count, not a full row past it.
	const end = gridWindow(10, 4, 100, 250, 150)
	assert.equal(end.last, 3)
	assert.equal(end.end, 10)
})

test('an empty list, or a scroll past a list that shrank, renders nothing', () => {
	assert.deepEqual(gridWindow(0, 4, 100, 0, 500), { rows: 0, first: 0, last: 0, start: 0, end: 0 })
	const past = gridWindow(8, 4, 100, 5000, 500)
	assert.equal(past.start, 8)
	assert.equal(past.end, 8)
	assert.equal(past.last, past.first)
})

test('an unmeasured grid (no height yet) still renders the first rows', () => {
	const w = gridWindow(100, 4, 100, 0, 0)
	assert.equal(w.first, 0)
	assert.equal(w.last, 1)
})

test('a row top is the row of the index times the row height', () => {
	assert.equal(rowTop(0, 4, 124), 0)
	assert.equal(rowTop(3, 4, 124), 0)
	assert.equal(rowTop(4, 4, 124), 124)
	assert.equal(rowTop(41, 4, 124), 1240)
})
