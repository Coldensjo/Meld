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
