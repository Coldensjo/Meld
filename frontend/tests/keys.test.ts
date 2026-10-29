// Run with: bun test tests/keys.test.ts
// The window's key rules (lib/ui/keys.ts, #584): which keys a form field keeps, where the rest go
// with a window open, and the day cycle's speed steps.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { CYCLE_MINUTES, controlKeepsKey, formField, keyRoute, stepCycle, type KeyGate, type KeyTarget } from '../src/lib/ui/keys.ts'

const press = (key: string, target: KeyTarget, mods: { ctrl?: boolean; alt?: boolean; meta?: boolean } = {}) => ({ key, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, metaKey: !!mods.meta, target })
const slider: KeyTarget = { tagName: 'INPUT', type: 'range' }
const checkbox: KeyTarget = { tagName: 'INPUT', type: 'checkbox' }
const select: KeyTarget = { tagName: 'SELECT' }

test('text fields keep every key; sliders, checkboxes and selects are controls', () => {
	assert.equal(formField({ tagName: 'TEXTAREA' }), 'text')
	assert.equal(formField({ tagName: 'DIV', isContentEditable: true }), 'text')
	assert.equal(formField({ tagName: 'INPUT', type: 'text' }), 'text')
	assert.equal(formField({ tagName: 'INPUT', type: 'number' }), 'text')
	assert.equal(formField(slider), 'control')
	assert.equal(formField(checkbox), 'control')
	assert.equal(formField(select), 'control')
	assert.equal(formField({ tagName: 'CANVAS' }), null)
	assert.equal(formField(null), null)
	assert.equal(formField({}), null)
})

test('Ctrl+Z and Ctrl+Y reach the map from a control (#127), other chords stay', () => {
	assert.equal(controlKeepsKey(press('z', slider, { ctrl: true })), false)
	assert.equal(controlKeepsKey(press('Y', select, { ctrl: true })), false)
	assert.equal(controlKeepsKey(press('z', slider, { meta: true })), false)
	assert.equal(controlKeepsKey(press('s', slider, { ctrl: true })), true)
	assert.equal(controlKeepsKey(press('1', checkbox, { alt: true })), true)
})

test('Delete and the tool letters reach the map from a control (#345); its own keys stay', () => {
	assert.equal(controlKeepsKey(press('Delete', checkbox)), false)
	assert.equal(controlKeepsKey(press('Backspace', select)), false)
	assert.equal(controlKeepsKey(press('b', checkbox)), false)
	assert.equal(controlKeepsKey(press('Escape', slider)), false)
	// A select keeps everything else, letters too (they pick its options).
	assert.equal(controlKeepsKey(press('b', select)), true)
	assert.equal(controlKeepsKey(press('Escape', select)), true)
	assert.equal(controlKeepsKey(press('Enter', checkbox)), true)
	assert.equal(controlKeepsKey(press(' ', checkbox)), true)
	assert.equal(controlKeepsKey(press('Tab', slider)), true)
	// Arrows, Home, End and the page keys move a slider or radio, not a checkbox.
	for (const k of ['ArrowLeft', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown']) {
		assert.equal(controlKeepsKey(press(k, slider)), true, k)
		assert.equal(controlKeepsKey(press(k, { tagName: 'INPUT', type: 'radio' })), true, k)
		assert.equal(controlKeepsKey(press(k, checkbox)), false, k)
	}
})

const open: KeyGate = { blocked: false, brushEditor: false, modelPreview: false, inspector: false, databaseEditor: false, spawnEditor: false }
const route = (key: string, gate: Partial<KeyGate>, defaultPrevented = false) => keyRoute({ key, defaultPrevented }, { ...open, ...gate })

test('a key goes to the map with nothing open over it', () => {
	assert.equal(route('b', {}), 'map')
	assert.equal(route('Escape', {}), 'map')
})

test('a dialog, the brush editor and the model preview take every key', () => {
	assert.equal(route('b', { blocked: true }), 'none')
	assert.equal(route('z', { brushEditor: true, inspector: true }), 'none')
	assert.equal(route('Escape', { modelPreview: true, inspector: true }), 'none')
	// The preview's own Esc closed it before the window saw the key.
	assert.equal(route('Escape', { inspector: true }, true), 'none')
})

test('Esc closes the Inspector alone, before the editors are asked', () => {
	assert.equal(route('Escape', { inspector: true }), 'closeInspector')
	assert.equal(route('Escape', { inspector: true, spawnEditor: true }), 'closeInspector')
	assert.equal(route('b', { inspector: true }), 'map')
})

test('the database editors take every key; the spawn editors let undo and redo through', () => {
	assert.equal(route('z', { databaseEditor: true }), 'none')
	assert.equal(route('z', { spawnEditor: true }), 'undoRedo')
	assert.equal(route('z', { databaseEditor: true, spawnEditor: true }), 'none')
})

test('the day cycle steps through its speeds and pauses below the slowest', () => {
	assert.equal(stepCycle(0, true), CYCLE_MINUTES[0])
	assert.equal(stepCycle(0, false), 0)
	assert.equal(stepCycle(40, true), 20)
	assert.equal(stepCycle(20, false), 40)
	assert.equal(stepCycle(40, false), 0)
	assert.equal(stepCycle(1, true), 1)
	// A speed between the steps goes to the next one either way.
	assert.equal(stepCycle(15, true), 10)
	assert.equal(stepCycle(15, false), 20)
})
