// Run with: node --import ./tests/register.mjs --test tests/graphicsPresets.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GRAPHICS_PRESETS, applyPreset, presetOf, type GraphicsValues } from '../src/lib/state/graphicsPresets.ts'

const base = (): GraphicsValues => ({ ...GRAPHICS_PRESETS[2].values })

test('each preset is found again after it is applied, and every preset differs', () => {
	const p = base()
	for (const g of GRAPHICS_PRESETS) {
		applyPreset(p, g.name)
		assert.equal(presetOf(p), g.name)
	}
	const shapes = new Set(GRAPHICS_PRESETS.map((g) => JSON.stringify(g.values)))
	assert.equal(shapes.size, GRAPHICS_PRESETS.length)
})

test('one changed setting makes it Custom', () => {
	const p = base()
	applyPreset(p, 'Low')
	p.clouds = true
	assert.equal(presetOf(p), null)
})

test('every preset sets the same keys', () => {
	const keys = JSON.stringify(Object.keys(GRAPHICS_PRESETS[0].values).sort())
	for (const g of GRAPHICS_PRESETS) assert.equal(JSON.stringify(Object.keys(g.values).sort()), keys, g.name)
})
