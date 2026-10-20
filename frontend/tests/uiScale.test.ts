// Run with: bun test tests/uiScale.test.ts
// Preferences › Interface size (#372): the stored scale is kept in range and the steps follow the offered sizes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampUiScale, stepUiScale, UI_SCALE_MAX, UI_SCALE_MIN, applyUiScale, toCss, uiZoom } from '../src/lib/ui/uiScale'

test('clampUiScale keeps a stored value in range', () => {
	assert.equal(clampUiScale(1.5), 1.5)
	assert.equal(clampUiScale(9), UI_SCALE_MAX)
	assert.equal(clampUiScale(0.2), UI_SCALE_MIN)
	assert.equal(clampUiScale('x'), 1)
	assert.equal(clampUiScale(0), 1)
	assert.equal(clampUiScale(Number.NaN), 1)
})

test('stepUiScale walks the offered sizes and stops at the ends', () => {
	assert.equal(stepUiScale(1, 1), 1.25)
	assert.equal(stepUiScale(1.25, -1), 1)
	assert.equal(stepUiScale(2, 1), 2)
	assert.equal(stepUiScale(1, -1), 1)
	assert.equal(stepUiScale(1.3, 1), 1.5)
	assert.equal(stepUiScale(1.3, -1), 1.25)
})

test('toCss divides window px by the applied zoom', () => {
	applyUiScale(1.5)
	assert.equal(uiZoom(), 1.5)
	assert.equal(toCss(150), 100)
	applyUiScale(1)
	assert.equal(toCss(150), 150)
})
