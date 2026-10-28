// Run with: bun test tests/displayTiles.test.ts
// The display picker's tiles fill the row (#389): the columns that fit at the smallest tile are kept
// and the tiles grow until the row ends at the grid's inner right edge, never past it. The picker's
// constants and its `.grid-wrap` padding are read from DisplayPicker.svelte, so a change to either
// that breaks the fill fails here.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gridCols, gridTile } from '../src/lib/ui/virtualGrid.ts'

const src = readFileSync(new URL('../src/components/DisplayPicker.svelte', import.meta.url), 'utf8')
const constant = (name: string) => {
	const m = new RegExp(`const ${name} = (\\d+)`).exec(src)
	assert.ok(m, `no ${name} in DisplayPicker.svelte`)
	return Number(m[1])
}
const TILE = constant('TILE')
const MAX_TILE = constant('MAX_TILE')
const GAP = constant('GAP')
const PAD = constant('PAD')

test('the picker computes its columns and tile with gridCols and gridTile from its constants', () => {
	assert.match(src, /gridCols\(width, TILE, GAP, PAD - GAP\)/)
	assert.match(src, /gridTile\(width, cols, GAP, PAD, TILE, MAX_TILE\)/)
})

test("the grid's padding is the PAD the tile math leaves free", () => {
	const wrap = /\.grid-wrap\s*\{([^}]*)\}/.exec(src)
	assert.ok(wrap, 'no .grid-wrap rule')
	const pad = /padding:\s*(\d+)px\s*;/.exec(wrap[1])
	assert.ok(pad, '.grid-wrap has no single padding in px')
	assert.equal(Number(pad[1]) * 2, PAD)
})

test('a row of tiles ends within a pixel a column of the inner right edge, at every width', () => {
	for (let width = PAD + TILE; width <= 1400; width++) {
		const cols = gridCols(width, TILE, GAP, PAD - GAP)
		const tile = gridTile(width, cols, GAP, PAD, TILE, MAX_TILE)
		assert.ok(tile >= TILE && tile <= MAX_TILE, `tile ${tile} at ${width}`)
		const row = PAD + cols * tile + (cols - 1) * GAP
		// Never past the edge; short of it only by the rounding down (under a pixel a column), or when the tile hit MAX_TILE.
		assert.ok(row <= width, `row ${row} past ${width}`)
		if (tile < MAX_TILE) assert.ok(width - row < cols, `row ${row} short of ${width} by ${width - row} with ${cols} columns`)
	}
})

test('the smallest width that fits two columns gives two, and the tiles start at the smallest size', () => {
	const two = PAD + 2 * TILE + GAP
	assert.equal(gridCols(two, TILE, GAP, PAD - GAP), 2)
	assert.equal(gridTile(two, 2, GAP, PAD, TILE, MAX_TILE), TILE)
	assert.equal(gridCols(two - 1, TILE, GAP, PAD - GAP), 1)
})
