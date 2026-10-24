// Run with: bun test tests/cubePalette.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KINDS, SHAPES, kindId } from '../src/lib/cubes/world.ts'
import { CUBE_ITEMS, cubeItem, searchCubes, thumbFaces, themeName, withRecent } from '../src/lib/cubes/palette.ts'

test('the palette: every shape, every kind but empty, the liquids apart from the materials', () => {
	assert.equal(CUBE_ITEMS.filter((it) => it.sets === 'shape').length, SHAPES.length)
	assert.equal(CUBE_ITEMS.filter((it) => it.sets === 'kind').length, KINDS.length - 1)
	assert.deepEqual(
		CUBE_ITEMS.filter((it) => it.category === 'Liquids').map((it) => it.id),
		[kindId('water'), kindId('sea'), kindId('lava')],
	)
	assert.deepEqual(
		CUBE_ITEMS.filter((it) => it.category === 'Materials').map((it) => it.id),
		[kindId('dirt'), kindId('stone'), kindId('metal'), kindId('wood')],
	)
	assert.equal(cubeItem('kind:0'), undefined)
	assert.equal(cubeItem('shape:2')?.name, 'Slope')
	assert.equal(new Set(CUBE_ITEMS.map((it) => it.key)).size, CUBE_ITEMS.length)
})

test('the search: by name and by the words an author types, within a category, with counts', () => {
	assert.equal(searchCubes('', '').items.length, CUBE_ITEMS.length)
	assert.deepEqual(
		searchCubes('ramp', '').items.map((it) => it.key),
		['shape:2'],
	)
	assert.deepEqual(
		searchCubes('magma', '').items.map((it) => it.key),
		[`kind:${kindId('lava')}`],
	)
	const liquid = searchCubes('liq', '')
	assert.equal(liquid.items.length, 3)
	assert.equal(liquid.counts.Liquids, 3)
	assert.equal(liquid.counts.Shapes, 0)
	assert.equal(searchCubes('liq', 'Materials').items.length, 0)
	assert.equal(searchCubes('', 'Shapes').items.length, SHAPES.length)
	assert.equal(searchCubes('', 'Objects').items.length, 0)
	assert.equal(searchCubes('zzz', '').items.length, 0)
})

test('the recent picks: newest first, no repeats, held to the most', () => {
	assert.deepEqual(withRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c'])
	assert.deepEqual(withRecent(['a', 'b'], 'c', 2), ['c', 'a'])
})

test('the pictures: a full cube shows three faces, the top lit most; a liquid is see-through', () => {
	const stone = thumbFaces(kindId('stone'), 0, 0, 10, 100)
	assert.equal(stone.length, 3)
	for (const f of stone) for (const [x, y] of f.points) assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100)
	const level = (fill: string) => Number(fill.slice(5).split(',')[0])
	// The top face is the one whose middle lies highest on the picture.
	const middle = (f: { points: [number, number][] }) => f.points.reduce((n, p) => n + p[1], 0) / f.points.length
	const top = stone.reduce((a, b) => (middle(a) <= middle(b) ? a : b))
	assert.ok(stone.every((f) => level(f.fill) <= level(top.fill)))
	assert.ok(thumbFaces(kindId('water'), 0, 0, 10, 100)[0].fill.endsWith(',0.6)'))
	// Every shape draws something in every rotation.
	for (let s = 0; s < SHAPES.length; s++) for (let r = 0; r < 8; r++) assert.ok(thumbFaces(kindId('wood'), s, r, 10, 64).length > 0)
	assert.equal(themeName(10), 'ground')
	assert.equal(themeName(16), 'stone')
})
