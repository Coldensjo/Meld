// Run with: bun test tests/prefs.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changedPrefs } from '../src/lib/state/prefsPatch.ts'

test('a save carries only the preferences that changed since the baseline', () => {
  const base = new Map([
    ['fog', 'true'],
    ['cameraSpeed', '2'],
    ['doodadBrushes', '[{"name":"Bushes"}]'],
  ])
  const current = { fog: false, cameraSpeed: 2, doodadBrushes: [{ name: 'Bushes' }], clouds: true }
  const patch = changedPrefs(current, base)!
  assert.equal(patch.json, '{"fog":false,"clouds":true}', 'fog changed, clouds was never saved, the rest match')
  assert.deepEqual([...patch.keys.keys()], ['fog', 'clouds'])
  base.set('fog', 'false')
  base.set('clouds', 'true')
  assert.equal(changedPrefs(current, base), null, 'nothing left to send')
})

import { prefShapeOk, prefValueOk } from '../src/lib/state/prefsPatch.ts'

test('a preference with the wrong nested shape is rejected', () => {
	const entry = { type: 'm2:a.m2', weight: 10, scaleMin: 1, scaleMax: 1 }
	assert.equal(prefShapeOk('doodadBrushes', [{ name: 'a', spacing: 1, entries: [entry] }]), true)
	assert.equal(prefShapeOk('doodadBrushes', [{ name: 'a', spacing: 1 }]), false, 'no entries')
	assert.equal(prefShapeOk('doodadBrushes', [null]), false)
	assert.equal(prefShapeOk('doodadBrushes', [{ name: 'a', spacing: 1, entries: [{ type: 'x' }] }]), false, 'entry without weight')
	assert.equal(prefShapeOk('brushStacks', [{ name: 's' }]), false, 'no items')
	assert.equal(prefShapeOk('modelSets', [{ name: 's', models: [1] }]), false)
	assert.equal(prefShapeOk('pinnedMaps', [1, null]), false)
	assert.equal(prefShapeOk('pinnedMaps', [0, 1]), true)
	assert.equal(prefShapeOk('theme', 'nonsense'), true, 'a key with no nested data is left to prefValueOk')
})

test('a session without tabs or maps is rejected, a saved one passes', () => {
	const view = { target: [1, 2, 3], yaw: 0, pitch: 0, distance: 10 }
	const ok = { tabs: [{ map: { file: 'a.wmap' }, view }, { map: { region: { mapName: 'Azeroth', x: 1, y: 2, size: 3 } }, view }], active: 1 }
	assert.equal(prefShapeOk('session', ok), true)
	assert.equal(prefShapeOk('session', { tabs: [{ view }], active: 0 }), false, 'a tab without map')
	assert.equal(prefShapeOk('session', { tabs: [{ map: {}, view }], active: 0 }), false)
	assert.equal(prefShapeOk('session', { tabs: 3, active: 0 }), false)
	assert.equal(prefShapeOk('session', null), false)
	assert.equal(prefValueOk(ok, null), false, 'null never replaces an object preference')
})

test('a spawn brush and a project accept the null and older shapes they can hold', () => {
	assert.equal(prefShapeOk('project', null), true)
	assert.equal(prefShapeOk('project', { name: 'p', path: 'a', clientPath: 'b' }), true)
	assert.equal(prefShapeOk('project', { name: 'p' }), false)
	assert.equal(prefShapeOk('spawnBrush', { entries: [], density: 12 }), true, 'an older brush with fewer settings')
	assert.equal(prefShapeOk('spawnBrush', { density: 12 }), false)
})
