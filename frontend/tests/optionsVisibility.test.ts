// Run with: bun test tests/optionsVisibility.test.ts
// Which of the options bar's controls show for the tool and its modes (lib/ui/optionsVisibility.ts, #584).
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { optionsVisibility, type OptionsState } from '../src/lib/ui/optionsVisibility.ts'

const base: OptionsState = {
	tool: 'sculpt',
	paintMode: 'texture',
	placeScatter: false,
	waterMode: 'paint',
	sculptMode: 'raise',
	doodadMode: 'models',
	sculptPaint: 'off',
	paintSpray: false,
	maskSelect: { by: 'brush' },
}
const vis = (s: Partial<OptionsState>) => optionsVisibility({ ...base, ...s })

test('the brush tools use the brush; Place only while scattering', () => {
	for (const tool of ['sculpt', 'paint', 'road', 'water', 'clear', 'doodad', 'mapdata', 'stamp'] as const) assert.equal(vis({ tool }).usesBrush, true, tool)
	assert.equal(vis({ tool: 'place' }).usesBrush, false)
	assert.equal(vis({ tool: 'place', placeScatter: true }).usesBrush, true)
	assert.equal(vis({ tool: 'select' }).usesBrush, false)
})

test('the paint mask uses the brush only when it is picked by the brush', () => {
	assert.equal(vis({ tool: 'paint', paintMode: 'mask' }).usesBrush, true)
	const byHeight = vis({ tool: 'paint', paintMode: 'mask', maskSelect: { by: 'height' } as OptionsState['maskSelect'] })
	assert.equal(byHeight.usesBrush, false)
	assert.equal(byHeight.falloffOnBar, false)
	assert.equal(byHeight.panelLabel, 'Mask')
})

test('the tools with modes put the size after them, on narrower sliders', () => {
	for (const tool of ['sculpt', 'paint', 'water', 'doodad'] as const) {
		assert.equal(vis({ tool }).sizeAfterModes, true, tool)
		assert.equal(vis({ tool }).sliderWidth, 70, tool)
	}
	assert.equal(vis({ tool: 'road' }).sizeAfterModes, false)
	assert.equal(vis({ tool: 'road' }).sliderWidth, 90)
	assert.equal(vis({ tool: 'road' }).hasPanel, false)
})

test('Vertex mode has no falloff and no panel; Hole mode paints nothing', () => {
	const vertex = vis({ sculptMode: 'vertex' })
	assert.equal(vertex.vertexMode, true)
	assert.equal(vertex.falloffOnBar, false)
	assert.equal(vertex.hasPanel, false)
	const hole = vis({ sculptMode: 'hole', sculptPaint: 'texture' })
	assert.equal(hole.holeMode, true)
	assert.equal(hole.sculptPainting, false)
	assert.ok(!hole.panelTitle.includes('painting while sculpting'))
	assert.equal(vis({ sculptPaint: 'texture' }).panelLabel, 'Brush · Paint')
	assert.ok(vis({ sculptMode: 'flatten' }).panelTitle.includes("Flatten's target"))
})

test('painting water and the spawn brush take only the size', () => {
	const water = vis({ tool: 'water' })
	assert.equal(water.paintingWater, true)
	assert.equal(water.falloffOnBar, false)
	assert.equal(water.panelLabel, 'Water')
	assert.equal(vis({ tool: 'water', waterMode: 'shore' as OptionsState['waterMode'] }).falloffOnBar, true)
	const spawns = vis({ tool: 'doodad', doodadMode: 'creatures' })
	assert.equal(spawns.spawnBrushing, true)
	assert.equal(spawns.falloffOnBar, false)
	assert.equal(spawns.panelLabel, 'Spawns')
	assert.equal(vis({ tool: 'doodad' }).panelLabel, 'Placement')
})

test('spraying texture paint names the panel', () => {
	assert.equal(vis({ tool: 'paint', paintSpray: true }).panelLabel, 'Brush · Spray')
	assert.equal(vis({ tool: 'paint', paintSpray: true }).spraying, true)
	assert.equal(vis({ tool: 'paint', paintMode: 'swap', paintSpray: true }).spraying, false)
	assert.equal(vis({ tool: 'mapdata' }).mapData, true)
})
